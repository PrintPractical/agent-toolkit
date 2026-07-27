import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const script = path.join(scriptsDir, 'implementation-checkpoint.mjs');
const id = '2026-07-24-checkpoint';
const DEFAULT_COMMAND = 'node --check src/a.mjs';

function run(args, cwd) {
  return spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
}

function parseResult(result) {
  return JSON.parse(result.stdout.trim());
}

function statePath(cwd) {
  return path.join(cwd, '.changes', 'active', id, 'implementation-state.json');
}

function readState(cwd) {
  return JSON.parse(fs.readFileSync(statePath(cwd), 'utf8'));
}

function writeJson(cwd, name, value) {
  const file = path.join(cwd, name);
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
  return name;
}

function review(unitId, stage, snapshot, findings = [], verdict, reviewerId) {
  return {
    version: 1,
    unitId,
    stage,
    snapshot,
    reviewerRole: stage === 'initial' ? 'read-only-initial-reviewer' : 'fresh-final-reviewer',
    reviewerId: reviewerId ?? (stage === 'initial' ? `reviewer-initial-${unitId}` : `reviewer-final-${unitId}`),
    checks: ['correctness and behavior', 'structure and idioms', 'test quality'],
    verdict: verdict ?? (stage === 'initial' ? 'ready-for-refactor' : 'behavior-preserved'),
    findings,
    ...(findings.length === 0 ? { noFindingsRationale: 'Reviewed correctness, structure, and tests without identifying actionable findings.' } : {}),
  };
}

function finding(id, category, status = 'unresolved') {
  return {
    id,
    category,
    severity: category === 'cleanup' ? 'low' : 'high',
    status,
    file: 'src/a.mjs',
    line: 1,
    summary: `${category} finding ${id}`,
    disposition: status === 'resolved' ? 'Corrected and rechecked.' : 'Requires correction before progress.',
  };
}

function initialize(cwd, units = [{ id: 'unit-a', files: ['src/a.mjs'], lockedTestFiles: ['test/a.test.mjs'] }]) {
  const declarations = units.map(unit => ({
    ...unit,
    baselineCommand: unit.baselineCommand ?? DEFAULT_COMMAND,
    finalCommand: unit.finalCommand ?? DEFAULT_COMMAND,
  }));
  const result = run(['--id', id, '--init', '--units', JSON.stringify(declarations)], cwd);
  assert.equal(result.status, 0, result.stderr);
  return result;
}

function baseline(cwd, unitId = 'unit-a', command = readState(cwd).units[unitId].baselineCommand) {
  return run(['--id', id, '--unit', unitId, '--baseline-test', '--command', command], cwd);
}

function initialReview(cwd, unitId = 'unit-a', findings = [], options = {}) {
  const snapshot = readState(cwd).units[unitId].baseline.snapshot.sha256;
  const file = writeJson(cwd, `${unitId}-initial.json`, review(unitId, 'initial', snapshot, findings, options.verdict, options.reviewerId));
  return run(['--id', id, '--unit', unitId, '--initial-review', '--review', file], cwd);
}

function startRefactor(cwd, unitId = 'unit-a') {
  return run(['--id', id, '--unit', unitId, '--start-refactor'], cwd);
}

function finalTest(cwd, unitId = 'unit-a', extra = []) {
  return run([
    '--id', id, '--unit', unitId, '--final-test',
    '--command', readState(cwd).units[unitId].finalCommand, ...extra,
  ], cwd);
}

function finalReview(cwd, unitId = 'unit-a', findings = [], overrides = {}) {
  const snapshot = readState(cwd).units[unitId].tested.snapshot.sha256;
  const data = { ...review(unitId, 'final', snapshot, findings), ...overrides };
  const file = writeJson(cwd, `${unitId}-final.json`, data);
  return run(['--id', id, '--unit', unitId, '--final-review', '--review', file], cwd);
}

