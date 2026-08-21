import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'context-verify.mjs');
const scaffoldScript = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'context-scaffold.mjs');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function head(cwd) { return git(cwd, ['rev-parse', 'HEAD']); }

function verify(cwd, args = []) {
  return spawnSync(process.execPath, [script, '--root', cwd, ...args], { encoding: 'utf8' });
}
function scaffold(cwd, args = []) {
  return spawnSync(process.execPath, [scaffoldScript, ...args], { cwd, encoding: 'utf8' });
}
function writeCommittedContext(cwd, body = '# Context') {
  fs.writeFileSync(path.join(cwd, 'CONTEXT.md'), `${body}\n\nProvenance: validated-at: ${head(cwd)}\n`);
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-m', 'reconcile context']);
  const stamp = head(cwd);
  const contextPath = path.join(cwd, 'CONTEXT.md');
  fs.writeFileSync(contextPath, fs.readFileSync(contextPath, 'utf8').replace(/Provenance: validated-at: .+/, `Provenance: validated-at: ${stamp}`));
}

describe('context-verify.mjs', () => {
  let cwd;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-context-'));
    git(cwd, ['init']);
    git(cwd, ['config', 'user.email', 'tests@example.com']);
    git(cwd, ['config', 'user.name', 'Tests']);
    fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'seed\n');
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-m', 'seed']);
  });

  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('fails when provenance is missing', () => {
    fs.writeFileSync(path.join(cwd, 'CONTEXT.md'), '# Context\n');

    const result = verify(cwd);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout)[0].provenanceValid, false);
  });

  it('reports staleness after relevant files change', () => {
    writeCommittedContext(cwd);
    fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'changed\n');
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-m', 'change tracked file']);

    const result = verify(cwd);
    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout)[0].changedFiles, ['CONTEXT.md', 'tracked.txt']);
  });

  it('runs each cited firm-seam command and accepts a footer-only HEAD stamp update', () => {
    fs.writeFileSync(path.join(cwd, 'firm.test'), [
      'import test from \'node:test\';',
      'import assert from \'node:assert/strict\';',
      '// [SEAM-example-01]',
      "test('firm seam', () => assert.equal(1, 1));",
    ].join('\n'));
    writeCommittedContext(cwd, [
      '# Context', '', '## Architecture & Seams', '',
      '### Seam: Example [firmness: firm]', 'Criteria:',
      '- [SEAM-example-01] [AC-example-01] Preserves the example contract. -> enforced-by: firm.test; command: node --test firm.test',
    ].join('\n'));

    const result = verify(cwd, ['--run-tests']);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(JSON.parse(result.stdout)[0].firmSeamResults[0].passed, true);
  });

  it('rejects a firm seam whose cited test lacks its marker', () => {
    fs.writeFileSync(path.join(cwd, 'firm.test'), 'export default null;\n');
    writeCommittedContext(cwd, [
      '# Context', '### Seam: Example [firmness: firm]', 'Criteria:',
      '- [SEAM-example-01] [AC-example-01] Preserves the contract. -> enforced-by: firm.test; command: node --test firm.test',
    ].join('\n'));

    const result = verify(cwd, ['--run-tests']);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout)[0].firmSeamResults[0].marker, false);
  });

  it('rejects firm seams without an acceptance criterion and executable citation', () => {
    writeCommittedContext(cwd, [
      '# Context', '### Seam: Example [firmness: firm]', 'Criteria:',
      '- [SEAM-example-01] Preserves the contract.',
    ].join('\n'));

    const result = verify(cwd, ['--run-tests']);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stdout)[0].structureErrors.join('\n'), /has no acceptance criterion/);
    assert.match(JSON.parse(result.stdout)[0].structureErrors.join('\n'), /has no executable enforcing test/);
  });

  it('ignores enforcing citations on soft seams', () => {
    writeCommittedContext(cwd, [
      '# Context', '### Seam: Example [firmness: soft]', 'Criteria:',
      '- [SEAM-example-01] Optional behavior. -> enforced-by: missing.test; command: false',
    ].join('\n'));

    const result = verify(cwd, ['--run-tests']);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.deepEqual(JSON.parse(result.stdout)[0].firmSeamResults, []);
  });

  it('marks non-footer worktree changes in a context scope stale', () => {
    writeCommittedContext(cwd);
    fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'dirty\n');

    const result = verify(cwd);
    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout)[0].changedFiles, ['tracked.txt']);
  });
});

describe('context-scaffold.mjs untracked provenance', () => {
  let cwd;

  beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-untracked-context-')); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('creates a valid untracked context and marks it stale after Git initialization', () => {
    const created = scaffold(cwd, ['--path', '.', '--root']);
    assert.equal(created.status, 0, created.stderr);
    assert.match(fs.readFileSync(path.join(cwd, 'CONTEXT.md'), 'utf8'), /Provenance: validated-at: <not-in-git-repo>/);

    let result = verify(cwd);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(JSON.parse(result.stdout)[0].provenance, 'untracked');

    git(cwd, ['init']);
    git(cwd, ['config', 'user.email', 'tests@example.com']);
    git(cwd, ['config', 'user.name', 'Tests']);
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-m', 'initialize repository']);

    result = verify(cwd);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout)[0].isStale, true);
  });
});
