/**
 * Unit tests for epic functionality in packages/lib/index.mjs and related scripts.
 * Run with: node --test packages/build/__tests__/epic.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

import {
  readManifest,
  writeManifest,
  generateChangeId,
  addChildToEpic,
  epicStatus,
  nextSkill,
  epicNextAction,
  completeEpicIfDelivered,
} from '../lib/index.mjs';

const SCRIPTS_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function runScript(script, args, cwd) {
  return execSync(`node "${path.join(SCRIPTS_DIR, script)}" ${args}`, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).toString();
}

// ── epicNextAction ────────────────────────────────────────────────────────────

describe('epicNextAction', () => {
  it('returns architect action when architect approval is pending', () => {
    const m = { class: 'epic', phase: 'architect', children: [], approvals: { architect: 'pending' } };
    assert.ok(epicNextAction(m).includes('architect'));
  });

  it('returns specify action when architect approved but specify pending', () => {
    const m = { class: 'epic', phase: 'specify', children: [], approvals: { architect: 'approved', specify: 'pending' } };
    assert.ok(epicNextAction(m).includes('specify'));
  });

  it('returns decompose action when specify approved but no children', () => {
    const m = { class: 'epic', phase: 'specify', children: [], approvals: { architect: 'approved', specify: 'approved' } };
    const result = epicNextAction(m);
    assert.ok(result !== null);
    assert.ok(result.includes('epic-split') || result.includes('decompose'));
  });

  it('returns null when phase is done', () => {
    const m = { class: 'epic', phase: 'done', children: [], approvals: {} };
    assert.equal(epicNextAction(m), null);
  });
});

// ── nextSkill for epics ───────────────────────────────────────────────────────

describe('nextSkill (epic)', () => {
  it('returns architect for epic with pending architect approval', () => {
    const m = { class: 'epic', phase: 'architect', children: [], approvals: { architect: 'pending' } };
    const result = nextSkill(m);
    assert.ok(result !== null);
    assert.ok(result.includes('architect'));
  });

  it('returns specify for epic with architect approved but specify pending', () => {
    const m = { class: 'epic', phase: 'specify', children: [], approvals: { architect: 'approved', specify: 'pending' } };
    assert.ok(nextSkill(m).includes('specify'));
  });

  it('returns decompose when specify approved and no children', () => {
    const m = { class: 'epic', phase: 'specify', children: [], approvals: { architect: 'approved', specify: 'approved' } };
    const result = nextSkill(m);
    assert.ok(result !== null);
    assert.ok(result.includes('epic-split') || result.includes('decompose'));
  });

  it('returns null when epic phase is done', () => {
    const m = { class: 'epic', phase: 'done', children: [], approvals: {} };
    assert.equal(nextSkill(m), null);
  });
});

// ── addChildToEpic ────────────────────────────────────────────────────────────

describe('addChildToEpic', () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-epic-'));
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds a child ID to an epic manifest', () => {
    const epicId = '2026-01-01-my-epic';
    writeManifest(epicId, {
      id: epicId, title: 'My Epic', class: 'epic', phase: 'architect',
      children: [], approvals: {}, kickbacks: [],
    }, tmpDir);

    addChildToEpic(epicId, '2026-01-01-child-a', tmpDir);
    const epic = readManifest(epicId, tmpDir);
    assert.ok(epic.children.includes('2026-01-01-child-a'));
  });

  it('is idempotent — does not add duplicates', () => {
    const epicId = '2026-01-01-idempotent-epic';
    writeManifest(epicId, {
      id: epicId, title: 'Idempotent Epic', class: 'epic', phase: 'architect',
      children: ['2026-01-01-child-a'], approvals: {}, kickbacks: [],
    }, tmpDir);

    addChildToEpic(epicId, '2026-01-01-child-a', tmpDir);
    const epic = readManifest(epicId, tmpDir);
    assert.equal(epic.children.filter(c => c === '2026-01-01-child-a').length, 1);
  });

  it('throws if target is not an epic', () => {
    const featureId = '2026-01-01-not-epic';
    writeManifest(featureId, {
      id: featureId, title: 'Not Epic', class: 'feature', phase: 'architect',
      approvals: {}, kickbacks: [],
    }, tmpDir);

    assert.throws(
      () => addChildToEpic(featureId, '2026-01-01-child', tmpDir),
      /not an epic/
    );
  });
});

// ── epicStatus ────────────────────────────────────────────────────────────────

describe('epicStatus', () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-epic-status-'));
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns zeros for an epic with no children', () => {
    const epicManifest = { children: [] };
    const status = epicStatus(epicManifest, tmpDir);
    assert.equal(status.total, 0);
    assert.equal(status.done, 0);
  });

  it('counts children by phase correctly', () => {
    // Create child manifests
    writeManifest('2026-01-01-child-done', {
      id: '2026-01-01-child-done', title: 'Done child', class: 'feature',
      phase: 'done', approvals: {}, kickbacks: [],
    }, tmpDir);
    writeManifest('2026-01-01-child-impl', {
      id: '2026-01-01-child-impl', title: 'Impl child', class: 'feature',
      phase: 'implement', approvals: {}, kickbacks: [],
    }, tmpDir);
    writeManifest('2026-01-01-child-arch', {
      id: '2026-01-01-child-arch', title: 'Arch child', class: 'feature',
      phase: 'architect', approvals: {}, kickbacks: [],
    }, tmpDir);

    const epicManifest = {
      children: ['2026-01-01-child-done', '2026-01-01-child-impl', '2026-01-01-child-arch']
    };
    const status = epicStatus(epicManifest, tmpDir);

    assert.equal(status.total, 3);
    assert.equal(status.done, 1);
    assert.equal(status.inProgress, 1);
    assert.equal(status.pending, 1);
  });

  it('counts archived children (no active manifest) as done', () => {
    const epicManifest = { children: ['nonexistent-archived-child'] };
    const status = epicStatus(epicManifest, tmpDir);
    assert.equal(status.total, 1);
    assert.equal(status.done, 1);
  });

  it('marks a decomposed epic done when every child is delivered', () => {
    const epicId = '2026-01-01-delivered-epic';
    writeManifest('2026-01-01-delivered-child', {
      id: '2026-01-01-delivered-child', title: 'Delivered child', class: 'feature',
      phase: 'done', approvals: {}, kickbacks: [],
    }, tmpDir);
    writeManifest(epicId, {
      id: epicId, title: 'Delivered epic', class: 'epic', phase: 'decomposed',
      children: ['2026-01-01-delivered-child'], approvals: { architect: 'approved', specify: 'approved' }, kickbacks: [],
    }, tmpDir);

    const completed = completeEpicIfDelivered(epicId, tmpDir);
    assert.equal(completed.phase, 'done');
    assert.equal(readManifest(epicId, tmpDir).phase, 'done');
  });
});

// ── change-new.mjs epic flags ─────────────────────────────────────────────────

describe('change-new.mjs --class epic', () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-epic-new-'));
    // Init git so generateChangeId works
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates an epic manifest with empty children array', () => {
    const output = runScript('change-new.mjs', '--title "My Epic" --class epic', tmpDir);
    const { id } = JSON.parse(output);
    const manifest = readManifest(id, tmpDir);
    assert.equal(manifest.class, 'epic');
    assert.ok(Array.isArray(manifest.children));
    assert.equal(manifest.children.length, 0);
  });

  it('preserves every linked child when splitting an epic', () => {
    const epicOut = JSON.parse(runScript('change-new.mjs', '--title "Split Parent" --class epic', tmpDir));
    const epicId = epicOut.id;
    const manifest = readManifest(epicId, tmpDir);
    manifest.phase = 'specify';
    manifest.approvals = { architect: 'approved', specify: 'approved' };
    writeManifest(epicId, manifest, tmpDir);

    runScript('epic-split.mjs', `--epic ${epicId} --children '[{"title":"First Child"},{"title":"Second Child"}]'`, tmpDir);

    const updated = readManifest(epicId, tmpDir);
    assert.equal(updated.phase, 'decomposed');
    assert.equal(updated.children.length, 2);
  });

  it('creates a child manifest and links to parent', () => {
    // Create epic first
    const epicOut = JSON.parse(runScript('change-new.mjs', '--title "Parent Epic" --class epic', tmpDir));
    const epicId = epicOut.id;

    // Create child
    const childOut = JSON.parse(runScript('change-new.mjs', `--title "Child Task" --parent ${epicId}`, tmpDir));
    const childId = childOut.id;

    const child = readManifest(childId, tmpDir);
    assert.equal(child.parent, epicId);
    assert.equal(child.class, 'feature');

    const epic = readManifest(epicId, tmpDir);
    assert.ok(epic.children.includes(childId));
  });

  it('rejects epic as a child of another epic', () => {
    const epicOut = JSON.parse(runScript('change-new.mjs', '--title "Root Epic" --class epic', tmpDir));
    assert.throws(() => {
      runScript('change-new.mjs', `--title "Nested Epic" --class epic --parent ${epicOut.id}`, tmpDir);
    });
  });
});