describe('implementation-checkpoint.mjs', () => {
  let cwd;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-checkpoint-'));
    fs.mkdirSync(path.join(cwd, 'src'), { recursive: true });
    fs.mkdirSync(path.join(cwd, 'test'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'src', 'a.mjs'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(cwd, 'test', 'a.test.mjs'), '/* locked */\n');
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('supports --help without creating project state', () => {
    const result = run(['--help'], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
    assert.equal(fs.existsSync(path.join(cwd, '.changes')), false);
  });

  it('initializes sorted stable unit IDs, declared files, and locked test files', () => {
    const result = initialize(cwd, [
      { id: 'unit-z', files: ['src/z.mjs'], lockedTestFiles: [] },
      { id: 'unit-a', files: ['src/a.mjs'], lockedTestFiles: ['test/a.test.mjs'] },
    ]);
    assert.deepEqual(parseResult(result).expectedUnitIds, ['unit-a', 'unit-z']);
    const state = readState(cwd);
    assert.deepEqual(state.expectedUnitIds, ['unit-a', 'unit-z']);
    assert.equal(state.units['unit-a'].phase, 'building');
    assert.deepEqual(state.units['unit-a'].files, ['src/a.mjs']);
    assert.deepEqual(state.units['unit-a'].lockedTestFiles, ['test/a.test.mjs']);

    const duplicateInit = initialize.bind(null, cwd);
    assert.throws(duplicateInit);
  });

  it('rejects duplicate or unsafe stable declarations', () => {
    let result = run(['--id', id, '--init', '--units', JSON.stringify([
      { id: 'same', files: ['src/a.mjs'], lockedTestFiles: [], baselineCommand: DEFAULT_COMMAND, finalCommand: DEFAULT_COMMAND },
      { id: 'same', files: ['src/b.mjs'], lockedTestFiles: [], baselineCommand: DEFAULT_COMMAND, finalCommand: DEFAULT_COMMAND },
    ])], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Duplicate implementation unit id/);

    result = run(['--id', id, '--init', '--units', JSON.stringify([
      { id: 'unsafe', files: ['../outside'], lockedTestFiles: [], baselineCommand: DEFAULT_COMMAND, finalCommand: DEFAULT_COMMAND },
    ])], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must stay within the repository/);

    result = run(['--id', id, '--init', '--units', JSON.stringify([
      { id: 'one', files: ['src/a.mjs'], lockedTestFiles: [], baselineCommand: DEFAULT_COMMAND, finalCommand: DEFAULT_COMMAND },
      { id: 'two', files: ['src/b.mjs'], lockedTestFiles: ['src/a.mjs'], baselineCommand: DEFAULT_COMMAND, finalCommand: DEFAULT_COMMAND },
    ])], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /editable file in another unit but a locked test file/);

    result = run(['--id', id, '--init', '--units', JSON.stringify([
      { id: 'one', files: ['src/unused1.mjs'], lockedTestFiles: ['src/a.mjs'], baselineCommand: DEFAULT_COMMAND, finalCommand: DEFAULT_COMMAND },
      { id: 'two', files: ['src/a.mjs'], lockedTestFiles: ['src/unused2.mjs'], baselineCommand: DEFAULT_COMMAND, finalCommand: DEFAULT_COMMAND },
    ])], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /locked test file in another unit but an editable file/);
  });

  it('allows shared file paths across multiple units and tracks them in state', () => {
    fs.writeFileSync(path.join(cwd, 'shared.mjs'), 'export const shared = true;\n');
    const result = initialize(cwd, [
      { id: 'unit-a', files: ['src/a.mjs', 'shared.mjs'], lockedTestFiles: ['test/a.test.mjs'] },
      { id: 'unit-b', files: ['shared.mjs', 'src/b.mjs'], lockedTestFiles: [] },
    ]);
    assert.equal(result.status, 0, result.stderr);
    fs.writeFileSync(path.join(cwd, 'src', 'b.mjs'), 'export const b = 1;\n');
    const state = readState(cwd);
    assert.deepEqual(state.sharedPaths.sort(), ['shared.mjs']);
    assert.deepEqual(state.expectedUnitIds, ['unit-a', 'unit-b']);
    assert.deepEqual(state.units['unit-a'].files, ['shared.mjs', 'src/a.mjs']);
    assert.deepEqual(state.units['unit-b'].files, ['shared.mjs', 'src/b.mjs']);
  });

  it('handles sequential units sharing a file across the full checkpoint cycle', () => {
    fs.writeFileSync(path.join(cwd, 'shared.mjs'), 'export const shared = true;\n');
    fs.writeFileSync(path.join(cwd, 'src', 'b.mjs'), 'export const b = 1;\n');
    initialize(cwd, [
      { id: 'unit-a', files: ['src/a.mjs', 'shared.mjs'], lockedTestFiles: ['test/a.test.mjs'] },
      { id: 'unit-b', files: ['shared.mjs', 'src/b.mjs'], lockedTestFiles: [] },
    ]);
    const state = readState(cwd);
    assert.deepEqual(state.sharedPaths.sort(), ['shared.mjs']);

    // Complete unit-a through the full cycle
    assert.equal(baseline(cwd, 'unit-a').status, 0);
    assert.equal(initialReview(cwd, 'unit-a').status, 0);
    assert.equal(startRefactor(cwd, 'unit-a').status, 0);
    fs.appendFileSync(path.join(cwd, 'shared.mjs'), '\n// unit-a refactor\n');
    assert.equal(finalTest(cwd, 'unit-a', ['--no-change-rationale', 'Minor cleanup in shared file after review.']).status, 0);
    assert.equal(finalReview(cwd, 'unit-a').status, 0);

    // Complete unit-b through the full cycle (shared.mjs already changed by unit-a)
    assert.equal(baseline(cwd, 'unit-b').status, 0);
    assert.equal(initialReview(cwd, 'unit-b').status, 0);
    assert.equal(startRefactor(cwd, 'unit-b').status, 0);
    fs.appendFileSync(path.join(cwd, 'shared.mjs'), '\n// unit-b refactor\n');
    assert.equal(finalTest(cwd, 'unit-b', ['--no-change-rationale', 'Additional cleanup in shared file after review.']).status, 0);
    assert.equal(finalReview(cwd, 'unit-b').status, 0);

    // --check-all should pass
    const result = run(['--id', id, '--check-all'], cwd);
    assert.equal(result.status, 0, result.stderr);
    const parsed = parseResult(result);
    assert.equal(parsed.valid, true);
  });

  it('runs baseline commands and advances only after success', () => {
    const command = `node -e "const fs=require('fs');if(!fs.existsSync('baseline-ran')){fs.writeFileSync('baseline-ran','yes');process.exit(7)}"`;
    initialize(cwd, [{ id: 'unit-a', files: ['src/a.mjs'], lockedTestFiles: ['test/a.test.mjs'], baselineCommand: command }]);
    const marker = path.join(cwd, 'baseline-ran');
    let result = baseline(cwd);
    assert.equal(result.status, 1);
    assert.equal(fs.readFileSync(marker, 'utf8'), 'yes');
    assert.equal(readState(cwd).units['unit-a'].phase, 'building');

    result = baseline(cwd);
    assert.equal(result.status, 0, result.stderr);
    const unit = readState(cwd).units['unit-a'];
    assert.equal(unit.phase, 'green');
    assert.match(unit.baseline.snapshot.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(unit.baseline.snapshot.files.map(file => file.path), ['src/a.mjs', 'test/a.test.mjs']);
  });

  it('requires transition commands to exactly match declarations', () => {
    initialize(cwd);
    const result = baseline(cwd, 'unit-a', 'node --check test/a.test.mjs');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /exactly match the declared baselineCommand/);
    assert.equal(readState(cwd).units['unit-a'].phase, 'building');
  });

  it('binds snapshots to relative paths, existence, and content deterministically', () => {
    initialize(cwd, [{
      id: 'unit-a', files: ['src/a.mjs'], lockedTestFiles: ['test/a.test.mjs'],
      baselineCommand: 'node --check test/a.test.mjs', finalCommand: 'node --check test/a.test.mjs',
    }]);
    assert.equal(baseline(cwd).status, 0);
    const first = readState(cwd).units['unit-a'].baseline.snapshot.sha256;

    fs.writeFileSync(path.join(cwd, 'src', 'a.mjs'), 'export const value = 2;\n');
    let result = baseline(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalidated to 'building'/);
    result = baseline(cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.notEqual(readState(cwd).units['unit-a'].baseline.snapshot.sha256, first);

    const prior = readState(cwd).units['unit-a'].baseline.snapshot.sha256;
    fs.rmSync(path.join(cwd, 'src', 'a.mjs'));
    assert.equal(baseline(cwd).status, 1);
    assert.equal(baseline(cwd).status, 0);
    assert.notEqual(readState(cwd).units['unit-a'].baseline.snapshot.sha256, prior);
  });

  it('requires structured snapshot-bound initial review and allows cleanup findings', () => {
    initialize(cwd);
    assert.equal(baseline(cwd).status, 0);
    let result = initialReview(cwd, 'unit-a', [finding('cleanup-1', 'cleanup')]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readState(cwd).units['unit-a'].phase, 'reviewed');
    assert.equal(readState(cwd).units['unit-a'].initialReview.findings[0].status, 'unresolved');
  });

  it('blocks initial review on unresolved blocking and kickback findings', () => {
    for (const category of ['blocking', 'kickback']) {
      const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-review-block-'));
      try {
        fs.mkdirSync(path.join(isolated, 'src'), { recursive: true });
        fs.mkdirSync(path.join(isolated, 'test'), { recursive: true });
        fs.writeFileSync(path.join(isolated, 'src', 'a.mjs'), 'a\n');
        fs.writeFileSync(path.join(isolated, 'test', 'a.test.mjs'), 't\n');
        initialize(isolated);
        assert.equal(baseline(isolated).status, 0);
        const result = initialReview(isolated, 'unit-a', [finding(`${category}-1`, category)]);
        assert.equal(result.status, 1);
        assert.match(result.stderr, category === 'kickback' ? /must use kickback-log\.mjs/ : /unresolved blocking findings/);
        assert.equal(readState(isolated).units['unit-a'].phase, 'green');
      } finally {
        fs.rmSync(isolated, { recursive: true, force: true });
      }
    }
  });

  it('requires kickback findings to use the manifest lifecycle even when marked resolved', () => {
    initialize(cwd);
    assert.equal(baseline(cwd).status, 0);
    const result = initialReview(cwd, 'unit-a', [finding('kickback-1', 'kickback', 'resolved')]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must use kickback-log\.mjs/);
    assert.equal(readState(cwd).units['unit-a'].phase, 'green');
  });

  it('invalidates green and reviewed checkpoints when declared files are edited', () => {
    initialize(cwd);
    assert.equal(baseline(cwd).status, 0);
    fs.appendFileSync(path.join(cwd, 'src', 'a.mjs'), '// edit after green\n');
    let result = initialReview(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalidated to 'building'/);
    assert.equal(readState(cwd).units['unit-a'].phase, 'building');

    assert.equal(baseline(cwd).status, 0);
    assert.equal(initialReview(cwd).status, 0);
    fs.appendFileSync(path.join(cwd, 'src', 'a.mjs'), '// edit after review\n');
    result = startRefactor(cwd);
    assert.equal(result.status, 1);
    assert.equal(readState(cwd).units['unit-a'].phase, 'building');
  });

  it('enforces the full phase order one transition per invocation', () => {
    initialize(cwd);
    assert.equal(baseline(cwd).status, 0);
    assert.equal(readState(cwd).units['unit-a'].phase, 'green');
    assert.equal(initialReview(cwd).status, 0);
    assert.equal(readState(cwd).units['unit-a'].phase, 'reviewed');
    assert.equal(startRefactor(cwd).status, 0);
    assert.equal(readState(cwd).units['unit-a'].phase, 'refactoring');
    fs.appendFileSync(path.join(cwd, 'src', 'a.mjs'), '// refactored\n');
    assert.equal(finalTest(cwd).status, 0);
    assert.equal(readState(cwd).units['unit-a'].phase, 'tested');
    assert.equal(finalReview(cwd).status, 0);
    assert.equal(readState(cwd).units['unit-a'].phase, 'verified');
  });

  it('runs final tests, advances only on success, and requires a substantive no-op rationale', () => {
    const command = `node -e "const fs=require('fs');if(!fs.existsSync('final-ran')){fs.writeFileSync('final-ran','yes');process.exit(9)}"`;
    initialize(cwd, [{ id: 'unit-a', files: ['src/a.mjs'], lockedTestFiles: ['test/a.test.mjs'], finalCommand: command }]);
    assert.equal(baseline(cwd).status, 0);
    assert.equal(initialReview(cwd).status, 0);
    assert.equal(startRefactor(cwd).status, 0);

    let result = finalTest(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no-op refactor requires/);
    assert.equal(readState(cwd).units['unit-a'].phase, 'refactoring');

    result = finalTest(cwd, 'unit-a', ['--no-change-rationale', 'The implementation was already minimal and clear.']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /failed with exit code 9/);
    assert.equal(readState(cwd).units['unit-a'].phase, 'refactoring');

    result = finalTest(cwd, 'unit-a', [
      '--no-change-rationale', 'The implementation was already minimal and clear.',
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readState(cwd).units['unit-a'].phase, 'tested');
    assert.equal(readState(cwd).units['unit-a'].noChangeRationale, 'The implementation was already minimal and clear.');
  });

  it('persistently blocks changed locked tests until their first-green contents are restored', () => {
    initialize(cwd);
    assert.equal(baseline(cwd).status, 0);
    assert.equal(initialReview(cwd).status, 0);
    assert.equal(startRefactor(cwd).status, 0);
    fs.appendFileSync(path.join(cwd, 'test', 'a.test.mjs'), '// forbidden edit\n');
    let result = finalTest(cwd, 'unit-a', ['--no-change-rationale', 'No implementation changes were needed after careful review.']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /immutable first-green baseline/);
    assert.equal(readState(cwd).units['unit-a'].phase, 'refactoring');
    assert.ok(readState(cwd).units['unit-a'].lockViolation);

    result = baseline(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot be re-baselined/);

    fs.writeFileSync(path.join(cwd, 'test', 'a.test.mjs'), '/* locked */\n');
    result = finalTest(cwd, 'unit-a', ['--no-change-rationale', 'No implementation changes were needed after careful review.']);
    assert.equal(result.status, 0, result.stderr);
  });

  it('requires final reviews to match tested/current snapshots and preserve behavior', () => {
    initialize(cwd);
    assert.equal(baseline(cwd).status, 0);
    assert.equal(initialReview(cwd).status, 0);
    assert.equal(startRefactor(cwd).status, 0);
    fs.appendFileSync(path.join(cwd, 'src', 'a.mjs'), '// refactored\n');
    assert.equal(finalTest(cwd).status, 0);

    let result = finalReview(cwd, 'unit-a', [], { verdict: 'changes-requested' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /behavior-preserved/);

    result = finalReview(cwd, 'unit-a', [finding('block-1', 'blocking')]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unresolved blocking findings/);

    result = finalReview(cwd, 'unit-a', [finding('block-1', 'blocking', 'resolved')]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readState(cwd).units['unit-a'].phase, 'verified');
  });

  it('requires distinct declared reviewer identities', () => {
    initialize(cwd);
    assert.equal(baseline(cwd).status, 0);
    assert.equal(initialReview(cwd).status, 0);
    assert.equal(startRefactor(cwd).status, 0);
    fs.appendFileSync(path.join(cwd, 'src', 'a.mjs'), '// cleanup\n');
    assert.equal(finalTest(cwd).status, 0);
    const result = finalReview(cwd, 'unit-a', [], { reviewerId: 'reviewer-initial-unit-a' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must differ/);
  });

  it('does not allow reviewer identities to be reused after evidence invalidation', () => {
    fs.writeFileSync(path.join(cwd, 'src', 'b.mjs'), 'export const b = 1;\n');
    initialize(cwd, [
      { id: 'unit-a', files: ['src/a.mjs'], lockedTestFiles: ['test/a.test.mjs'] },
      { id: 'unit-b', files: ['src/b.mjs'], lockedTestFiles: [] },
    ]);
    assert.equal(baseline(cwd).status, 0);
    assert.equal(initialReview(cwd).status, 0);
    fs.appendFileSync(path.join(cwd, 'src', 'a.mjs'), '// invalidate accepted review\n');
    let result = startRefactor(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalidated to 'building'/);
    fs.writeFileSync(path.join(cwd, 'src', 'a.mjs'), 'export const value = 1;\n');

    assert.equal(baseline(cwd, 'unit-b').status, 0);
    result = initialReview(cwd, 'unit-b', [], { reviewerId: 'reviewer-initial-unit-a' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already used/);
  });

  it('rejects trivial declared verification commands', () => {
    const result = run(['--id', id, '--init', '--units', JSON.stringify([{
      id: 'unit-a', files: ['src/a.mjs'], lockedTestFiles: [], baselineCommand: 'true', finalCommand: DEFAULT_COMMAND,
    }])], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /substantive verification command/);
  });

  it('detects executable mode and symlink identity changes', { skip: process.platform === 'win32' }, () => {
    initialize(cwd);
    assert.equal(baseline(cwd).status, 0);
    fs.chmodSync(path.join(cwd, 'src', 'a.mjs'), 0o755);
    let result = initialReview(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalidated to 'building'/);

    assert.equal(baseline(cwd).status, 0);
    fs.writeFileSync(path.join(cwd, 'src', 'target.mjs'), 'export const value = 1;\n');
    fs.rmSync(path.join(cwd, 'src', 'a.mjs'));
    fs.symlinkSync('target.mjs', path.join(cwd, 'src', 'a.mjs'));
    result = initialReview(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalidated to 'building'/);
  });

  it('invalidates tested and verified units when their snapshot becomes stale', () => {
    initialize(cwd);
    assert.equal(baseline(cwd).status, 0);
    assert.equal(initialReview(cwd).status, 0);
    assert.equal(startRefactor(cwd).status, 0);
    fs.appendFileSync(path.join(cwd, 'src', 'a.mjs'), '// first refactor\n');
    assert.equal(finalTest(cwd).status, 0);
    fs.appendFileSync(path.join(cwd, 'src', 'a.mjs'), '// post-test edit\n');
    let result = finalReview(cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalidated to 'refactoring'/);
    assert.equal(readState(cwd).units['unit-a'].phase, 'refactoring');

    assert.equal(finalTest(cwd).status, 0);
    assert.equal(finalReview(cwd).status, 0);
    fs.appendFileSync(path.join(cwd, 'src', 'a.mjs'), '// post-review edit\n');
    result = run(['--id', id, '--unit', 'unit-a', '--final-review', '--review', 'unit-a-final.json'], cwd);
    assert.equal(result.status, 1);
    assert.equal(readState(cwd).units['unit-a'].phase, 'refactoring');
  });

  it('--check-all requires every expected unit to be verified and current', () => {
    fs.writeFileSync(path.join(cwd, 'src', 'b.mjs'), 'export const b = 1;\n');
    initialize(cwd, [
      { id: 'unit-a', files: ['src/a.mjs'], lockedTestFiles: ['test/a.test.mjs'] },
      { id: 'unit-b', files: ['src/b.mjs'], lockedTestFiles: [] },
    ]);
    assert.equal(baseline(cwd).status, 0);
    assert.equal(initialReview(cwd).status, 0);
    assert.equal(startRefactor(cwd).status, 0);
    assert.equal(finalTest(cwd, 'unit-a', ['--no-change-rationale', 'The existing implementation needed no structural changes.']).status, 0);
    assert.equal(finalReview(cwd).status, 0);

    let result = run(['--id', id, '--check-all'], cwd);
    assert.equal(result.status, 1);
    assert.equal(parseResult(result).valid, false);

    assert.equal(baseline(cwd, 'unit-b').status, 0);
    assert.equal(initialReview(cwd, 'unit-b').status, 0);
    assert.equal(startRefactor(cwd, 'unit-b').status, 0);
    assert.equal(finalTest(cwd, 'unit-b', ['--no-change-rationale', 'The existing implementation needed no structural changes.']).status, 0);
    assert.equal(finalReview(cwd, 'unit-b').status, 0);
    result = run(['--id', id, '--check-all'], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(parseResult(result).valid, true);

    fs.appendFileSync(path.join(cwd, 'src', 'b.mjs'), '// stale\n');
    result = run(['--id', id, '--check-all'], cwd);
    assert.equal(result.status, 1);
    assert.equal(parseResult(result).units.find(unit => unit.id === 'unit-b').current, false);
  });

  it('--check-all rejects worktree changes outside declared units', () => {
    assert.equal(spawnSync('git', ['init'], { cwd, encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['add', '.'], { cwd, encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'], { cwd, encoding: 'utf8' }).status, 0);
    initialize(cwd);
    assert.equal(baseline(cwd).status, 0);
    assert.equal(initialReview(cwd).status, 0);
    assert.equal(startRefactor(cwd).status, 0);
    assert.equal(finalTest(cwd, 'unit-a', ['--no-change-rationale', 'The reviewed implementation required no additional structural cleanup.']).status, 0);
    assert.equal(finalReview(cwd).status, 0);
    fs.rmSync(path.join(cwd, 'unit-a-initial.json'));
    fs.rmSync(path.join(cwd, 'unit-a-final.json'));

    fs.writeFileSync(path.join(cwd, 'src', 'undeclared.mjs'), 'export const hidden = true;\n');
    const result = run(['--id', id, '--check-all'], cwd);
    assert.equal(result.status, 1);
    assert.deepEqual(parseResult(result).unexplainedFiles, ['src/undeclared.mjs']);
    assert.match(result.stderr, /Undeclared worktree changes/);
  });

  it('--check-all rejects undeclared files committed after initialization', () => {
    assert.equal(spawnSync('git', ['init'], { cwd, encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['add', '.'], { cwd, encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'], { cwd, encoding: 'utf8' }).status, 0);
    initialize(cwd);
    assert.equal(baseline(cwd).status, 0);
    assert.equal(initialReview(cwd).status, 0);
    assert.equal(startRefactor(cwd).status, 0);
    assert.equal(finalTest(cwd, 'unit-a', ['--no-change-rationale', 'The reviewed implementation required no additional structural cleanup.']).status, 0);
    assert.equal(finalReview(cwd).status, 0);
    fs.rmSync(path.join(cwd, 'unit-a-initial.json'));
    fs.rmSync(path.join(cwd, 'unit-a-final.json'));

    fs.writeFileSync(path.join(cwd, 'src', 'committed-undeclared.mjs'), 'export const hidden = true;\n');
    assert.equal(spawnSync('git', ['add', 'src/committed-undeclared.mjs'], { cwd, encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'undeclared'], { cwd, encoding: 'utf8' }).status, 0);

    const result = run(['--id', id, '--check-all'], cwd);
    assert.equal(result.status, 1);
    assert.deepEqual(parseResult(result).unexplainedFiles, ['src/committed-undeclared.mjs']);
  });

  it('rejects staged content that differs from the reviewed worktree', () => {
    assert.equal(spawnSync('git', ['init'], { cwd, encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['add', '.'], { cwd, encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'], { cwd, encoding: 'utf8' }).status, 0);
    initialize(cwd);
    assert.equal(baseline(cwd).status, 0);
    assert.equal(initialReview(cwd).status, 0);
    assert.equal(startRefactor(cwd).status, 0);
    fs.writeFileSync(path.join(cwd, 'src', 'a.mjs'), 'export const value = 2;\n');
    assert.equal(spawnSync('git', ['add', 'src/a.mjs'], { cwd, encoding: 'utf8' }).status, 0);
    fs.writeFileSync(path.join(cwd, 'src', 'a.mjs'), 'export const value = 1;\n');
    const result = finalTest(cwd, 'unit-a', ['--no-change-rationale', 'The reviewed worktree itself required no source cleanup.']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Git index content differs/);
  });

  it('blocks one unit from changing another unit before its checkpoint cycle', () => {
    fs.writeFileSync(path.join(cwd, 'src', 'b.mjs'), 'export const b = 1;\n');
    initialize(cwd, [
      { id: 'unit-a', files: ['src/a.mjs'], lockedTestFiles: ['test/a.test.mjs'] },
      { id: 'unit-b', files: ['src/b.mjs'], lockedTestFiles: [] },
    ]);
    fs.appendFileSync(path.join(cwd, 'src', 'b.mjs'), '// changed by wrong unit\n');
    const result = baseline(cwd, 'unit-a');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /path ownership for unit 'unit-b' changed/);
  });
});
