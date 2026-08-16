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
  const specifyCycle = `specify-${readManifest(id, cwd).review_epochs?.specify || 1}`;
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
    '## Review Cycle Reference', `Cycle: ${specifyCycle}`,
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'plan.md'), [
    '## Traceability check', '| AC ID | Task(s) | Firm-seam test task |',
    '|---|---|---|', '| none | n/a | n/a |',
  ].join('\n'));
}

function recordEmptyCycle(id, phase, cycle, cwd) {
  const audit = runScript('review-log.mjs', [
    'record', '--id', id, '--phase', phase, '--cycle', cycle, '--role', 'auditor',
    '--reviewer', `${phase}-auditor`, '--verdict', 'approved',
  ], cwd);
  assert.equal(audit.status, 0, audit.stderr);
  const verify = runScript('review-log.mjs', [
    'record', '--id', id, '--phase', phase, '--cycle', cycle, '--role', 'verifier',
    '--reviewer', `${phase}-verifier`, '--verdict', 'approved',
  ], cwd);
  assert.equal(verify.status, 0, verify.stderr);
}

describe('CLI help', () => {
  const scripts = [
    'change-new.mjs',
    'change-status.mjs',
    'change-archive.mjs',
    'change-recover.mjs',
    'manifest-approval.mjs',
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
      phase: 'implement',
      approvals: {
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
       '--phase', 'implement',
      '--missed', 'Missing error behavior',
    ], cwd);
    assert.equal(kickback.status, 0, kickback.stderr);

    let manifest = readManifest(id, cwd);
    assert.equal(manifest.phase, 'specify');
    assert.equal(manifest.approvals.architect, 'approved');
    assert.equal(manifest.approvals.specify, 'pending');
    assert.equal(manifest.approvals.plan, 'pending');
    assert.equal(manifest.approvals.implement, 'pending');
    assert.equal(manifest.review_epochs.specify, 2);
    assert.equal(manifest.review_epochs.implement, 2);
    assert.equal(manifest.kickbacks[0].phase, 'implement');
    assert.equal(manifest.kickbacks[0].resolution, '');
    assert.equal(manifest.kickbacks[0].invalidated_approvals, 'specify,plan,implement,docs');

    writeApprovedArtifacts(id, cwd);
    recordEmptyCycle(id, 'specify', 'specify-2', cwd);
    const resolved = runScript('kickback-log.mjs', [
      '--id', id, '--resolve', '1', '--resolution', 'Updated the specification',
    ], cwd);
    assert.equal(resolved.status, 0, resolved.stderr);

    const specifyApproval = runScript('manifest-approval.mjs', [
      '--id', id,
      '--approval', 'specify',
      '--approve',
    ], cwd);
    assert.equal(specifyApproval.status, 0, specifyApproval.stderr);
    manifest = readManifest(id, cwd);
    assert.equal(manifest.phase, 'plan');

    const planApproval = runScript('manifest-approval.mjs', [
      '--id', id,
      '--approval', 'plan',
      '--approve',
    ], cwd);
    assert.equal(planApproval.status, 0, planApproval.stderr);
    manifest = readManifest(id, cwd);
    assert.equal(manifest.phase, 'implement');

  });

  it('resets only plan for a plan-impacting kickback', () => {
    const kickback = runScript('kickback-log.mjs', [
      '--id', id, '--type', 'defect', '--phase', 'implement', '--impact', 'plan',
      '--missed', 'Missing checklist task',
    ], cwd);
    assert.equal(kickback.status, 0, kickback.stderr);

    const manifest = readManifest(id, cwd);
    assert.equal(manifest.phase, 'plan');
    assert.equal(manifest.approvals.specify, 'approved');
    assert.equal(manifest.approvals.plan, 'pending');
    assert.equal(manifest.kickbacks[0].invalidated_approvals, 'plan,implement,docs');
  });

  it('refuses specify approval when the confirmation ledger is absent', () => {
    const manifest = readManifest(id, cwd);
    manifest.phase = 'specify';
    manifest.approvals.specify = 'pending';
    writeManifest(id, manifest, cwd);
    const res = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'specify', '--approve'], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /artifact validation failed/);
  });

  it('refuses architect approval when the architecture confirmation ledger is absent', () => {
    const manifest = readManifest(id, cwd);
    manifest.phase = 'architect';
    manifest.approvals.architect = 'pending';
    writeManifest(id, manifest, cwd);
    const res = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'architect', '--approve'], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /artifact validation failed/);
  });
});

describe('implement approval review enforcement', () => {
  let cwd;
  const id = '2026-07-25-review-approval';

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-reviewgate-'));
    writeManifest(id, {
      id, title: 'Review approval', class: 'feature', phase: 'implement',
      approvals: { architect: 'approved', specify: 'approved', plan: 'approved', implement: 'pending', docs: 'pending' },
      context_targets: ['CONTEXT.md'], kickbacks: [],
    }, cwd);
  });

  afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

  it('blocks the implement approval until an independent review is approved', () => {
    const blocked = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'implement', '--approve'], cwd);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /independent review not satisfied/);

    const finding = JSON.stringify({
      id: 'RV-001', severity: 'major', category: 'idioms', location: 'a.rs:1',
      impact: 'violates the language pattern', alternative: 'use the established idiom',
    });
    runScript('review-log.mjs', ['record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested', '--finding', finding], cwd);
    runScript('review-log.mjs', ['record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'approved', '--resolution', 'RV-001=resolved'], cwd);

    const ok = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'implement', '--approve'], cwd);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(readManifest(id, cwd).approvals.implement, 'approved');
  });

  it('blocks docs before implement', () => {
    const res = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'docs', '--approve'], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /before implement is approved/);
  });
});

