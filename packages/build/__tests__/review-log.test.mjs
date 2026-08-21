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
  readManifest,
  appendReview,
  readReviews,
  reviewApprovalReady,
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
    phase: 'implement',
    approvals: { architect: 'approved', specify: 'approved', plan: 'approved', implement: 'pending' },
    context_targets: ['CONTEXT.md'],
    kickbacks: [],
  }, cwd);
}

function finding(id, severity = 'major', overrides = {}) {
  return JSON.stringify({
    id,
    severity,
    category: 'correctness',
    location: 'src/service.mjs:42',
    impact: 'returns the wrong result',
    alternative: 'validate before mutating state',
    ...overrides,
  });
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

  it('records a structured auditor review with findings', () => {
    const res = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested',
      '--finding', finding('RV-001'),
      '--finding', finding('RV-002', 'blocker', { category: 'security' }),
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
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested',
    ], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /at least one --finding/);
  });

  it('refuses an empty reviewer label', () => {
    const res = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', '   ', '--verdict', 'approved',
    ], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /non-empty/);
  });

  it('blocks a verifier approval without a distinct prior auditor', () => {
    const res = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-a', '--verdict', 'approved',
    ], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /requires exactly one discovery auditor/);
  });

  it('blocks a verifier reusing the auditor label', () => {
    run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'same-person', '--verdict', 'changes-requested',
      '--finding', finding('RV-001'),
    ], cwd);
    const res = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'same-person', '--verdict', 'approved', '--resolution', 'RV-001=resolved',
    ], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /different from auditor/);
  });

  it('reaches a ready approval after auditor then distinct verifier approval', () => {
    run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested',
      '--finding', finding('RV-001', 'major', { category: 'idioms' }),
    ], cwd);
    const approve = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'approved', '--resolution', 'RV-001=resolved',
    ], cwd);
    assert.equal(approve.status, 0, approve.stderr);
    const approval = reviewApprovalReady(id, 'implement', cwd);
    assert.equal(approval.ready, true, approval.reason);

    const status = run(['status', '--id', id, '--phase', 'implement'], cwd);
    assert.equal(status.status, 0, status.stderr);
    const parsed = JSON.parse(status.stdout);
    assert.equal(parsed.phases.implement.approval.ready, true);
  });

  it('records and approves the current epoch while retaining prior review history', () => {
    const manifest = {
      ...readManifest(id, cwd),
      review_epochs: { implement: 2 },
    };
    writeManifest(id, manifest, cwd);
    appendReview(id, {
      version: 2, cycle: 'implement-1', phase: 'implement', role: 'auditor', reviewer: 'prior-auditor',
      verdict: 'approved', findings: [], at: new Date().toISOString(),
    }, cwd);
    appendReview(id, {
      version: 2, cycle: 'implement-1', phase: 'implement', role: 'verifier', reviewer: 'prior-verifier',
      verdict: 'approved', verification: 'initial', resolutions: [], regressions: [], regressionResolutions: [], at: new Date().toISOString(),
    }, cwd);

    const audit = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-2', '--role', 'auditor',
      '--reviewer', 'current-auditor', '--verdict', 'approved',
    ], cwd);
    assert.equal(audit.status, 0, audit.stderr);
    const verify = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-2', '--role', 'verifier',
      '--reviewer', 'current-verifier', '--verdict', 'approved',
    ], cwd);
    assert.equal(verify.status, 0, verify.stderr);
    assert.equal(reviewApprovalReady(id, 'implement', cwd).ready, true);
  });

  it('keeps implement and refactor phases independent', () => {
    run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested',
      '--finding', finding('RV-001', 'major', { category: 'idioms' }),
    ], cwd);
    run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'approved', '--resolution', 'RV-001=resolved',
    ], cwd);
    assert.equal(reviewApprovalReady(id, 'implement', cwd).ready, true);
    assert.equal(reviewApprovalReady(id, 'refactor', cwd).ready, false);
  });

  it('fails cleanly for a missing change', () => {
    const res = run(['status', '--id', 'nope'], cwd);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /Manifest not found/);
  });

  it('persists reviews.json as an array at the expected path', () => {
    run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'approved',
    ], cwd);
    const rp = reviewsPath(id, cwd);
    assert.ok(fs.existsSync(rp));
    assert.ok(Array.isArray(JSON.parse(fs.readFileSync(rp, 'utf8'))));
  });

  it('records a structured cycle and resolves every original finding', () => {
    const audit = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested',
      '--finding', finding('RV-001'),
      '--finding', finding('RV-002', 'blocker', { category: 'security' }),
    ], cwd);
    assert.equal(audit.status, 0, audit.stderr);

    const verify = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'approved',
      '--resolution', 'RV-001=resolved', '--resolution', 'RV-002=resolved',
    ], cwd);
    assert.equal(verify.status, 0, verify.stderr);
    const entries = readReviews(id, cwd);
    assert.equal(entries[0].version, 2);
    assert.equal(entries[0].cycle, 'implement-1');
    assert.deepEqual(entries[1].resolutions, [
      { id: 'RV-001', status: 'resolved' },
      { id: 'RV-002', status: 'resolved' },
    ]);
    assert.equal(entries[1].verification, 'initial');
    assert.equal(reviewApprovalReady(id, 'implement', cwd).ready, true);
  });

  it('rejects reviews outside the current lifecycle stage', () => {
    const wrongPrefix = run([
      'record', '--id', id, '--phase', 'architect', '--cycle', 'architect-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested', '--finding', finding('RV-001'),
    ], cwd);
    assert.equal(wrongPrefix.status, 1);
    assert.match(wrongPrefix.stderr, /not pending/);

    const incomplete = run([
      'record', '--id', id, '--phase', 'specify', '--cycle', 'specify-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested',
      '--finding', JSON.stringify({ id: 'SV-001', severity: 'major', category: 'simplicity', location: 'x' }),
    ], cwd);
    assert.equal(incomplete.status, 1);
    assert.match(incomplete.stderr, /not pending/);
  });

  it('allows verifier resolutions only for original IDs and blocker-only regressions', () => {
    run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested', '--finding', finding('RV-001'),
    ], cwd);
    const unknown = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'changes-requested', '--resolution', 'RV-999=resolved',
    ], cwd);
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /not an original auditor finding id/);

    const majorRegression = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'changes-requested', '--resolution', 'RV-001=resolved',
      '--regression', finding('RV-002', 'major'),
    ], cwd);
    assert.equal(majorRegression.status, 1);
    assert.match(majorRegression.stderr, /blocker severity/);

    const verifierFinding = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'changes-requested', '--finding', finding('RV-002'),
    ], cwd);
    assert.equal(verifierFinding.status, 1);
    assert.match(verifierFinding.stderr, /cannot add --finding/);
  });

  it('permits one targeted re-verification to resolve a blocker regression', () => {
    run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested', '--finding', finding('RV-001'),
    ], cwd);
    const initial = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'changes-requested', '--resolution', 'RV-001=resolved',
      '--regression', finding('RV-002', 'blocker', { category: 'maintainability' }),
    ], cwd);
    assert.equal(initial.status, 0, initial.stderr);
    assert.equal(reviewApprovalReady(id, 'implement', cwd).ready, false);

    const targeted = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-c', '--verdict', 'approved', '--regression-resolution', 'RV-002=resolved',
    ], cwd);
    assert.equal(targeted.status, 0, targeted.stderr);
    const entries = readReviews(id, cwd);
    assert.equal(entries[2].verification, 'targeted-reverification');
    assert.equal(reviewApprovalReady(id, 'implement', cwd).ready, true);

    const third = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-d', '--verdict', 'approved',
    ], cwd);
    assert.equal(third.status, 1);
    assert.match(third.stderr, /initial verification and one targeted re-verification/);
  });

  it('requires a distinct v2 verifier and keeps unresolved originals unready', () => {
    run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested', '--finding', finding('RV-001'),
    ], cwd);
    const same = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-a', '--verdict', 'approved', '--resolution', 'RV-001=resolved',
    ], cwd);
    assert.equal(same.status, 1);
    assert.match(same.stderr, /different from auditor/);

    const unresolved = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'approved', '--resolution', 'RV-001=unresolved',
    ], cwd);
    assert.equal(unresolved.status, 0, unresolved.stderr);
    assert.equal(reviewApprovalReady(id, 'implement', cwd).ready, false);
  });

  it('rejects a second broad discovery pass in the phase cycle', () => {
    run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'changes-requested', '--finding', finding('RV-001'),
    ], cwd);
    const reused = run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-c', '--verdict', 'changes-requested', '--finding', finding('RV-002'),
    ], cwd);
    assert.equal(reused.status, 1);
    assert.match(reused.stderr, /exactly one discovery auditor/);
  });

  it('rejects a future structured cycle at approval evaluation', () => {
    run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'approved',
    ], cwd);
    run([
      'record', '--id', id, '--phase', 'implement', '--cycle', 'implement-1', '--role', 'verifier',
      '--reviewer', 'critic-b', '--verdict', 'approved',
    ], cwd);
    appendReview(id, {
      version: 2, cycle: 'implement-2', phase: 'implement', role: 'auditor', reviewer: 'injected',
      verdict: 'approved', findings: [], at: new Date().toISOString(),
    }, cwd);
    const approval = reviewApprovalReady(id, 'implement', cwd);
    assert.equal(approval.ready, false);
    assert.match(approval.reason, /current or historical epochs through 'implement-1'/);
  });

  it('rejects version-1 and unversioned logs as unsupported', () => {
    appendReview(id, {
      version: 1, phase: 'implement', role: 'auditor', reviewer: 'legacy-a',
      verdict: 'changes-requested', findings: ['legacy finding'], at: new Date().toISOString(),
    }, cwd);
    appendReview(id, {
      version: 1, phase: 'implement', role: 'verifier', reviewer: 'legacy-b',
      verdict: 'approved', findings: [], at: new Date().toISOString(),
    }, cwd);
    const legacy = reviewApprovalReady(id, 'implement', cwd);
    assert.equal(legacy.ready, false);
    assert.match(legacy.reason, /unsupported review version '1'/);

    fs.rmSync(reviewsPath(id, cwd));
    appendReview(id, {
      phase: 'implement', role: 'auditor', reviewer: 'unversioned',
      verdict: 'approved', findings: [], at: new Date().toISOString(),
    }, cwd);
    const unversioned = reviewApprovalReady(id, 'implement', cwd);
    assert.equal(unversioned.ready, false);
    assert.match(unversioned.reason, /unsupported review version 'missing'/);

    const writeLegacy = run([
      'record', '--id', id, '--phase', 'implement', '--role', 'auditor',
      '--reviewer', 'critic-a', '--verdict', 'approved',
    ], cwd);
    assert.equal(writeLegacy.status, 1);
    assert.match(writeLegacy.stderr, /--cycle is required/);
  });
});
