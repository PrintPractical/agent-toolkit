import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  appendReview,
  planTasks,
  renderTraceabilitySummary,
  traceabilityReport,
  validateApprovalArtifacts,
  writeManifest,
} from '../lib/index.mjs';

const templateDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..', '_templates');

const defaultSeam = '### Seam: Outcome [id: SEAM-OUTCOME] [firmness: soft]\n- [AC-OUTCOME] The requested outcome is observable.';

function architecture({ record = '', seam = defaultSeam } = {}) {
  const outcome = seam.match(/\[(AC-[A-Za-z0-9-]+)\]/)?.[1] || '';
  return [
    '## Summary', '## Architecture Confirmation Ledger', record,
    '## Architectural Decisions', '## Seams', `**Overall outcome criterion:** [${outcome}]`, seam,
    '## Validity Check Results', '**Status:** passed',
    '## Review Cycle Reference', 'Cycle: architect-1',
  ].join('\n');
}

function sectionContext(tasks = '') {
  return [
    '## Source reconnaissance', '- `src/example.js` and its tests',
    '## Section 1: Deliver outcome',
    '### Implementation context',
    '- **Observable outcome and acceptance criteria:** AC-OUTCOME',
    '- **Ownership and dependency direction:** Existing component owns the behavior.',
    '- **Existing mechanisms to reuse:** Existing component API.',
    '- **Domain facts that evolve together:** None.',
    '- **Responsibilities that remain distinct:** Input and output concerns.',
    '- **Expected touchpoints (non-binding):** `src/example.js`.',
    '- **Errors and invariants:** Existing errors remain stable.',
    '- **Exact verification:** `npm test`',
    tasks,
    '## Prospective implementability review',
    '- **Reviewer:** plan-reviewer',
    '- **Source walked:** `src/example.js`, its tests, and package metadata.',
    '- **Coverage:** Ownership, reuse, representations, domain facts, boundaries, and idioms.',
    '- **Findings incorporated:** none-clean',
    '- **Unresolved material findings:** none',
    '- **Implementability status:** passed',
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
      sectionContext('- [ ] [T-001] Implement endpoint [AC-API]'),
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'plan.md'), stalePlan);
    let result = validateApprovalArtifacts(manifest, 'plan', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /firm seams without firm-seam test tasks/);
    assert.match(result.errors.join('\n'), /summary is stale/);

    const plan = [
      '## Traceability check',
      '<!-- traceability:start -->', '<!-- traceability:end -->',
      sectionContext([
        '- [ ] [T-001] Implement endpoint [AC-API]',
        '- [ ] [T-002] Write API test [AC-API] [test: criterion] [seam: SEAM-API] [firmness: firm]',
      ].join('\n')),
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'plan.md'), plan);
    const report = traceabilityReport(manifest, cwd);
    fs.writeFileSync(path.join(dir, 'plan.md'), plan.replace('<!-- traceability:start -->\n<!-- traceability:end -->', renderTraceabilitySummary(report)));
    result = validateApprovalArtifacts(manifest, 'plan', cwd);
    assert.equal(result.valid, true, result.errors.join('\n'));
  });

  it('requires every seam to link a behavioral acceptance criterion', () => {
    fs.writeFileSync(path.join(dir, 'architecture.md'), architecture({ seam: '### Seam: API [id: SEAM-API] [firmness: firm]\n- Contract is stable.' }));
    fs.writeFileSync(path.join(dir, 'plan.md'), [
      '## Traceability check', '<!-- traceability:start -->', '- No acceptance criteria declared.', '<!-- traceability:end -->',
      '- [ ] [T-001] Test API contract [seam: SEAM-API] [firmness: firm]',
    ].join('\n'));

    const result = validateApprovalArtifacts(manifest, 'plan', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /seams without behavioral acceptance criteria: SEAM-API/);
  });

  it('requires criteria for soft seams and an observable criterion for the change', () => {
    fs.writeFileSync(path.join(dir, 'architecture.md'), architecture({ seam: '### Seam: UI [id: SEAM-UI] [firmness: soft]\n- Contract is evolving.' }));
    let result = validateApprovalArtifacts(manifest, 'architect', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /observable overall change outcome/);
    assert.match(result.errors.join('\n'), /seams without behavioral acceptance criteria: SEAM-UI/);

    fs.writeFileSync(path.join(dir, 'architecture.md'), architecture({ seam: '' }));
    result = validateApprovalArtifacts(manifest, 'architect', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /observable overall change outcome/);
  });

  it('does not attribute acceptance criteria after a seam section to that seam', () => {
    fs.writeFileSync(path.join(dir, 'architecture.md'), architecture({ seam: [
      '### Seam: API [id: SEAM-API] [firmness: soft]',
      'No criterion is declared here.',
      '## Observability Requirements',
      '- [AC-LATER] An unrelated metric is emitted.',
    ].join('\n') }));

    const result = validateApprovalArtifacts(manifest, 'architect', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /seams without behavioral acceptance criteria: SEAM-API/);
  });

  it('bounds task traceability at the next heading and requires standard test labels', () => {
    const tasks = planTasks([
      '## Section 1: API',
      '- [ ] [T-001] Implement API [AC-API]',
      '## Section 2: UI',
      '### Implementation context',
      '- **Observable outcome and acceptance criteria:** AC-UI',
      '- **Exact verification:** API tests',
      '- [ ] [T-002] Implement UI [AC-UI]',
    ].join('\n'));

    assert.deepEqual(tasks[0].criteria, ['AC-API']);
    assert.equal(tasks[0].isTest, false);
    assert.deepEqual(tasks[1].criteria, ['AC-UI']);
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

  it('rejects unresolved canonical templates despite formal review attestations', () => {
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
    assert.equal(validateApprovalArtifacts(manifest, 'architect', cwd).valid, false);
    assert.equal(validateApprovalArtifacts(manifest, 'specify', cwd).valid, false);
    assert.equal(validateApprovalArtifacts(manifest, 'plan', cwd).valid, false);
  });

  it('requires implementation context and a passed prospective review', () => {
    fs.writeFileSync(path.join(dir, 'architecture.md'), architecture());
    const plan = [
      '## Traceability check', '<!-- traceability:start -->', '<!-- traceability:end -->',
      '- [ ] [T-001] Implement outcome [AC-OUTCOME]',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'plan.md'), plan);
    const report = traceabilityReport(manifest, cwd);
    fs.writeFileSync(path.join(dir, 'plan.md'), plan.replace('<!-- traceability:start -->\n<!-- traceability:end -->', renderTraceabilitySummary(report)));

    const result = validateApprovalArtifacts(manifest, 'plan', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /Source reconnaissance/);
    assert.match(result.errors.join('\n'), /at least one implementation section/);
    assert.match(result.errors.join('\n'), /prospective implementability review/i);
    assert.match(result.errors.join('\n'), /must be passed/);
  });

  it('rejects placeholder implementation context and unevidenced prospective review', () => {
    fs.writeFileSync(path.join(dir, 'architecture.md'), architecture());
    const plan = [
      '## Traceability check', '<!-- traceability:start -->', '<!-- traceability:end -->',
      '## Source reconnaissance', '{{inspect source}}',
      '## Section 1: Deliver outcome', '### Implementation context',
      '- **Observable outcome and acceptance criteria:** {{outcome}}',
      '- **Ownership and dependency direction:** owner', '- **Existing mechanisms to reuse:** mechanism',
      '- **Domain facts that evolve together:** none', '- **Responsibilities that remain distinct:** boundaries',
      '- **Expected touchpoints (non-binding):** paths', '- **Errors and invariants:** invariants',
      '- **Exact verification:** command', '- [ ] [T-001] Implement [AC-OUTCOME]',
      '## Prospective implementability review', '- **Reviewer:**', '- **Source walked:** {{source}}',
      '- **Coverage:**', '- **Findings incorporated:**', '- **Unresolved material findings:** none',
      '- **Implementability status:** passed',
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'plan.md'), plan);
    const report = traceabilityReport(manifest, cwd);
    fs.writeFileSync(path.join(dir, 'plan.md'), plan.replace('<!-- traceability:start -->\n<!-- traceability:end -->', renderTraceabilitySummary(report)));

    const result = validateApprovalArtifacts(manifest, 'plan', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /Source reconnaissance/);
    assert.match(result.errors.join('\n'), /implementation context is incomplete/);
    assert.match(result.errors.join('\n'), /missing concrete evidence: Reviewer/);
  });

  it('rejects an empty reconnaissance section containing only a separator', () => {
    fs.writeFileSync(path.join(dir, 'architecture.md'), architecture());
    const plan = [
      '## Traceability check', '<!-- traceability:start -->', '<!-- traceability:end -->',
      sectionContext('- [ ] [T-001] Implement outcome [AC-OUTCOME]'),
    ].join('\n').replace('## Source reconnaissance\n- `src/example.js` and its tests', '## Source reconnaissance\n---');
    fs.writeFileSync(path.join(dir, 'plan.md'), plan);
    const report = traceabilityReport(manifest, cwd);
    fs.writeFileSync(path.join(dir, 'plan.md'), plan.replace('<!-- traceability:start -->\n<!-- traceability:end -->', renderTraceabilitySummary(report)));

    const result = validateApprovalArtifacts(manifest, 'plan', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /Source reconnaissance/);
  });

  it('rejects duplicate implementation section headings', () => {
    fs.writeFileSync(path.join(dir, 'architecture.md'), architecture());
    const duplicateSection = sectionContext('- [ ] [T-001] Implement outcome [AC-OUTCOME]');
    const plan = [
      '## Traceability check', '<!-- traceability:start -->', '<!-- traceability:end -->',
      duplicateSection.replace('## Prospective implementability review', '## Section 1: Deliver outcome\n### Implementation context\n- **Observable outcome and acceptance criteria:** AC-OUTCOME\n- **Ownership and dependency direction:** owner\n- **Existing mechanisms to reuse:** mechanism\n- **Domain facts that evolve together:** none\n- **Responsibilities that remain distinct:** boundaries\n- **Expected touchpoints (non-binding):** paths\n- **Errors and invariants:** invariants\n- **Exact verification:** command\n## Prospective implementability review'),
    ].join('\n');
    fs.writeFileSync(path.join(dir, 'plan.md'), plan);
    const report = traceabilityReport(manifest, cwd);
    fs.writeFileSync(path.join(dir, 'plan.md'), plan.replace('<!-- traceability:start -->\n<!-- traceability:end -->', renderTraceabilitySummary(report)));

    const result = validateApprovalArtifacts(manifest, 'plan', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /section headings must be unique/);
  });

  it('requires feature implementation approaches, static checks, and quality signals', () => {
    fs.writeFileSync(path.join(dir, 'implementation.md'), [
      '## Completed work', '- complete', '## Verification',
      '| Kind | Command | Result | Evidence |', '|---|---|---|---|',
      '| tests | `npm test` | pass | green |',
      '**Context verification:** pass - reconciled',
    ].join('\n'));

    const result = validateApprovalArtifacts(manifest, 'implement', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /format\/lint\/typecheck/);
    assert.match(result.errors.join('\n'), /pre-code approach/);
    assert.match(result.errors.join('\n'), /missing quality signals/);
  });

  it('requires a complete pre-code approach for every plan section', () => {
    fs.writeFileSync(path.join(dir, 'plan.md'), [
      '## Section 1: First outcome', '## Section 2: Second outcome',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'implementation.md'), [
      '## Section approaches', '### Section 1: First outcome',
      '- **Recorded before source edits:** yes', '- **Verified mechanisms to reuse:** existing API',
      '- **Ownership and representation:** component owns state', '- **Standard language/library facilities:** standard parser',
      '- **Responsibility boundaries:** parsing remains separate', '- **Custom machinery justification:** none',
      '- **Evolution or justified deviations:** none',
      '## Verification', '| Kind | Command | Result | Evidence |', '|---|---|---|---|',
      '| tests | `npm test` | pass | green |', '| format/lint/typecheck | `npm run lint` | pass | clean |',
      '**Context verification:** pass - reconciled', '## Quality signals',
      '- **Implementation model/route:** test-model', '- **First-pass lint/typecheck result:** pass',
      '- **First-pass test result:** pass', '- **Unplanned ownership/representation changes:** none',
      '- **Final RV blocker/major findings by category:** none', '- **Post-review remediation size:** none',
      '- **Recurring finding categories:** none observed', '- **Reported implementation/review cost:** unavailable',
    ].join('\n'));

    const result = validateApprovalArtifacts(manifest, 'implement', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /pre-code approach for each implemented section/);
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
