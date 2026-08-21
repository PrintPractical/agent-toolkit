import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeManifest, readManifest, epicStatus, nextSkill } from '../lib/index.mjs';

const scripts = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
function run(script, args, cwd) { return spawnSync(process.execPath, [path.join(scripts, script), ...args], { cwd, encoding: 'utf8' }); }
function approvedEpic(id) {
  return { id, title: 'Epic', class: 'epic', phase: 'specify', children: [], approvals: { architect: 'approved', specify: 'approved', docs: 'pending' }, context_targets: [], kickbacks: [], review_epochs: {} };
}

describe('epic lifecycle', () => {
  let cwd;
  beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-epic-')); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('rejects splitting before contracts are approved', () => {
    const id = '2026-01-01-epic';
    writeManifest(id, { ...approvedEpic(id), phase: 'architect', approvals: { architect: 'pending', specify: 'pending', docs: 'pending' } }, cwd);
    const result = run('epic-split.mjs', ['--epic', id, '--children', '[{"title":"child"}]'], cwd);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must be in specify/);
  });

  it('splits an approved epic into a complete protected child set', () => {
    const id = '2026-01-01-epic';
    writeManifest(id, approvedEpic(id), cwd);
    const result = run('epic-split.mjs', ['--epic', id, '--children', '[{"title":"feature child"},{"title":"bug child","class":"bug"}]'], cwd);
    assert.equal(result.status, 0, result.stderr);
    const epic = readManifest(id, cwd);
    assert.equal(epic.phase, 'decomposed');
    assert.equal(epic.children.length, 2);
    assert.equal(readManifest(epic.children[1], cwd).phase, 'implement');
    assert.equal(run('epic-split.mjs', ['--epic', id, '--children', '[{"title":"another"}]'], cwd).status, 1);
  });

  it('reports missing children instead of treating them as delivered', () => {
    const status = epicStatus({ children: ['lost-child'] }, cwd);
    assert.equal(status.missing, 1);
    assert.equal(status.ready, 0);
  });

  it('routes archive-ready epics to coordinated archive', () => {
    assert.equal(nextSkill({ class: 'epic', phase: 'archive-ready', approvals: {}, children: [] }), 'change-archive');
  });

  it('holds children for coordinated cancellation and archives them with their epic', () => {
    const id = '2026-01-02-cancel-epic';
    const childId = '2026-01-02-cancel-child';
    writeManifest(id, { ...approvedEpic(id), phase: 'decomposed', children: [childId] }, cwd);
    writeManifest(childId, {
      id: childId, title: 'Child', class: 'bug', parent: id, phase: 'implement',
      approvals: { implement: 'pending' }, context_targets: ['CONTEXT.md'], kickbacks: [],
    }, cwd);

    const childCancel = run('change-archive.mjs', ['--id', childId, '--cancel', '--reason', 'No longer needed'], cwd);
    assert.equal(childCancel.status, 1);
    assert.match(childCancel.stderr, /must be archived or cancelled through its parent/);

    const cancelled = run('change-archive.mjs', ['--id', id, '--cancel', '--reason', 'Programme cancelled'], cwd);
    assert.equal(cancelled.status, 0, cancelled.stderr);
    assert.ok(fs.existsSync(path.join(cwd, '.changes', 'archive', `${id}.zip`)));
    assert.ok(fs.existsSync(path.join(cwd, '.changes', 'archive', `${childId}.zip`)));
  });

  it('routes ready children through docs approval before coordinated archival', () => {
    const id = '2026-01-03-ready-epic';
    const childId = '2026-01-03-ready-child';
    writeManifest(id, { ...approvedEpic(id), phase: 'decomposed', children: [childId], artifacts: { epic_docs: 'epic-docs.md' }, context_targets: ['CONTEXT.md'] }, cwd);
    writeManifest(childId, {
      id: childId, title: 'Child', class: 'bug', parent: id, phase: 'archive-ready',
      approvals: { implement: 'approved' }, context_targets: ['CONTEXT.md'], kickbacks: [],
    }, cwd);
    fs.writeFileSync(path.join(cwd, 'CONTEXT.md'), '# Context\n\nProvenance: validated-at: <not-in-git-repo>\n');
    fs.writeFileSync(path.join(cwd, '.changes', 'active', id, 'epic-docs.md'), [
      '## Context reconciliation', '| CONTEXT.md | Result |', '|---|---|', '| CONTEXT.md | pass |', '## Independent docs review', '**Docs reviewer verdict:** approved',
      '## Approval evidence', '**User response (verbatim):** approve docs',
    ].join('\n'));

    assert.match(nextSkill(readManifest(id, cwd), cwd), /epic \(docs reconciliation\)/);
    const approval = run('manifest-approval.mjs', ['--id', id, '--approval', 'docs', '--approve'], cwd);
    assert.equal(approval.status, 0, approval.stderr);
    const archive = run('change-archive.mjs', ['--id', id], cwd);
    assert.equal(archive.status, 0, archive.stderr);
  });

  it('reopens the epic and all children when a child kicks back an epic contract', () => {
    const id = '2026-01-04-kickback-epic';
    const childId = '2026-01-04-kickback-child';
    writeManifest(id, { ...approvedEpic(id), phase: 'decomposed', children: [childId] }, cwd);
    writeManifest(childId, {
      id: childId, title: 'Child', class: 'feature', parent: id, phase: 'implement',
      approvals: { architect: 'approved', specify: 'approved', plan: 'approved', implement: 'pending' },
      context_targets: ['CONTEXT.md'], kickbacks: [],
    }, cwd);

    const result = run('kickback-log.mjs', ['--id', childId, '--type', 'defect', '--phase', 'implement', '--impact', 'epic-specify', '--missed', 'Shared contract is invalid'], cwd);
    assert.equal(result.status, 0, result.stderr);
    const parent = readManifest(id, cwd);
    const child = readManifest(childId, cwd);
    assert.equal(parent.phase, 'specify');
    assert.equal(parent.approvals.specify, 'pending');
    assert.equal(parent.approvals.docs, 'pending');
    assert.equal(child.phase, 'architect');
    assert.deepEqual(child.approvals, { architect: 'pending', specify: 'pending', plan: 'pending', implement: 'pending' });
  });
});
