/**
 * Unit tests for packages/lib/index.mjs
 * Run with: node --test packages/build/__tests__/lib.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  parseYaml,
  stringifyYaml,
  generateChangeId,
  readManifest,
  writeManifest,
  listActiveChanges,
  nextSkill,
  PHASES,
  APPROVALS,
} from '../lib/index.mjs';

// ── parseYaml ────────────────────────────────────────────────────────────────

describe('parseYaml', () => {
  it('parses simple key-value pairs', () => {
    const result = parseYaml('id: "my-id"\ntitle: "My Title"\n');
    assert.equal(result.id, 'my-id');
    assert.equal(result.title, 'My Title');
  });

  it('parses boolean values', () => {
    const result = parseYaml('flag: true\nother: false\n');
    assert.equal(result.flag, true);
    assert.equal(result.other, false);
  });

  it('parses null values', () => {
    const result = parseYaml('key: null\n');
    assert.equal(result.key, null);
  });

  it('parses nested mappings', () => {
    const yaml = 'milestones:\n  architect: pending\n  specify: approved\n';
    const result = parseYaml(yaml);
    assert.equal(result.milestones.architect, 'pending');
    assert.equal(result.milestones.specify, 'approved');
  });

  it('strips inline comments', () => {
    const result = parseYaml('position: architect  # current position\n');
    assert.equal(result.position, 'architect');
  });

  it('handles empty sequences', () => {
    const result = parseYaml('kickbacks: []\n');
    // Empty sequence or null — both acceptable
    assert.ok(result.kickbacks === null || (Array.isArray(result.kickbacks) && result.kickbacks.length === 0));
  });

  it('parses block sequence mappings without leaking nested keys', () => {
    const yaml = [
      'position: specify',
      'kickbacks:',
      '  - type: defect',
      '    position: implement',
      '    missed: Missing error behavior',
      '    resolution: null',
    ].join('\n');

    const result = parseYaml(yaml);
    assert.equal(result.position, 'specify');
    assert.deepEqual(result.kickbacks, [{
      type: 'defect',
      position: 'implement',
      missed: 'Missing error behavior',
      resolution: null,
    }]);
  });
});

// ── stringifyYaml ────────────────────────────────────────────────────────────

describe('stringifyYaml', () => {
  it('round-trips a simple object', () => {
    const obj = { id: 'test-id', title: 'Test', phase: 'architect' };
    const yaml = stringifyYaml(obj);
    assert.ok(yaml.includes('id: test-id'));
    assert.ok(yaml.includes('title: Test'));
    assert.ok(yaml.includes('phase: architect'));
  });

  it('serializes nested objects', () => {
    const obj = { approvals: { architect: 'pending', specify: 'approved' } };
    const yaml = stringifyYaml(obj);
    assert.ok(yaml.includes('approvals:'));
    assert.ok(yaml.includes('architect: pending'));
    assert.ok(yaml.includes('specify: approved'));
  });

  it('serializes empty arrays as []', () => {
    const obj = { kickbacks: [] };
    const yaml = stringifyYaml(obj);
    assert.ok(yaml.includes('kickbacks: []'));
  });

  it('quotes strings containing colons', () => {
    const obj = { note: 'key: value' };
    const yaml = stringifyYaml(obj);
    assert.ok(yaml.includes('"key: value"'));
  });

  it('round-trips empty strings without converting them to null', () => {
    const yaml = stringifyYaml({ resolution: '' });
    assert.equal(parseYaml(yaml).resolution, '');
  });
});

// ── generateChangeId ─────────────────────────────────────────────────────────

describe('generateChangeId', () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-test-'));
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('generates a date-prefixed kebab-case ID', () => {
    const id = generateChangeId('Add Rate Limiter', tmpDir);
    assert.match(id, /^\d{4}-\d{2}-\d{2}-add-rate-limiter$/);
  });

  it('strips special characters', () => {
    const id = generateChangeId('Fix: auth/token validation!', tmpDir);
    assert.ok(!id.includes(':'));
    assert.ok(!id.includes('/'));
    assert.ok(!id.includes('!'));
  });

  it('appends suffix on collision', () => {
    const activeDir = path.join(tmpDir, '.changes', 'active');
    const id1 = generateChangeId('Same Title', tmpDir);
    fs.mkdirSync(path.join(activeDir, id1), { recursive: true });
    const id2 = generateChangeId('Same Title', tmpDir);
    assert.notEqual(id1, id2);
    assert.ok(id2.endsWith('-2'));
  });
});

// ── readManifest / writeManifest ─────────────────────────────────────────────

describe('readManifest / writeManifest', () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-test-'));
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads back a manifest', () => {
    const id = '2026-01-01-test-change';
    const manifest = {
      id,
      title: 'Test Change',
      class: 'feature',
      phase: 'architect',
      language: 'rust',
      approvals: { architect: 'pending', specify: 'pending', plan: 'pending', implement: 'pending' },
      artifacts: { architecture: 'architecture.md', decisions: 'decisions.md', plan: 'plan.md' },
      context_targets: ['CONTEXT.md'],
      kickbacks: [],
    };

    writeManifest(id, manifest, tmpDir);
    const read = readManifest(id, tmpDir);

    assert.equal(read.id, id);
    assert.equal(read.title, 'Test Change');
    assert.equal(read.phase, 'architect');
    assert.equal(read.language, 'rust');
    assert.equal(read.approvals.architect, 'pending');
  });

  it('throws when manifest does not exist', () => {
    assert.throws(
      () => readManifest('nonexistent-change', tmpDir),
      /Manifest not found/
    );
  });
});

// ── listActiveChanges ─────────────────────────────────────────────────────────

describe('listActiveChanges', () => {
  let tmpDir;
  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-test-'));
  });
  after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no changes dir', () => {
    const result = listActiveChanges(tmpDir);
    assert.deepEqual(result, []);
  });

  it('lists directories in active/', () => {
    const activeDir = path.join(tmpDir, '.changes', 'active');
    fs.mkdirSync(path.join(activeDir, '2026-01-01-change-a'), { recursive: true });
    fs.mkdirSync(path.join(activeDir, '2026-01-02-change-b'), { recursive: true });
    const result = listActiveChanges(tmpDir);
    assert.ok(result.includes('2026-01-01-change-a'));
    assert.ok(result.includes('2026-01-02-change-b'));
  });
});

// ── nextSkill ─────────────────────────────────────────────────────────────────

describe('nextSkill', () => {
  it('returns architect when phase is architect and approval pending', () => {
    const m = { phase: 'architect', approvals: { architect: 'pending' } };
    assert.equal(nextSkill(m), 'architect');
  });

  it('returns specify when architect approval approved', () => {
    const m = { phase: 'architect', approvals: { architect: 'approved' } };
    assert.equal(nextSkill(m), 'specify');
  });

  it('returns specify when phase is specify and approval pending', () => {
    const m = { phase: 'specify', approvals: { specify: 'pending' } };
    assert.equal(nextSkill(m), 'specify');
  });

  it('returns plan when specify approval approved', () => {
    const m = { phase: 'specify', approvals: { specify: 'approved' } };
    assert.equal(nextSkill(m), 'plan');
  });

  it('returns implement when plan approval approved', () => {
    const m = { phase: 'plan', approvals: { plan: 'approved' } };
    assert.equal(nextSkill(m), 'implement');
  });

  it('returns archive command when phase is archive-ready', () => {
    const m = { phase: 'archive-ready', approvals: {} };
    assert.equal(nextSkill(m), 'change-archive');
  });

  it('routes a refactor class through audit → execute → archive', () => {
    assert.match(nextSkill({ class: 'refactor', phase: 'refactor', approvals: { refactor: 'pending' } }), /refactor \(audit/);
    assert.match(nextSkill({ class: 'refactor', phase: 'implement', approvals: { refactor: 'approved', implement: 'pending' } }), /execute/);
    assert.equal(nextSkill({ class: 'refactor', phase: 'archive-ready', approvals: { refactor: 'approved', implement: 'approved' } }), 'change-archive');
  });
});

// ── Constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('PHASES contains expected values in order', () => {
    assert.deepEqual(PHASES, ['refactor', 'architect', 'specify', 'plan', 'implement', 'decomposed', 'archive-ready']);
  });

  it('APPROVALS contains expected values', () => {
    assert.deepEqual(APPROVALS, ['refactor', 'architect', 'specify', 'plan', 'implement', 'docs']);
  });
});
