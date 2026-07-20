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
  STAGES,
  GATES,
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
    const yaml = 'gates:\n  architect: pending\n  specify: approved\n';
    const result = parseYaml(yaml);
    assert.equal(result.gates.architect, 'pending');
    assert.equal(result.gates.specify, 'approved');
  });

  it('strips inline comments', () => {
    const result = parseYaml('stage: architect  # current stage\n');
    assert.equal(result.stage, 'architect');
  });

  it('handles empty sequences', () => {
    const result = parseYaml('kickbacks: []\n');
    // Empty sequence or null — both acceptable
    assert.ok(result.kickbacks === null || (Array.isArray(result.kickbacks) && result.kickbacks.length === 0));
  });

  it('parses block sequence mappings without leaking nested keys', () => {
    const yaml = [
      'stage: specify',
      'kickbacks:',
      '  - type: defect',
      '    stage: implement',
      '    missed: Missing error behavior',
      '    resolution: null',
    ].join('\n');

    const result = parseYaml(yaml);
    assert.equal(result.stage, 'specify');
    assert.deepEqual(result.kickbacks, [{
      type: 'defect',
      stage: 'implement',
      missed: 'Missing error behavior',
      resolution: null,
    }]);
  });
});

// ── stringifyYaml ────────────────────────────────────────────────────────────

describe('stringifyYaml', () => {
  it('round-trips a simple object', () => {
    const obj = { id: 'test-id', title: 'Test', stage: 'architect' };
    const yaml = stringifyYaml(obj);
    assert.ok(yaml.includes('id: test-id'));
    assert.ok(yaml.includes('title: Test'));
    assert.ok(yaml.includes('stage: architect'));
  });

  it('serializes nested objects', () => {
    const obj = { gates: { architect: 'pending', specify: 'approved' } };
    const yaml = stringifyYaml(obj);
    assert.ok(yaml.includes('gates:'));
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
      stage: 'architect',
      language: 'rust',
      gates: { architect: 'pending', specify: 'pending', plan: 'pending', implement: 'pending', docs: 'pending' },
      artifacts: { architecture: 'architecture.md', decisions: 'decisions.md', plan: 'plan.md' },
      context_targets: ['CONTEXT.md'],
      kickbacks: [],
    };

    writeManifest(id, manifest, tmpDir);
    const read = readManifest(id, tmpDir);

    assert.equal(read.id, id);
    assert.equal(read.title, 'Test Change');
    assert.equal(read.stage, 'architect');
    assert.equal(read.language, 'rust');
    assert.equal(read.gates.architect, 'pending');
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
  it('returns architect when stage is architect and gate pending', () => {
    const m = { stage: 'architect', gates: { architect: 'pending' } };
    assert.equal(nextSkill(m), 'architect');
  });

  it('returns specify when architect gate approved', () => {
    const m = { stage: 'architect', gates: { architect: 'approved' } };
    assert.equal(nextSkill(m), 'specify');
  });

  it('returns specify when stage is specify and gate pending', () => {
    const m = { stage: 'specify', gates: { specify: 'pending' } };
    assert.equal(nextSkill(m), 'specify');
  });

  it('returns plan when specify gate approved', () => {
    const m = { stage: 'specify', gates: { specify: 'approved' } };
    assert.equal(nextSkill(m), 'plan');
  });

  it('returns implement when plan gate approved', () => {
    const m = { stage: 'plan', gates: { plan: 'approved' } };
    assert.equal(nextSkill(m), 'implement');
  });

  it('returns null when stage is done', () => {
    const m = { stage: 'done', gates: {} };
    assert.equal(nextSkill(m), null);
  });
});

// ── Constants ─────────────────────────────────────────────────────────────────

describe('constants', () => {
  it('STAGES contains expected values in order', () => {
    assert.deepEqual(STAGES, ['architect', 'specify', 'plan', 'implement', 'done']);
  });

  it('GATES contains expected values', () => {
    assert.deepEqual(GATES, ['architect', 'specify', 'plan', 'implement', 'docs']);
  });
});
