import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { readManifest, writeManifest } from '../lib/index.mjs';

const scriptsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function runScript(script, args, cwd) {
  return spawnSync(process.execPath, [path.join(scriptsDir, script), ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function initializeGit(cwd) {
  assert.equal(spawnSync('git', ['init'], { cwd, encoding: 'utf8' }).status, 0);
  fs.writeFileSync(path.join(cwd, '.gitkeep'), '');
  assert.equal(spawnSync('git', ['add', '.gitkeep'], { cwd, encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'baseline'], { cwd, encoding: 'utf8' }).status, 0);
}

function completedAuditLines() {
  return [
    '**Read-only audit confirmed:** yes - all audit agents used read-only tools',
    '**Pre-selection non-artifact edits:** none',
    '## Audit roles',
    '| Role | Reviewer/session | Scope | Status | Report reference |',
    '|---|---|---|---|---|',
    '| Scope mapper | audit-session-1 | repository | complete | ranked inventory below |',
    '| Behavior guardian | audit-session-2 | repository | complete | behavior evidence below |',
    '## Ranked opportunities',
  ];
}

function selectedOpportunityLines(id = 'RF-001') {
  return [
    `### ${id} - Simplify value module`,
    '**Rank:** 1',
    '**Status:** selected',
    '**Scope:** src/value.mjs',
    '**Evidence:** src/value.mjs:1 contains the cleanup target',
    '**Payoff:** reduces unnecessary structure while retaining the same export',
    '**Behavior-preservation argument:** the exported value and module side effects remain unchanged',
    '**Observable invariants:**',
    '- importing the module returns the same exported value',
    '**Current coverage:** node syntax verification plus snapshot-bound review',
    '**Proposed files:** `src/value.mjs`',
    '**Verification:** `node --check src/value.mjs`',
    '**Disposition note:** selected explicitly by the user for execution',
    '',
  ];
}

describe('CLI help', () => {
  const scripts = [
    'change-new.mjs',
    'change-status.mjs',
    'change-archive.mjs',
    'manifest-gate.mjs',
    'context-scaffold.mjs',
    'context-discover.mjs',
    'context-verify.mjs',
    'kickback-log.mjs',
    'epic-split.mjs',
    'implementation-checkpoint.mjs',
    'sync-shared.mjs',
  ];

  for (const script of scripts) {
    it(`${script} supports --help without project state`, () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-help-'));
      try {
        const result = runScript(script, ['--help'], cwd);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Usage:/);
        assert.deepEqual(fs.readdirSync(cwd), []);
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    });
  }
});

describe('class-specific change lifecycle', () => {
  let cwd;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-lifecycle-'));
    initializeGit(cwd);
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('starts standalone bug and small changes directly in triage implementation', () => {
    for (const changeClass of ['bug', 'small']) {
      const created = runScript('change-new.mjs', [
        '--title', `${changeClass} lifecycle`,
        '--class', changeClass,
      ], cwd);
      assert.equal(created.status, 0, created.stderr);
      const { id } = JSON.parse(created.stdout);
      const manifest = readManifest(id, cwd);
      assert.equal(manifest.stage, 'implement');
      assert.equal(manifest.gates.architect, 'approved');
      assert.equal(manifest.gates.specify, 'approved');
      assert.equal(manifest.gates.plan, 'approved');
      assert.equal(manifest.gates.implement, 'pending');
    }
  });

  it('creates a dedicated refactor manifest and rejects refactors as epic children', () => {
    let result = runScript('change-new.mjs', [
      '--title', 'Repository cleanup',
      '--class', 'refactor',
    ], cwd);
    assert.equal(result.status, 0, result.stderr);
    const manifest = readManifest(JSON.parse(result.stdout).id, cwd);
    assert.equal(manifest.class, 'refactor');
    assert.equal(manifest.stage, 'refactor');
    assert.equal(manifest.checkpoint_epoch, 0);
    assert.deepEqual(manifest.gates, { refactor: 'pending', implement: 'pending', docs: 'pending' });
    assert.deepEqual(manifest.artifacts, {
      refactor: 'refactor.md',
      implementation_units: 'implementation-units.json',
      implementation_state: 'implementation-state.json',
      reviews: 'reviews/',
    });

    result = runScript('manifest-gate.mjs', ['--id', manifest.id, '--stage', 'done'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /approved gates imply 'refactor'/);
    assert.equal(readManifest(manifest.id, cwd).stage, 'refactor');

    result = runScript('change-new.mjs', ['--title', 'Parent epic', '--class', 'epic'], cwd);
    assert.equal(result.status, 0, result.stderr);
    const parentId = JSON.parse(result.stdout).id;
    result = runScript('change-new.mjs', [
      '--title', 'Nested cleanup',
      '--class', 'refactor',
      '--parent', parentId,
    ], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /epic children must use class feature, bug, or small/);
  });

  it('requires selection approval and verified checkpoints before completing a refactor', () => {
    const created = runScript('change-new.mjs', [
      '--title', 'Checkpointed cleanup',
      '--class', 'refactor',
    ], cwd);
    assert.equal(created.status, 0, created.stderr);
    const { id } = JSON.parse(created.stdout);
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'src', 'value.mjs'), 'export const value = 1;\n');
    const changeDir = path.join(cwd, '.changes', 'active', id);
    fs.writeFileSync(path.join(changeDir, 'refactor.md'), [
      ...completedAuditLines(),
      ...selectedOpportunityLines(),
      '## Selection gate',
      '**User response (verbatim):** Execute RF-001',
      '**Selected IDs:** `["RF-001"]`',
      '**Selection gate:** approved-for-exact-IDs',
      '| Unit ID | Selected IDs | Editable files | Locked test files | Baseline command | Final command |',
      '|---|---|---|---|---|---|',
      '| B-001 | `["RF-001"]` | `["src/value.mjs"]` | `[]` | `node --check src/value.mjs` | `node --check src/value.mjs` |',
      '### B-001 - Cleanup',
      '',
    ].join('\n'));
    const unitsFile = path.join(changeDir, 'implementation-units.json');
    fs.writeFileSync(unitsFile, `${JSON.stringify([{
      id: 'B-001',
      files: ['src/value.mjs'],
      lockedTestFiles: [],
      baselineCommand: 'node --check src/value.mjs',
      finalCommand: 'node --check src/value.mjs',
    }])}\n`);
    const units = path.relative(cwd, unitsFile);

    let result = runScript('implementation-checkpoint.mjs', ['--id', id, '--init', '--units', units], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /stage 'implement'|approved execution selection gate/);

    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'refactor', '--approve'], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readManifest(id, cwd).stage, 'implement');

    result = runScript('implementation-checkpoint.mjs', ['--id', id, '--init', '--units', units], cwd);
    assert.equal(result.status, 0, result.stderr);

    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'refactor', '--reset'], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readManifest(id, cwd).stage, 'refactor');
    assert.equal(readManifest(id, cwd).checkpoint_epoch, 1);
    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'implement', '--approve'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /expected 'implement'/);
    assert.equal(runScript('manifest-gate.mjs', ['--id', id, '--gate', 'refactor', '--approve'], cwd).status, 0);
    result = runScript('implementation-checkpoint.mjs', ['--id', id, '--status'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /state epoch 0 is stale/);
    result = runScript('implementation-checkpoint.mjs', ['--id', id, '--reset', '--units', units], cwd);
    assert.equal(result.status, 0, result.stderr);

    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'implement', '--approve'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /every implementation unit is verified and current/);

    result = runScript('implementation-checkpoint.mjs', [
      '--id', id, '--unit', 'B-001', '--baseline-test', '--command', 'node --check src/value.mjs',
    ], cwd);
    assert.equal(result.status, 0, result.stderr);
    let state = JSON.parse(fs.readFileSync(path.join(cwd, '.changes', 'active', id, 'implementation-state.json'), 'utf8'));
    const initialReview = {
      version: 1,
      unitId: 'B-001',
      stage: 'initial',
      snapshot: state.units['B-001'].baseline.snapshot.sha256,
      reviewerRole: 'read-only-initial-reviewer',
      reviewerId: 'initial-session',
      checks: ['correctness and behavior', 'structure and idioms', 'test quality'],
      verdict: 'ready-for-refactor',
      findings: [],
      noFindingsRationale: 'Reviewed behavior, structure, idioms, and tests without identifying actionable findings.',
    };
    const initialReviewPath = path.join(changeDir, 'initial-input.json');
    fs.writeFileSync(initialReviewPath, `${JSON.stringify(initialReview)}\n`);
    result = runScript('implementation-checkpoint.mjs', [
      '--id', id, '--unit', 'B-001', '--initial-review', '--review', path.relative(cwd, initialReviewPath),
    ], cwd);
    assert.equal(result.status, 0, result.stderr);
    result = runScript('implementation-checkpoint.mjs', ['--id', id, '--unit', 'B-001', '--start-refactor'], cwd);
    assert.equal(result.status, 0, result.stderr);
    result = runScript('implementation-checkpoint.mjs', [
      '--id', id, '--unit', 'B-001', '--final-test', '--command', 'node --check src/value.mjs',
      '--no-change-rationale', 'Independent review found no safe cleanup requiring source edits.',
    ], cwd);
    assert.equal(result.status, 0, result.stderr);

    state = JSON.parse(fs.readFileSync(path.join(cwd, '.changes', 'active', id, 'implementation-state.json'), 'utf8'));
    const finalReview = {
      ...initialReview,
      stage: 'final',
      snapshot: state.units['B-001'].tested.snapshot.sha256,
      reviewerRole: 'fresh-final-reviewer',
      reviewerId: 'final-session',
      verdict: 'behavior-preserved',
    };
    const finalReviewPath = path.join(changeDir, 'final-input.json');
    fs.writeFileSync(finalReviewPath, `${JSON.stringify(finalReview)}\n`);
    result = runScript('implementation-checkpoint.mjs', [
      '--id', id, '--unit', 'B-001', '--final-review', '--review', path.relative(cwd, finalReviewPath),
    ], cwd);
    assert.equal(result.status, 0, result.stderr);

    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'implement', '--approve'], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readManifest(id, cwd).gates.implement, 'approved');

    const docsManifest = readManifest(id, cwd);
    docsManifest.context_targets = ['CONTEXT.md'];
    writeManifest(id, docsManifest, cwd);
    fs.writeFileSync(path.join(cwd, 'CONTEXT.md'), 'reviewed docs\n');
    assert.equal(spawnSync('git', ['add', 'CONTEXT.md'], { cwd, encoding: 'utf8' }).status, 0);
    fs.writeFileSync(path.join(cwd, 'CONTEXT.md'), 'different worktree docs\n');
    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'docs', '--approve'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Git index content differs/);
    assert.equal(spawnSync('git', ['restore', '--staged', 'CONTEXT.md'], { cwd, encoding: 'utf8' }).status, 0);
    fs.rmSync(path.join(cwd, 'CONTEXT.md'));

    fs.writeFileSync(path.join(cwd, 'CONTEXT.md'), 'untracked docs\n');
    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'docs', '--approve'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Git index content differs/);
    assert.equal(spawnSync('git', ['add', 'CONTEXT.md'], { cwd, encoding: 'utf8' }).status, 0);

    fs.appendFileSync(path.join(cwd, 'src', 'value.mjs'), '// stale after implement approval\n');
    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'docs', '--approve'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /checkpoint evidence became stale/);
    fs.writeFileSync(path.join(cwd, 'src', 'value.mjs'), 'export const value = 1;\n');
    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'docs', '--approve'], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readManifest(id, cwd).stage, 'done');

  });

  it('requires explicit audit-only evidence before a refactor can close without implementation', () => {
    const created = runScript('change-new.mjs', ['--title', 'Audit only cleanup', '--class', 'refactor'], cwd);
    assert.equal(created.status, 0, created.stderr);
    const { id } = JSON.parse(created.stdout);
    const changeDir = path.join(cwd, '.changes', 'active', id);
    const auditManifest = readManifest(id, cwd);
    auditManifest.context_targets = ['CONTEXT.md'];
    writeManifest(id, auditManifest, cwd);
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'src', 'value.mjs'), 'export const value = 1;\n');

    let result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'docs', '--approve'], cwd);
    assert.equal(result.status, 1);

    fs.writeFileSync(path.join(changeDir, 'refactor.md'), [
      '**User response (verbatim):** Keep this audit only',
      '**Selected IDs:** audit-only',
      '**Selection gate:** audit-only',
      '',
    ].join('\n'));
    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'refactor', '--audit-only'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /completed read-only audit/);

    fs.writeFileSync(path.join(changeDir, 'refactor.md'), [
      '**Read-only audit confirmed:** yes - all audit agents used read-only tools',
      '**Pre-selection non-artifact edits:** none',
      '## Audit roles',
      '| Role | Reviewer/session | Scope | Status | Report reference |',
      '|---|---|---|---|---|',
      '| Scope mapper | audit-session-1 | repository | complete | ranked inventory below |',
      '| Behavior guardian | audit-session-2 | repository | complete | no behavior changes proposed |',
      '## Ranked opportunities',
      '**Audit conclusion:** no-actionable-opportunities',
      '**User response (verbatim):** Keep this audit only',
      '**Selected IDs:** audit-only',
      '**Selection gate:** audit-only',
      '',
    ].join('\n'));
    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'refactor', '--audit-only'], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readManifest(id, cwd).refactor_mode, 'audit-only');
    assert.equal(readManifest(id, cwd).stage, 'refactor');

    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'refactor', '--audit-only'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /already recorded/);

    fs.writeFileSync(path.join(cwd, 'src', 'value.mjs'), 'export const value = 2;\n');
    assert.equal(spawnSync('git', ['add', 'src/value.mjs'], { cwd, encoding: 'utf8' }).status, 0);
    fs.writeFileSync(path.join(cwd, 'src', 'value.mjs'), 'export const value = 1;\n');
    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'docs', '--approve'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /index\/worktree divergence/);
    assert.equal(spawnSync('git', ['restore', '--staged', 'src/value.mjs'], { cwd, encoding: 'utf8' }).status, 0);

    fs.writeFileSync(path.join(cwd, 'CONTEXT.md'), 'untracked audit docs\n');
    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'docs', '--approve'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /untracked context targets/);
    assert.equal(spawnSync('git', ['add', 'CONTEXT.md'], { cwd, encoding: 'utf8' }).status, 0);

    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'docs', '--approve'], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readManifest(id, cwd).stage, 'done');

    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'refactor', '--reset'], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readManifest(id, cwd).stage, 'refactor');
    result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'refactor', '--audit-only'], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readdirSync(path.join(changeDir, 'checkpoint-history')).filter(name => name.startsWith('audit-only-')).length, 1);
  });

  it('rejects manifest-backed unit declarations that omit planned sections', () => {
    const created = runScript('change-new.mjs', ['--title', 'Incomplete units', '--class', 'feature'], cwd);
    assert.equal(created.status, 0, created.stderr);
    const { id } = JSON.parse(created.stdout);
    const manifest = readManifest(id, cwd);
    manifest.stage = 'plan';
    manifest.gates = { architect: 'approved', specify: 'approved', plan: 'pending', implement: 'pending', docs: 'pending' };
    writeManifest(id, manifest, cwd);
    const changeDir = path.join(cwd, '.changes', 'active', id);
    fs.writeFileSync(path.join(changeDir, 'plan.md'), [
      '> **Checkpoint unit:** S-001',
      '> **Editable files:** `["src/value.mjs"]`',
      '> **Locked test files:** `[]`',
      '> **Baseline command:** `node --check src/value.mjs`',
      '> **Final command:** `node --check src/value.mjs`',
      '> **Checkpoint unit:** S-002',
      '> **Editable files:** `["src/value.mjs"]`',
      '> **Locked test files:** `[]`',
      '> **Baseline command:** `node --check src/value.mjs`',
      '> **Final command:** `node --check src/value.mjs`',
      '',
    ].join('\n'));
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'src', 'value.mjs'), 'export const value = 1;\n');
    const units = path.join('.changes', 'active', id, 'implementation-units.json');
    fs.writeFileSync(path.join(cwd, units), `${JSON.stringify([{
      id: 'S-001', files: ['src/value.mjs'], lockedTestFiles: [],
      baselineCommand: 'node --check src/value.mjs', finalCommand: 'node --check src/value.mjs',
    }])}\n`);
    assert.equal(runScript('manifest-gate.mjs', ['--id', id, '--gate', 'plan', '--approve'], cwd).status, 0);
    const result = runScript('implementation-checkpoint.mjs', ['--id', id, '--init', '--units', units], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must exactly match plan.md checkpoint markers/);
  });

  it('rejects declaration path and lock drift from the approved plan', () => {
    const created = runScript('change-new.mjs', ['--title', 'Path binding', '--class', 'feature'], cwd);
    const { id } = JSON.parse(created.stdout);
    const manifest = readManifest(id, cwd);
    manifest.stage = 'plan';
    manifest.gates = { architect: 'approved', specify: 'approved', plan: 'pending', implement: 'pending', docs: 'pending' };
    writeManifest(id, manifest, cwd);
    const changeDir = path.join(cwd, '.changes', 'active', id);
    fs.writeFileSync(path.join(changeDir, 'plan.md'), [
      '> **Checkpoint unit:** S-001',
      '> **Editable files:** `["src/value.mjs"]`',
      '> **Locked test files:** `["test/value.test.mjs"]`',
      '> **Baseline command:** `node --check src/value.mjs`',
      '> **Final command:** `node --check src/value.mjs`',
      '',
    ].join('\n'));
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.mkdirSync(path.join(cwd, 'test'));
    fs.writeFileSync(path.join(cwd, 'src', 'value.mjs'), 'export const value = 1;\n');
    fs.writeFileSync(path.join(cwd, 'test', 'value.test.mjs'), '// locked\n');
    const units = path.join('.changes', 'active', id, 'implementation-units.json');
    fs.writeFileSync(path.join(cwd, units), `${JSON.stringify([{
      id: 'S-001', files: ['src/value.mjs', 'test/value.test.mjs'], lockedTestFiles: [],
      baselineCommand: 'node --check src/value.mjs', finalCommand: 'node --check src/value.mjs',
    }])}\n`);
    assert.equal(runScript('manifest-gate.mjs', ['--id', id, '--gate', 'plan', '--approve'], cwd).status, 0);
    const result = runScript('implementation-checkpoint.mjs', ['--id', id, '--init', '--units', units], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /files, locks, and commands must exactly match/);
  });

  it('rejects refactor batches that do not exactly cover selected opportunities', () => {
    const created = runScript('change-new.mjs', ['--title', 'Selection mismatch', '--class', 'refactor'], cwd);
    const { id } = JSON.parse(created.stdout);
    const changeDir = path.join(cwd, '.changes', 'active', id);
    fs.writeFileSync(path.join(changeDir, 'refactor.md'), [
      ...completedAuditLines(),
      ...selectedOpportunityLines(),
      '## Selection gate',
      '**User response (verbatim):** Execute RF-001',
      '**Selected IDs:** `["RF-001"]`',
      '**Selection gate:** approved-for-exact-IDs',
      '| Unit ID | Selected IDs | Editable files | Locked test files | Baseline command | Final command |',
      '|---|---|---|---|---|---|',
      '| B-001 | `["RF-002"]` | `["src/value.mjs"]` | `[]` | `node --check src/value.mjs` | `node --check src/value.mjs` |',
      '### B-001 - Wrong opportunity',
      '',
    ].join('\n'));
    const result = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'refactor', '--approve'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /assign every selected RF ID exactly once/);
  });

  it('rejects implementation contracts changed after upstream approval', () => {
    const created = runScript('change-new.mjs', ['--title', 'Approved contract binding', '--class', 'refactor'], cwd);
    const { id } = JSON.parse(created.stdout);
    const changeDir = path.join(cwd, '.changes', 'active', id);
    const customManifest = readManifest(id, cwd);
    customManifest.artifacts.refactor = 'cleanup-audit.md';
    writeManifest(id, customManifest, cwd);
    const artifact = path.join(changeDir, 'cleanup-audit.md');
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'src', 'value.mjs'), 'export const value = 1;\n');
    fs.writeFileSync(artifact, [
      ...completedAuditLines(),
      ...selectedOpportunityLines(),
      '## Selection gate',
      '**User response (verbatim):** Execute RF-001',
      '**Selected IDs:** `["RF-001"]`',
      '**Selection gate:** approved-for-exact-IDs',
      '| Unit ID | Selected IDs | Editable files | Locked test files | Baseline command | Final command |',
      '|---|---|---|---|---|---|',
      '| B-001 | `["RF-001"]` | `["src/value.mjs"]` | `[]` | `node --check src/value.mjs` | `node --check src/value.mjs` |',
      '### B-001 - Cleanup',
      '',
    ].join('\n'));
    assert.equal(runScript('manifest-gate.mjs', ['--id', id, '--gate', 'refactor', '--approve'], cwd).status, 0);
    const units = path.join('.changes', 'active', id, 'implementation-units.json');
    fs.writeFileSync(path.join(cwd, units), `${JSON.stringify([{
      id: 'B-001', files: ['src/value.mjs'], lockedTestFiles: [],
      baselineCommand: 'node --check src/value.mjs', finalCommand: 'node --check src/value.mjs',
    }])}\n`);
    fs.writeFileSync(artifact, fs.readFileSync(artifact, 'utf8').replace('**Status:** selected', '**Status:** complete'));
    assert.equal(runScript('implementation-checkpoint.mjs', ['--id', id, '--init', '--units', units], cwd).status, 0);

    fs.writeFileSync(artifact, fs.readFileSync(artifact, 'utf8').replace(
      'the exported value and module side effects remain unchanged',
      'the opportunity has been semantically redefined after approval',
    ));
    const result = runScript('implementation-checkpoint.mjs', ['--id', id, '--status'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /differs from the upstream gate-approved artifact/);
  });
});