describe('architect and specify approval review enforcement', () => {
  let cwd;
  const id = '2026-08-11-spine-review-approval';

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-spine-review-'));
    writeManifest(id, {
      id, title: 'Spine review', class: 'feature', phase: 'architect',
      approvals: { architect: 'pending', specify: 'pending', plan: 'pending', implement: 'pending', docs: 'pending' },
      artifacts: { architecture: 'architecture.md', decisions: 'decisions.md', plan: 'plan.md' },
      context_targets: [], kickbacks: [],
    }, cwd);
    writeApprovedArtifacts(id, cwd);
  });

  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('requires bounded cycles for feature architect and specify approvals', () => {
    const blockedArchitect = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'architect', '--approve'], cwd);
    assert.equal(blockedArchitect.status, 1);
    assert.match(blockedArchitect.stderr, /independent review not satisfied/);

    recordEmptyCycle(id, 'architect', 'architect-1', cwd);
    const architect = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'architect', '--approve'], cwd);
    assert.equal(architect.status, 0, architect.stderr);

    const blockedSpecify = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'specify', '--approve'], cwd);
    assert.equal(blockedSpecify.status, 1);
    recordEmptyCycle(id, 'specify', 'specify-1', cwd);
    const specify = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'specify', '--approve'], cwd);
    assert.equal(specify.status, 0, specify.stderr);
  });

  it('applies architect review to epics but exempts bug changes', () => {
    let manifest = readManifest(id, cwd);
    manifest.class = 'epic';
    manifest.approvals = { architect: 'pending', specify: 'pending', docs: 'pending' };
    manifest.children = [];
    writeManifest(id, manifest, cwd);
    const epic = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'architect', '--approve'], cwd);
    assert.equal(epic.status, 1);
    assert.match(epic.stderr, /independent review not satisfied/);

    manifest = readManifest(id, cwd);
    manifest.class = 'bug';
    manifest.phase = 'implement';
    manifest.approvals = { implement: 'pending', docs: 'pending' };
    delete manifest.children;
    writeManifest(id, manifest, cwd);
    const bug = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'implement', '--approve'], cwd);
    assert.equal(bug.status, 0, bug.stderr);
  });
});

describe('change-new refactor class', () => {
  let cwd;
  beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-newrefactor-')); });
  afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

  it('creates a refactor change at the refactor phase with the right approvals', () => {
    const res = runScript('change-new.mjs', ['--title', 'Clean up parser', '--class', 'refactor'], cwd);
    assert.equal(res.status, 0, res.stderr);
    const { id } = JSON.parse(res.stdout);
    const m = readManifest(id, cwd);
    assert.equal(m.class, 'refactor');
    assert.equal(m.phase, 'refactor');
    assert.deepEqual(Object.keys(m.approvals).sort(), ['docs', 'implement', 'refactor']);
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

describe('refactor class approvals', () => {
  let cwd;
  const id = '2026-07-25-refactor-class';

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-refactorclass-'));
    writeManifest(id, {
      id, title: 'Refactor class', class: 'refactor', phase: 'refactor',
      approvals: { refactor: 'pending', implement: 'pending', docs: 'pending' },
      context_targets: ['CONTEXT.md'], kickbacks: [],
    }, cwd);
  });

  afterEach(() => { fs.rmSync(cwd, { recursive: true, force: true }); });

  it('rejects spec-spine approvals that do not apply to a refactor', () => {
    const res = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'plan', '--approve'], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /does not apply to a 'refactor'/);
  });

  it('advances refactor → implement on selection approval, then review-approves implement', () => {
    const sel = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'refactor', '--approve'], cwd);
    assert.equal(sel.status, 0, sel.stderr);
    assert.equal(readManifest(id, cwd).phase, 'implement');

    const blocked = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'implement', '--approve'], cwd);
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /no refactor review recorded/);

    const finding = JSON.stringify({
      id: 'RV-001', severity: 'major', category: 'maintainability', location: 'x.rs:1',
      impact: 'duplicates domain behavior', alternative: 'centralize the behavior',
    });
    runScript('review-log.mjs', ['record', '--id', id, '--phase', 'refactor', '--cycle', 'refactor-1', '--role', 'auditor',
      '--reviewer', 'r-a', '--verdict', 'changes-requested', '--finding', finding], cwd);
    runScript('review-log.mjs', ['record', '--id', id, '--phase', 'refactor', '--cycle', 'refactor-1', '--role', 'verifier',
      '--reviewer', 'r-b', '--verdict', 'approved', '--resolution', 'RV-001=resolved'], cwd);

    const ok = runScript('manifest-approval.mjs', ['--id', id, '--approval', 'implement', '--approve'], cwd);
    assert.equal(ok.status, 0, ok.stderr);
  });
});
