/**
 * Tests for review-log.mjs and the review-log lib helpers.
 * Run with: node --test packages/build/__tests__/review-log.test.mjs
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  writeManifest,
  readReviews,
  reviewGateReady,
  reviewsPath,
} from '../lib/index.mjs';

const scriptsDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function run(args, cwd) {
  return spawnSync(process.execPath, [path.join(scriptsDir, 'review-log.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
  });
}

const id = '2026-07-25-review-log';

function seedChange(cwd) {
  writeManifest(id, {
    id,
    title: 'Review log',
    class: 'feature',
    stage: 'implement',
    gates: { architect: 'approved', specify: 'approved', plan: 'approved', implement: 'pending', docs: 'pending' },
    context_targets: ['CONTEXT.md'],
    kickbacks: [],
  }, cwd);
}

describe('review-log.mjs', () => {
  let cwd;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-review-'));
    seedChange(cwd);
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('supports --help with no project state and writes nothing', () => {
    const help = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-review-help-'));
    try {
      const res = run(['--help'], help);
      assert.equal(res.status, 0, res.stderr);
      assert.match(res.stdout, /Usage:/);
      assert.deepEqual(fs.readdirSync(help), []);
    } finally {
      fs.rmSync(help, { recursive: true, force: true });
    }
  });

  it('records an auditor review with findings', () => {
    const res = run([
      'record', '--id', id, '--stage', 'implement', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested',
      '--finding', 'src/lib.rs [structure] split into focused modules',
      '--finding', 'src/io.rs:42 [safety] .expect() on I/O',
    ], cwd);
    assert.equal(res.status, 0, res.stderr);
    const reviews = readReviews(id, cwd);
    assert.equal(reviews.length, 1);
    assert.equal(reviews[0].role, 'auditor');
    assert.equal(reviews[0].findings.length, 2);
    assert.equal(reviews[0].verdict, 'changes-requested');
  });

  it('rejects a changes-requested verdict with no findings', () => {
    const res = run([
      'record', '--id', id, '--stage', 'implement', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested',
    ], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /at least one --finding/);
  });

  it('refuses an empty reviewer label', () => {
    const res = run([
      'record', '--id', id, '--stage', 'implement', '--role', 'auditor',
      '--reviewer', '   ', '--verdict', 'approved',
    ], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /non-empty/);
  });

  it('blocks a verifier approval without a distinct prior auditor', () => {
    const res = run([
      'record', '--id', id, '--stage', 'implement', '--role', 'verifier',
      '--reviewer', 'critic-a', '--verdict', 'approved',
    ], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /prior auditor review/);
  });

  it('blocks a verifier reusing the auditor label', () => {
    run([
      'record', '--id', id, '--stage', 'implement', '--role', 'auditor',
      '--reviewer', 'same-person', '--verdict', 'changes-requested',
      '--finding', 'x.rs:1 [hygiene] dead code',
    ], cwd);
    const res = run([
      'record', '--id', id, '--stage', 'implement', '--role', 'verifier',
      '--reviewer', 'same-person', '--verdict', 'approved',
    ], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /different reviewer/);
  });

  it('reaches a ready gate after auditor then distinct verifier approval', () => {
    run([
      'record', '--id', id, '--stage', 'implement', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested',
      '--finding', 'a.rs:1 [idioms] non-idiomatic',
    ], cwd);
    const approve = run([
      'record', '--id', id, '--stage', 'implement', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'approved',
    ], cwd);
    assert.equal(approve.status, 0, approve.stderr);
    const gate = reviewGateReady(id, 'implement', cwd);
    assert.equal(gate.ready, true, gate.reason);

    const status = run(['status', '--id', id, '--stage', 'implement'], cwd);
    assert.equal(status.status, 0, status.stderr);
    const parsed = JSON.parse(status.stdout);
    assert.equal(parsed.stages.implement.gate.ready, true);
  });

  it('keeps implement and refactor stages independent', () => {
    run([
      'record', '--id', id, '--stage', 'implement', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested',
      '--finding', 'a.rs:1 [idioms] non-idiomatic',
    ], cwd);
    run([
      'record', '--id', id, '--stage', 'implement', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'approved',
    ], cwd);
    assert.equal(reviewGateReady(id, 'implement', cwd).ready, true);
    assert.equal(reviewGateReady(id, 'refactor', cwd).ready, false);
  });

  it('fails cleanly for a missing change', () => {
    const res = run(['status', '--id', 'nope'], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Manifest not found/);
  });

  it('persists reviews.json as an array at the expected path', () => {
    run([
      'record', '--id', id, '--stage', 'implement', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'approved',
    ], cwd);
    const rp = reviewsPath(id, cwd);
    assert.ok(fs.existsSync(rp));
    assert.ok(Array.isArray(JSON.parse(fs.readFileSync(rp, 'utf8'))));
  });
});
