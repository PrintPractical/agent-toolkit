import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeManifest } from '../lib/index.mjs';

const scriptsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

describe('traceability-sync.mjs', () => {
  const workspaces = [];

  afterEach(() => {
    while (workspaces.length) fs.rmSync(workspaces.pop(), { recursive: true, force: true });
  });

  it('writes and then verifies the derived traceability summary', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-traceability-'));
    workspaces.push(cwd);
    const id = '2026-08-20-traceability';
    writeManifest(id, {
      id, title: 'Traceability', class: 'feature', phase: 'plan',
      approvals: { architect: 'approved', specify: 'approved', plan: 'pending', implement: 'pending' },
      artifacts: { architecture: 'architecture.md', decisions: 'decisions.md', plan: 'plan.md' },
      context_targets: [], kickbacks: [],
    }, cwd);
    const dir = path.join(cwd, '.changes', 'active', id);
    fs.writeFileSync(path.join(dir, 'architecture.md'), [
      '## Seams', '### Seam: API [id: SEAM-API] [firmness: firm]', '- [AC-API] Returns a validated response.',
      '### Seam: UI [id: SEAM-UI] [firmness: soft]', '- [AC-UI] Renders the validated response.',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'decisions.md'), '## Acceptance Criteria Confirmed\n');
    fs.writeFileSync(path.join(dir, 'plan.md'), [
      '## Traceability check', '<!-- traceability:start -->', '- stale', '<!-- traceability:end -->',
      '- [ ] [T-001] Run API baseline test [AC-API] [test: baseline] [seam: SEAM-API] [firmness: firm]',
      '- [ ] [T-002] Implement UI outcome [AC-UI]',
    ].join('\n'));

    const run = args => spawnSync(process.execPath, [path.join(scriptsDir, 'traceability-sync.mjs'), '--id', id, ...args], { cwd, encoding: 'utf8' });
    assert.equal(run([]).status, 1);
    const write = run(['--write']);
    assert.equal(write.status, 0, write.stderr);
    assert.equal(JSON.parse(write.stdout).written, true);
    const check = run([]);
    assert.equal(check.status, 0, check.stderr);
    assert.match(fs.readFileSync(path.join(dir, 'plan.md'), 'utf8'), /`AC-API` -> tasks: `T-001`; firm-seam tests: `T-001`/);
    assert.match(fs.readFileSync(path.join(dir, 'plan.md'), 'utf8'), /`AC-UI` -> tasks: `T-002`; firm-seam tests: none/);
  });
});
