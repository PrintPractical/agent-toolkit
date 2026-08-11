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

function writeApprovedArtifacts(id, cwd) {
  const dir = path.join(cwd, '.changes', 'active', id);
  fs.writeFileSync(path.join(dir, 'architecture.md'), [
    '## Summary', 'x', '## Architecture Confirmation Ledger',
    '| ID | Material topic | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
    '|---|---|---|---|---|---|---|',
    '| A-001 | q | recommendation | none | accept | confirmed | yes |',
    '## Architectural Decisions', 'x', '## Seams', 'x',
    '## Validity Check Results', '**Status:** passed',
    '## Review Cycle Reference', 'Cycle: architect-1',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'decisions.md'), [
    '## Confirmation Ledger',
    '| ID | Material question | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
    '|---|---|---|---|---|---|---|',
    '| D-001 | q | recommendation | none | accept | confirmed | yes |',
    '## Interface Changes', 'None.', '## Decision Log', 'None.', '## Dry-Run Findings', '**Dry-run status:** clean',
    '## Review Cycle Reference', 'Cycle: specify-1',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'plan.md'), [
    '## Traceability check', '| AC ID | Task(s) | Firm-seam test task |',
    '|---|---|---|', '| none | n/a | n/a |',
  ].join('\n'));
}

function recordEmptyCycle(id, stage, cycle, cwd) {
  const audit = runScript('review-log.mjs', [
    'record', '--id', id, '--stage', stage, '--cycle', cycle, '--role', 'auditor',
    '--reviewer', `${stage}-auditor`, '--verdict', 'approved',
  ], cwd);
  assert.equal(audit.status, 0, audit.stderr);
  const verify = runScript('review-log.mjs', [
    'record', '--id', id, '--stage', stage, '--cycle', cycle, '--role', 'verifier',
    '--reviewer', `${stage}-verifier`, '--verdict', 'approved',
  ], cwd);
  assert.equal(verify.status, 0, verify.stderr);
}

describe('CLI help', () => {
  const scripts = [
    'change-new.mjs',
    'change-status.mjs',
    'change-archive.mjs',
    'manifest-gate.mjs',
    'artifact-validate.mjs',
    'context-scaffold.mjs',
    'context-discover.mjs',
    'context-verify.mjs',
    'kickback-log.mjs',
    'epic-split.mjs',
    'review-log.mjs',
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

describe('kickback flow', () => {
  let cwd;
  const id = '2026-07-20-kickback-flow';

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-kickback-'));
    writeManifest(id, {
      id,
      title: 'Kickback flow',
      class: 'feature',
      stage: 'implement',
      gates: {
        architect: 'approved',
        specify: 'approved',
        plan: 'approved',
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
    fs.writeFileSync(planPath, '- [x] completed task\n- [ ] remaining task\n');
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('returns through specify and plan before implementation resumes for a specify-impacting kickback', () => {
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
    assert.equal(manifest.kickbacks[0].stage, 'implement');
    assert.equal(manifest.kickbacks[0].resolution, '');
    assert.equal(manifest.kickbacks[0].invalidated_gates, 'specify,plan');

    writeApprovedArtifacts(id, cwd);
    recordEmptyCycle(id, 'specify', 'specify-1', cwd);

    const specifyApproval = runScript('manifest-gate.mjs', [
      '--id', id,
      '--gate', 'specify',
      '--approve',
    ], cwd);
    assert.equal(specifyApproval.status, 0, specifyApproval.stderr);
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

  });

  it('resets only plan for a plan-impacting kickback', () => {
    const kickback = runScript('kickback-log.mjs', [
      '--id', id, '--type', 'defect', '--stage', 'implement', '--impact', 'plan',
      '--missed', 'Missing checklist task',
    ], cwd);
    assert.equal(kickback.status, 0, kickback.stderr);

    const manifest = readManifest(id, cwd);
    assert.equal(manifest.stage, 'plan');
    assert.equal(manifest.gates.specify, 'approved');
    assert.equal(manifest.gates.plan, 'pending');
    assert.equal(manifest.kickbacks[0].invalidated_gates, 'plan');
  });

  it('refuses specify approval when the confirmation ledger is absent', () => {
    const manifest = readManifest(id, cwd);
    manifest.stage = 'specify';
    manifest.gates.specify = 'pending';
    writeManifest(id, manifest, cwd);
    const res = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'specify', '--approve'], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /artifact validation failed/);
  });

  it('refuses architect approval when the architecture confirmation ledger is absent', () => {
    const manifest = readManifest(id, cwd);
    manifest.stage = 'architect';
    manifest.gates.architect = 'pending';
    writeManifest(id, manifest, cwd);
    const res = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'architect', '--approve'], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /artifact validation failed/);
  });
});

describe('implement gate review enforcement', () => {
  let cwd;
  const id = '2026-07-25-review-gate';

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-reviewgate-'));
    writeManifest(id, {
      id, title: 'Review gate', class: 'feature', stage: 'implement',
      gates: { architect: 'approved', specify: 'approved', plan: 'approved', implement: 'pending', docs: 'pending' },
      context_targets: ['CONTEXT.md'], kickbacks: [],
    }, cwd);
  });

  afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

  it('blocks the implement gate until an independent review is approved', () => {
    const blocked = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'implement', '--approve'], cwd);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /independent review not satisfied/);

    const finding = JSON.stringify({
      id: 'RV-001', severity: 'major', category: 'idioms', location: 'a.rs:1',
      impact: 'violates the language pattern', alternative: 'use the established idiom',
    });
    runScript('review-log.mjs', ['record', '--id', id, '--stage', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested', '--finding', finding], cwd);
    runScript('review-log.mjs', ['record', '--id', id, '--stage', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'approved', '--resolution', 'RV-001=resolved'], cwd);

    const ok = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'implement', '--approve'], cwd);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(readManifest(id, cwd).gates.implement, 'approved');
  });

  it('blocks docs before implement', () => {
    const res = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'docs', '--approve'], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /before the implement gate/);
  });
});

