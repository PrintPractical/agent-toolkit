import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readManifest, writeManifest } from '../lib/index.mjs';

const scripts = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
function run(script, args, cwd) { return spawnSync(process.execPath, [path.join(scripts, script), ...args], { cwd, encoding: 'utf8' }); }
function context(cwd) {
  const contextPath = path.join(cwd, 'CONTEXT.md');
  fs.writeFileSync(contextPath, `# Context\n\nProvenance: validated-at: ${requireHead(cwd)}\n`);
  spawnSync('git', ['add', 'CONTEXT.md'], { cwd });
  spawnSync('git', ['commit', '-m', 'reconcile context'], { cwd });
  fs.writeFileSync(contextPath, `# Context\n\nProvenance: validated-at: ${requireHead(cwd)}\n`);
}
function implementationEvidence(id, cwd) {
  fs.writeFileSync(path.join(cwd, '.changes', 'active', id, 'implementation.md'), [
    '## Completed work', '- completed', '## Verification',
    '| Kind | Command | Result | Evidence |', '|---|---|---|---|', '| tests | `true` | pass | green |',
    '**Context verification:** pass - reconciled', '## Approval evidence', '**User response (verbatim):** approve',
  ].join('\n'));
}
function auditOnlyEvidence(id, cwd) {
  fs.writeFileSync(path.join(cwd, '.changes', 'active', id, 'refactor.md'), [
    '## Ranked opportunities', '**Audit conclusion:** no-actionable-opportunities',
    '**User response (verbatim):** audit-only',
  ].join('\n'));
}
function requireHead(cwd) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  return result.stdout.trim();
}
function git(cwd) {
  spawnSync('git', ['init'], { cwd });
  spawnSync('git', ['config', 'user.email', 'tests@example.com'], { cwd });
  spawnSync('git', ['config', 'user.name', 'Tests'], { cwd });
  fs.writeFileSync(path.join(cwd, 'seed'), 'seed');
  spawnSync('git', ['add', '.'], { cwd });
  spawnSync('git', ['commit', '-m', 'seed'], { cwd });
}
describe('end-to-end closure', () => {
  let cwd;
  beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-life-')); git(cwd); context(cwd); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  for (const cls of ['bug', 'small']) it(`${cls} follows direct triage closure`, () => {
    const created = run('change-new.mjs', ['--title', `${cls} closure`, '--class', cls], cwd);
    assert.equal(created.status, 0, created.stderr);
     const { id } = JSON.parse(created.stdout);
     assert.equal(readManifest(id, cwd).phase, 'implement');
     implementationEvidence(id, cwd);
    assert.equal(run('manifest-approval.mjs', ['--id', id, '--approval', 'implement', '--approve'], cwd).status, 0);
    assert.equal(readManifest(id, cwd).phase, 'archive-ready');
    const archive = run('change-archive.mjs', ['--id', id], cwd);
    assert.equal(archive.status, 0, archive.stderr);
    assert.ok(fs.existsSync(path.join(cwd, '.changes', 'archive', `${id}.zip`)));
    assert.ok(!fs.existsSync(path.join(cwd, '.changes', 'active', id)));
  });

  it('closes an audit-only refactor without implementation or docs', () => {
    const created = run('change-new.mjs', ['--title', 'audit closure', '--class', 'refactor', '--mode', 'audit-only'], cwd);
    const { id } = JSON.parse(created.stdout);
    auditOnlyEvidence(id, cwd);
    assert.equal(run('manifest-approval.mjs', ['--id', id, '--approval', 'refactor', '--approve'], cwd).status, 0);
    assert.equal(readManifest(id, cwd).phase, 'archive-ready');
    assert.equal(run('change-archive.mjs', ['--id', id], cwd).status, 0);
  });

  it('requires a reasoned cancellation archive', () => {
    const created = run('change-new.mjs', ['--title', 'cancel closure'], cwd);
    const { id } = JSON.parse(created.stdout);
    assert.equal(run('change-archive.mjs', ['--id', id], cwd).status, 1);
    assert.equal(run('change-archive.mjs', ['--id', id, '--cancel', '--reason', 'Superseded by product decision'], cwd).status, 0);
  });
});
