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
