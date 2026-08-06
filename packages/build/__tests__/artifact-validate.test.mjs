import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateGateArtifacts, writeManifest } from '../lib/index.mjs';

describe('validateGateArtifacts', () => {
  let cwd;
  let manifest;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-artifacts-'));
    manifest = {
      id: '2026-08-06-artifacts', title: 'Artifacts', class: 'feature', stage: 'specify',
      artifacts: { architecture: 'architecture.md', decisions: 'decisions.md', plan: 'plan.md' },
      gates: {}, context_targets: [], kickbacks: [],
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
    const result = validateGateArtifacts(manifest, 'specify', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /not explicitly confirmed/);
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
    ].join('\n'));
    assert.equal(validateGateArtifacts(manifest, 'specify', cwd).valid, true);
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
    ].join('\n'));
    const result = validateGateArtifacts(manifest, 'specify', cwd);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /unresolved dry-run blocker/);
  });
});
