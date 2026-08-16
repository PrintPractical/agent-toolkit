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
});