describe('architect and specify review enforcement', () => {
  let cwd;
  const id = '2026-08-11-spine-review-gate';

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-spine-review-'));
    writeManifest(id, {
      id, title: 'Spine review', class: 'feature', stage: 'architect',
      gates: { architect: 'pending', specify: 'pending', plan: 'pending', implement: 'pending', docs: 'pending' },
      artifacts: { architecture: 'architecture.md', decisions: 'decisions.md', plan: 'plan.md' },
      context_targets: [], kickbacks: [],
    }, cwd);
    writeApprovedArtifacts(id, cwd);
  });

  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('requires bounded cycles for feature architect and specify gates', () => {
    const blockedArchitect = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'architect', '--approve'], cwd);
    assert.equal(blockedArchitect.status, 1);
    assert.match(blockedArchitect.stderr, /independent review not satisfied/);

    recordEmptyCycle(id, 'architect', 'architect-1', cwd);
    const architect = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'architect', '--approve'], cwd);
    assert.equal(architect.status, 0, architect.stderr);

    const blockedSpecify = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'specify', '--approve'], cwd);
    assert.equal(blockedSpecify.status, 1);
    recordEmptyCycle(id, 'specify', 'specify-1', cwd);
    const specify = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'specify', '--approve'], cwd);
    assert.equal(specify.status, 0, specify.stderr);
  });

  it('applies architect review to epics but exempts bug changes', () => {
    let manifest = readManifest(id, cwd);
    manifest.class = 'epic';
    writeManifest(id, manifest, cwd);
    const epic = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'architect', '--approve'], cwd);
    assert.equal(epic.status, 1);
    assert.match(epic.stderr, /independent review not satisfied/);

    manifest = readManifest(id, cwd);
    manifest.class = 'bug';
    writeManifest(id, manifest, cwd);
    const bug = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'architect', '--approve'], cwd);
    assert.equal(bug.status, 0, bug.stderr);
  });
});

describe('change-new refactor class', () => {
  let cwd;
  beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-newrefactor-')); });
  afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

  it('creates a refactor change at the refactor stage with the right gates', () => {
    const res = runScript('change-new.mjs', ['--title', 'Clean up parser', '--class', 'refactor'], cwd);
    assert.equal(res.status, 0, res.stderr);
    const { id } = JSON.parse(res.stdout);
    const m = readManifest(id, cwd);
    assert.equal(m.class, 'refactor');
    assert.equal(m.stage, 'refactor');
    assert.deepEqual(Object.keys(m.gates).sort(), ['docs', 'implement', 'refactor']);
    assert.equal(m.refactor_mode, 'execute');
    assert.equal(m.artifacts.refactor, 'refactor.md');
  });

  it('rejects a refactor as an epic child', () => {
    const epic = runScript('change-new.mjs', ['--title', 'Big epic', '--class', 'epic'], cwd);
    const { id: epicId } = JSON.parse(epic.stdout);
    const res = runScript('change-new.mjs', ['--title', 'child', '--class', 'refactor', '--parent', epicId], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /cannot be a child of an epic/);
  });
});

describe('refactor class gating', () => {
  let cwd;
  const id = '2026-07-25-refactor-class';

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-refactorclass-'));
    writeManifest(id, {
      id, title: 'Refactor class', class: 'refactor', stage: 'refactor',
      gates: { refactor: 'pending', implement: 'pending', docs: 'pending' },
      context_targets: ['CONTEXT.md'], kickbacks: [],
    }, cwd);
  });

  afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

  it('rejects spec-spine gates that do not apply to a refactor', () => {
    const res = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'plan', '--approve'], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /does not apply to a 'refactor'/);
  });

  it('advances refactor → implement on selection approval, then review-gates implement', () => {
    const sel = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'refactor', '--approve'], cwd);
    assert.equal(sel.status, 0, sel.stderr);
    assert.equal(readManifest(id, cwd).stage, 'implement');

    const blocked = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'implement', '--approve'], cwd);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /stage refactor/);

    const finding = JSON.stringify({
      id: 'RV-001', severity: 'major', category: 'maintainability', location: 'x.rs:1',
      impact: 'duplicates domain behavior', alternative: 'centralize the behavior',
    });
    runScript('review-log.mjs', ['record', '--id', id, '--stage', 'refactor', '--cycle', 'refactor-1', '--role', 'auditor',
      '--reviewer', 'r-a', '--verdict', 'changes-requested', '--finding', finding], cwd);
    runScript('review-log.mjs', ['record', '--id', id, '--stage', 'refactor', '--cycle', 'refactor-1', '--role', 'verifier',
      '--reviewer', 'r-b', '--verdict', 'approved', '--resolution', 'RV-001=resolved'], cwd);

    const ok = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'implement', '--approve'], cwd);
    assert.equal(ok.status, 0, ok.stderr);
  });
});