describe('kickback flow', () => {
  let cwd;
  const id = '2026-07-20-kickback-flow';

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-kickback-'));
    initializeGit(cwd);
    writeManifest(id, {
      id,
      title: 'Kickback flow',
      class: 'feature',
      stage: 'plan',
      gates: {
        architect: 'approved',
        specify: 'approved',
        plan: 'pending',
        implement: 'pending',
        docs: 'pending',
      },
      artifacts: {
        architecture: 'architecture.md',
        decisions: 'decisions.md',
        plan: 'plan.md',
      },
      context_targets: ['CONTEXT.md'],
      kickbacks: [],
    }, cwd);

    const planPath = path.join(cwd, '.changes', 'active', id, 'plan.md');
    fs.writeFileSync(planPath, '> **Checkpoint unit:** S-001\n> **Editable files:** `["src/value.mjs"]`\n> **Locked test files:** `[]`\n> **Baseline command:** `node --check src/value.mjs`\n> **Final command:** `node --check src/value.mjs`\n- [x] completed task\n- [ ] remaining task\n');
    const approval = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'plan', '--approve'], cwd);
    assert.equal(approval.status, 0, approval.stderr);
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('returns through specify and plan before implementation resumes', () => {
    const kickback = runScript('kickback-log.mjs', [
      '--id', id,
      '--type', 'defect',
      '--stage', 'implement',
      '--missed', 'Missing error behavior',
    ], cwd);
    assert.equal(kickback.status, 0, kickback.stderr);

    let manifest = readManifest(id, cwd);
    assert.equal(manifest.stage, 'specify');
    assert.equal(manifest.gates.architect, 'approved');
    assert.equal(manifest.gates.specify, 'pending');
    assert.equal(manifest.gates.plan, 'pending');
    assert.equal(manifest.gates.implement, 'pending');
    assert.equal(manifest.gates.docs, 'pending');
    assert.equal(manifest.kickbacks[0].stage, 'implement');
    assert.equal(manifest.kickbacks[0].resolution, '');

    const specifyApproval = runScript('manifest-gate.mjs', [
      '--id', id,
      '--gate', 'specify',
      '--approve',
    ], cwd);
    assert.equal(specifyApproval.status, 1);
    assert.match(specifyApproval.stderr, /unresolved kickback/);

    manifest.kickbacks[0].resolution = 'Return a typed domain error for missing input.';
    writeManifest(id, manifest, cwd);
    const resolvedSpecifyApproval = runScript('manifest-gate.mjs', [
      '--id', id,
      '--gate', 'specify',
      '--approve',
    ], cwd);
    assert.equal(resolvedSpecifyApproval.status, 0, resolvedSpecifyApproval.stderr);
    manifest = readManifest(id, cwd);
    assert.equal(manifest.stage, 'plan');

    const planApproval = runScript('manifest-gate.mjs', [
      '--id', id,
      '--gate', 'plan',
      '--approve',
    ], cwd);
    assert.equal(planApproval.status, 0, planApproval.stderr);
    manifest = readManifest(id, cwd);
    assert.equal(manifest.stage, 'implement');

    const planPath = path.join(cwd, '.changes', 'active', id, 'plan.md');
    assert.equal(fs.readFileSync(planPath, 'utf8'), '> **Checkpoint unit:** S-001\n> **Editable files:** `["src/value.mjs"]`\n> **Locked test files:** `[]`\n> **Baseline command:** `node --check src/value.mjs`\n> **Final command:** `node --check src/value.mjs`\n- [x] completed task\n- [ ] remaining task\n');
  });

  it('invalidates old checkpoint epochs and supports archived reset after reapproval', () => {
    fs.mkdirSync(path.join(cwd, 'src'));
    fs.writeFileSync(path.join(cwd, 'src', 'value.mjs'), 'export const value = 1;\n');
    const units = path.join('.changes', 'active', id, 'implementation-units.json');
    fs.writeFileSync(path.join(cwd, units), `${JSON.stringify([{
      id: 'S-001', files: ['src/value.mjs'], lockedTestFiles: [],
      baselineCommand: 'node --check src/value.mjs', finalCommand: 'node --check src/value.mjs',
    }])}\n`);
    let result = runScript('implementation-checkpoint.mjs', ['--id', id, '--init', '--units', units], cwd);
    assert.equal(result.status, 0, result.stderr);

    result = runScript('kickback-log.mjs', [
      '--id', id, '--type', 'amendment', '--stage', 'implement', '--missed', 'Updated requirement',
    ], cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readManifest(id, cwd).checkpoint_epoch, 1);
    result = runScript('implementation-checkpoint.mjs', ['--id', id, '--status'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /state epoch 0 is stale/);

    const manifest = readManifest(id, cwd);
    manifest.kickbacks[0].resolution = 'The amended plan now captures the updated requirement.';
    writeManifest(id, manifest, cwd);
    assert.equal(runScript('manifest-gate.mjs', ['--id', id, '--gate', 'specify', '--approve'], cwd).status, 0);
    assert.equal(runScript('manifest-gate.mjs', ['--id', id, '--gate', 'plan', '--approve'], cwd).status, 0);

    result = runScript('implementation-checkpoint.mjs', ['--id', id, '--reset', '--units', units], cwd);
    assert.equal(result.status, 0, result.stderr);
    const state = JSON.parse(fs.readFileSync(path.join(cwd, '.changes', 'active', id, 'implementation-state.json'), 'utf8'));
    assert.equal(state.checkpointEpoch, 1);
    assert.equal(state.reset, true);
    assert.equal(fs.readdirSync(path.join(cwd, '.changes', 'active', id, 'checkpoint-history')).length, 1);
  });

  it('revokes approved implementation and docs gates on kickback', () => {
    const manifest = readManifest(id, cwd);
    manifest.gates.implement = 'approved';
    manifest.gates.docs = 'approved';
    manifest.stage = 'done';
    writeManifest(id, manifest, cwd);
    const result = runScript('kickback-log.mjs', [
      '--id', id, '--type', 'defect', '--stage', 'implement', '--missed', 'Late contract defect',
    ], cwd);
    assert.equal(result.status, 0, result.stderr);
    const reset = readManifest(id, cwd);
    assert.equal(reset.stage, 'specify');
    assert.equal(reset.gates.implement, 'pending');
    assert.equal(reset.gates.docs, 'pending');
    assert.equal(reset.implementation_contract_digest, undefined);
  });
});
