import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendReview,
  renderTraceabilitySummary,
  traceabilityReport,
  validateApprovalArtifacts,
  writeManifest,
} from '../lib/index.mjs';

const templateDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..', '_templates');

function architecture({ record = '', seam = '' } = {}) {
  return [
    '## Summary', '## Architecture Confirmation Ledger', record,
    '## Architectural Decisions', '## Seams', seam,
    '## Validity Check Results', '**Status:** passed',
    '## Review Cycle Reference', 'Cycle: architect-1',
  ].join('\n');
}

function decisions({ record = '', findings = '', criterion = '' } = {}) {
  return [
    '## Confirmation Ledger', record,
    '## Interface Changes', '## Decision Log', '## Dry-Run Findings', findings,
    '## Review Cycle Reference', 'Cycle: specify-1',
    '## Acceptance Criteria Confirmed', criterion,
  ].join('\n');
}

describe('validateApprovalArtifacts', () => {
  let cwd;
  let manifest;
  let dir;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-artifacts-'));
    manifest = {
      id: '2026-08-06-artifacts', title: 'Artifacts', class: 'feature', phase: 'specify',
      artifacts: { architecture: 'architecture.md', decisions: 'decisions.md', plan: 'plan.md' },
      approvals: {}, context_targets: [], kickbacks: [],
    };
    writeManifest(manifest.id, manifest, cwd);
    dir = path.join(cwd, '.changes', 'active', manifest.id);
  });

  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('rejects an unconfirmed decision record', () => {
    fs.writeFileSync(path.join(dir, 'decisions.md'), decisions({ record: [
      '### D-001', '- Question: q', '- User response:', '- Status: unresolved',
    ].join('\n') }));
    const result = validateApprovalArtifacts(manifest, 'specify', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /not explicitly confirmed/);
    assert.match(result.errors.join('\n'), /no explicit user response/);
  });

  it('accepts explicitly confirmed keyed records', () => {
    fs.writeFileSync(path.join(dir, 'architecture.md'), architecture({ record: [
      '### A-001', '- Topic: q', '- User response: accept', '- Status: confirmed',
    ].join('\n') }));
    fs.writeFileSync(path.join(dir, 'decisions.md'), decisions({ record: [
      '### D-001', '- Question: q', '- User response: accept', '- Status: confirmed',
    ].join('\n') }));
    assert.equal(validateApprovalArtifacts(manifest, 'architect', cwd).valid, true);
    assert.equal(validateApprovalArtifacts(manifest, 'specify', cwd).valid, true);
  });

  it('rejects unresolved keyed blocker findings', () => {
    fs.writeFileSync(path.join(dir, 'decisions.md'), decisions({ findings: [
      '### SV-001 [severity: blocker]', '- Disposition: unresolved',
    ].join('\n') }));
    const result = validateApprovalArtifacts(manifest, 'specify', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /unresolved dry-run blocker/);
  });

  it('requires task coverage, firm-seam tests, and an up-to-date generated summary', () => {
    fs.writeFileSync(path.join(dir, 'architecture.md'), architecture({ seam: [
      '### Seam: API [id: SEAM-API] [firmness: firm]', '- [AC-API] Returns a validated response.',
    ].join('\n') }));
    const stalePlan = [
      '## Traceability check', '<!-- traceability:start -->', '- stale', '<!-- traceability:end -->',
      '- [ ] [T-001] Implement endpoint [AC-API]',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'plan.md'), stalePlan);
    let result = validateApprovalArtifacts(manifest, 'plan', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /firm seams without firm-seam test tasks/);
    assert.match(result.errors.join('\n'), /summary is stale/);

    const plan = [
      '## Traceability check',
      '<!-- traceability:start -->', '<!-- traceability:end -->',
      '- [ ] [T-001] Implement endpoint [AC-API]',
      '- [ ] [T-002] Write API test [AC-API] [seam: SEAM-API] [firmness: firm]',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'plan.md'), plan);
    const report = traceabilityReport(manifest, cwd);
    fs.writeFileSync(path.join(dir, 'plan.md'), plan.replace('<!-- traceability:start -->\n<!-- traceability:end -->', renderTraceabilitySummary(report)));
    result = validateApprovalArtifacts(manifest, 'plan', cwd);
    assert.equal(result.valid, true, result.errors.join('\n'));
  });

  it('rejects duplicate task IDs and fenced source code', () => {
    const plan = [
      '## Traceability check', '<!-- traceability:start -->', '- No acceptance criteria declared.', '<!-- traceability:end -->',
      '- [ ] [T-001] Task', '- [ ] [T-001] Test task', '```rust', 'fn x() {}', '```',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'plan.md'), plan);
    const result = validateApprovalArtifacts(manifest, 'plan', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /duplicate task IDs/);
    assert.match(result.errors.join('\n'), /fenced source-code block/);
  });

  it('accepts clean canonical templates with formal review attestations', () => {
    const architectureTemplate = fs.readFileSync(path.join(templateDir, 'architecture.md.tmpl'), 'utf8')
      .replace('`architect-N`', '`architect-1`')
      .replace('**Status:** pending | passed | passed-after-resolution', '**Status:** passed');
    const decisionsTemplate = fs.readFileSync(path.join(templateDir, 'decisions.md.tmpl'), 'utf8')
      .replace('`specify-N`', '`specify-1`');
    fs.writeFileSync(path.join(dir, 'architecture.md'), architectureTemplate);
    fs.writeFileSync(path.join(dir, 'decisions.md'), decisionsTemplate);
    fs.writeFileSync(path.join(dir, 'plan.md'), fs.readFileSync(path.join(templateDir, 'plan.md.tmpl'), 'utf8'));
    appendReview(manifest.id, { version: 2, cycle: 'architect-1', phase: 'architect', role: 'auditor', reviewer: 'critic-a', verdict: 'approved', findings: [], at: new Date().toISOString() }, cwd);
    appendReview(manifest.id, { version: 2, cycle: 'specify-1', phase: 'specify', role: 'auditor', reviewer: 'critic-b', verdict: 'approved', findings: [], at: new Date().toISOString() }, cwd);
    assert.equal(validateApprovalArtifacts(manifest, 'architect', cwd).valid, true);
    assert.equal(validateApprovalArtifacts(manifest, 'specify', cwd).valid, true);
    assert.equal(validateApprovalArtifacts(manifest, 'plan', cwd).valid, true);
  });

  it('requires keyed review finding IDs to match the structured review log', () => {
    fs.writeFileSync(path.join(dir, 'architecture.md'), architecture());
    appendReview(manifest.id, {
      version: 2, cycle: 'architect-1', phase: 'architect', role: 'auditor', reviewer: 'critic-a',
      verdict: 'changes-requested', findings: [{
        id: 'AV-001', severity: 'major', category: 'correctness', location: 'architecture.md:1',
        impact: 'contract is incomplete', alternative: 'define the missing contract',
      }], at: new Date().toISOString(),
    }, cwd);
    let result = validateApprovalArtifacts(manifest, 'architect', cwd);
    assert.match(result.errors.join('\n'), /missing: AV-001/);

    fs.appendFileSync(path.join(dir, 'architecture.md'), '\n### AV-001 [severity: major]\n- Disposition: resolved\n');
    result = validateApprovalArtifacts(manifest, 'architect', cwd);
    assert.equal(result.valid, true, result.errors.join('\n'));
  });

  it('keeps concrete review IDs out of canonical templates', () => {
    for (const [name, prefix] of [['architecture.md.tmpl', 'AV'], ['decisions.md.tmpl', 'SV'], ['plan.md.tmpl', 'RV'], ['refactor.md.tmpl', 'RV']]) {
      const content = fs.readFileSync(path.join(templateDir, name), 'utf8');
      assert.doesNotMatch(content, new RegExp(`^###\\s+${prefix}-[0-9]{3}`, 'mi'));
    }
  });
});
