import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { appendReview, validateApprovalArtifacts, writeManifest } from '../lib/index.mjs';

describe('validateApprovalArtifacts', () => {
  let cwd;
  let manifest;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-artifacts-'));
    manifest = {
      id: '2026-08-06-artifacts', title: 'Artifacts', class: 'feature', phase: 'specify',
      artifacts: { architecture: 'architecture.md', decisions: 'decisions.md', plan: 'plan.md' },
      approvals: {}, context_targets: [], kickbacks: [],
    };
    writeManifest(manifest.id, manifest, cwd);
  });

  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('rejects an unconfirmed decision ledger row', () => {
    const dir = path.join(cwd, '.changes', 'active', manifest.id);
    fs.writeFileSync(path.join(dir, 'decisions.md'), [
      '## Confirmation Ledger',
      '| ID | Material question | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
      '|---|---|---|---|---|---|---|',
      '| D-001 | q | r | none |  | unresolved |  |',
      '## Interface Changes', '## Decision Log', '## Dry-Run Findings',
    ].join('\n'));
    const result = validateApprovalArtifacts(manifest, 'specify', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /not explicitly confirmed/);
  });

  it('rejects an unconfirmed architecture ledger row', () => {
    const dir = path.join(cwd, '.changes', 'active', manifest.id);
    fs.writeFileSync(path.join(dir, 'architecture.md'), [
      '## Summary', '## Architecture Confirmation Ledger',
      '| ID | Material topic | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
      '|---|---|---|---|---|---|---|',
      '| A-001 | q | r | none |  | unresolved |  |',
      '## Architectural Decisions', '## Seams', '## Validity Check Results', '**Status:** passed',
    ].join('\n'));
    const result = validateApprovalArtifacts(manifest, 'architect', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /architecture confirmation ledger row is not explicitly confirmed/);
  });

  it('accepts an explicitly confirmed architecture ledger', () => {
    const dir = path.join(cwd, '.changes', 'active', manifest.id);
    fs.writeFileSync(path.join(dir, 'architecture.md'), [
      '## Summary', '## Architecture Confirmation Ledger',
      '| ID | Material topic | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
      '|---|---|---|---|---|---|---|',
      '| A-001 | q | r | none | accept | confirmed | yes |',
      '## Architectural Decisions', '## Seams', '## Validity Check Results', '**Status:** passed',
      '## Review Cycle Reference', 'Cycle: architect-1',
    ].join('\n'));
    assert.equal(validateApprovalArtifacts(manifest, 'architect', cwd).valid, true);
  });

  it('allows non-blocking dry-run findings after explicit confirmation', () => {
    const dir = path.join(cwd, '.changes', 'active', manifest.id);
    fs.writeFileSync(path.join(dir, 'decisions.md'), [
      '## Confirmation Ledger',
      '| ID | Material question | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
      '|---|---|---|---|---|---|---|',
      '| D-001 | q | r | none | accept | confirmed | yes |',
      '## Interface Changes', '## Decision Log', '## Dry-Run Findings',
      '**Classification:** assumption', '**Disposition:** accepted-assumption',
      '## Review Cycle Reference', 'Cycle: specify-1',
    ].join('\n'));
    assert.equal(validateApprovalArtifacts(manifest, 'specify', cwd).valid, true);
  });

  it('rejects unresolved blocker findings', () => {
    const dir = path.join(cwd, '.changes', 'active', manifest.id);
    fs.writeFileSync(path.join(dir, 'decisions.md'), [
      '## Confirmation Ledger',
      '| ID | Material question | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
      '|---|---|---|---|---|---|---|',
      '| D-001 | q | r | none | accept | confirmed | yes |',
      '## Interface Changes', '## Decision Log', '## Dry-Run Findings',
      '**Classification:** blocker', '**Disposition:** unresolved',
      '## Review Cycle Reference', 'Cycle: specify-1',
    ].join('\n'));
    const result = validateApprovalArtifacts(manifest, 'specify', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /unresolved dry-run blocker/);
  });

  it('accepts a detailed functional plan without source code', () => {
    const dir = path.join(cwd, '.changes', 'active', manifest.id);
    fs.writeFileSync(path.join(dir, 'plan.md'), [
      '## Traceability check',
      '| AC ID | Task(s) | Firm-seam test task |',
      '|---|---|---|',
      '| AC-001 | Section 1, Task 1 | Section 1, Task 1 |',
      '## Section 1: Import records',
      '- [ ] Add `import_records` to `src/import.rs`',
      '  - Behavior: 1. Validate the request. 2. Normalize every record. 3. Persist valid records. 4. Map rejected records to `ImportError::InvalidRecord`.',
      '  - Errors and invariants: Do not persist any record when validation fails.',
    ].join('\n'));

    assert.equal(validateApprovalArtifacts(manifest, 'plan', cwd).valid, true);
  });

  it('rejects a fenced source-code function in a plan', () => {
    const dir = path.join(cwd, '.changes', 'active', manifest.id);
    fs.writeFileSync(path.join(dir, 'plan.md'), [
      '## Traceability check',
      '| AC ID | Task(s) | Firm-seam test task |',
      '|---|---|---|',
      '| AC-001 | Section 1, Task 1 | Section 1, Task 1 |',
      '```rust',
      'fn import_records(records: Vec<Record>) -> Result<(), ImportError> {',
      '    Ok(())',
      '}',
      '```',
    ].join('\n'));

    const result = validateApprovalArtifacts(manifest, 'plan', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /fenced source-code block/);
  });

  it('accepts an inline one-line signature in a plan', () => {
    const dir = path.join(cwd, '.changes', 'active', manifest.id);
    fs.writeFileSync(path.join(dir, 'plan.md'), [
      '## Traceability check',
      '| AC ID | Task(s) | Firm-seam test task |',
      '|---|---|---|',
      '| AC-001 | Section 1, Task 1 | Section 1, Task 1 |',
      '- [ ] Add `import_records(records: Vec<Record>) -> Result<(), ImportError>` to `src/import.rs`.',
    ].join('\n'));

    assert.equal(validateApprovalArtifacts(manifest, 'plan', cwd).valid, true);
  });

  it('requires review-cycle references for feature architecture and decisions', () => {
    const dir = path.join(cwd, '.changes', 'active', manifest.id);
    fs.writeFileSync(path.join(dir, 'architecture.md'), [
      '## Summary', '## Architecture Confirmation Ledger',
      '| ID | Material topic | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
      '|---|---|---|---|---|---|---|',
      '| A-001 | q | r | none | accept | confirmed | yes |',
      '## Architectural Decisions', '## Seams', '## Validity Check Results', '**Status:** passed',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'decisions.md'), [
      '## Confirmation Ledger',
      '| ID | Material question | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
      '|---|---|---|---|---|---|---|',
      '| D-001 | q | r | none | accept | confirmed | yes |',
      '## Interface Changes', '## Decision Log', '## Dry-Run Findings',
    ].join('\n'));

    assert.match(validateApprovalArtifacts(manifest, 'architect', cwd).errors.join('\n'), /Review Cycle Reference/);
    assert.match(validateApprovalArtifacts(manifest, 'specify', cwd).errors.join('\n'), /Review Cycle Reference/);
  });

  it('does not require N/A review boilerplate for exempt bug artifacts', () => {
    manifest.class = 'bug';
    const dir = path.join(cwd, '.changes', 'active', manifest.id);
    fs.writeFileSync(path.join(dir, 'architecture.md'), [
      '## Summary', '## Architecture Confirmation Ledger',
      '| ID | Material topic | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
      '|---|---|---|---|---|---|---|',
      '| A-001 | q | r | none | accept | confirmed | yes |',
      '## Architectural Decisions', '## Seams', '## Validity Check Results', '**Status:** passed',
    ].join('\n'));

    assert.equal(validateApprovalArtifacts(manifest, 'architect', cwd).valid, true);
  });

  it('accepts empty confirmation ledgers without placeholder N/A rows', () => {
    const dir = path.join(cwd, '.changes', 'active', manifest.id);
    fs.writeFileSync(path.join(dir, 'architecture.md'), [
      '## Summary', 'No material decisions.', '## Architecture Confirmation Ledger',
      '| ID | Material topic | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
      '|---|---|---|---|---|---|---|',
      '## Architectural Decisions', '## Seams', '## Validity Check Results', '**Status:** passed',
      '## Review Cycle Reference', 'Cycle: architect-1',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'decisions.md'), [
      '## Confirmation Ledger',
      '| ID | Material question | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
      '|---|---|---|---|---|---|---|',
      '## Interface Changes', '## Decision Log', '## Dry-Run Findings',
      '## Review Cycle Reference', 'Cycle: specify-1',
    ].join('\n'));

    assert.equal(validateApprovalArtifacts(manifest, 'architect', cwd).valid, true);
    assert.equal(validateApprovalArtifacts(manifest, 'specify', cwd).valid, true);
  });

  it('requires artifact finding IDs to match the structured review log', () => {
    const dir = path.join(cwd, '.changes', 'active', manifest.id);
    fs.writeFileSync(path.join(dir, 'architecture.md'), [
      '## Summary', 'x', '## Architecture Confirmation Ledger',
      '| ID | Material topic | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
      '|---|---|---|---|---|---|---|',
      '## Architectural Decisions', 'x', '## Seams', 'x',
      '## Review Cycle Reference', 'Cycle: architect-1',
      '## Validity Check Results', '**Status:** passed',
    ].join('\n'));
    appendReview(manifest.id, {
      version: 2, cycle: 'architect-1', phase: 'architect', role: 'auditor', reviewer: 'critic-a',
      verdict: 'changes-requested', findings: [{
        id: 'AV-001', severity: 'major', category: 'correctness', location: 'architecture.md:1',
        impact: 'contract is incomplete', alternative: 'define the missing contract',
      }], at: new Date().toISOString(),
    }, cwd);

    let result = validateApprovalArtifacts(manifest, 'architect', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /missing: AV-001/);

    fs.appendFileSync(path.join(dir, 'architecture.md'), '\n' + [
      '| ID | Severity | Category | Evidence | Concrete impact | Alternative | Remediation | Review log |',
      '|---|---|---|---|---|---|---|---|',
      '| AV-001 | major | correctness | architecture.md:1 | contract is incomplete | define it | complete | reviews.json |',
    ].join('\n'));
    result = validateApprovalArtifacts(manifest, 'architect', cwd);
    assert.equal(result.valid, true, result.errors.join('\n'));
  });

  it('requires decisions to reference the current specify review epoch', () => {
    manifest.review_epochs = { specify: 2 };
    const dir = path.join(cwd, '.changes', 'active', manifest.id);
    const decisions = cycle => [
      '## Confirmation Ledger',
      '| ID | Material question | Recommendation and rationale | Alternatives | Explicit user response | Status | Final decision |',
      '|---|---|---|---|---|---|---|',
      '| D-001 | q | r | none | accept | confirmed | yes |',
      '## Interface Changes', '## Decision Log', '## Dry-Run Findings',
      '## Review Cycle Reference', `Cycle: ${cycle}`,
    ].join('\n');

    fs.writeFileSync(path.join(dir, 'decisions.md'), decisions('specify-2'));
    assert.equal(validateApprovalArtifacts(manifest, 'specify', cwd).valid, true);

    fs.writeFileSync(path.join(dir, 'decisions.md'), decisions('specify-1'));
    const result = validateApprovalArtifacts(manifest, 'specify', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /must be specify-2/);
  });
});
