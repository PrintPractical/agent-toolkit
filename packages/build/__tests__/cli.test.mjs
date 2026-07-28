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
    assert.equal(manifest.kickbacks[0].stage, 'implement');
    assert.equal(manifest.kickbacks[0].resolution, '');

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

    const planPath = path.join(cwd, '.changes', 'active', id, 'plan.md');
    assert.equal(fs.readFileSync(planPath, 'utf8'), '- [x] completed task\n- [ ] remaining task\n');
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

    runScript('review-log.mjs', ['record', '--id', id, '--stage', 'implement', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested', '--finding', 'a.rs:1 [idioms] x'], cwd);
    runScript('review-log.mjs', ['record', '--id', id, '--stage', 'implement', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'approved'], cwd);

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

    runScript('review-log.mjs', ['record', '--id', id, '--stage', 'refactor', '--role', 'auditor',
      '--reviewer', 'r-a', '--verdict', 'changes-requested', '--finding', 'x.rs:1 [structure] y'], cwd);
    runScript('review-log.mjs', ['record', '--id', id, '--stage', 'refactor', '--role', 'verifier',
      '--reviewer', 'r-b', '--verdict', 'approved'], cwd);

    const ok = runScript('manifest-gate.mjs', ['--id', id, '--gate', 'implement', '--approve'], cwd);
    assert.equal(ok.status, 0, ok.stderr);
  });
});
