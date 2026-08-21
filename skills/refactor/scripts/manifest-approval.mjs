#!/usr/bin/env node
/** Read, grant, or reverse one validated lifecycle approval. */

import path from 'path';
import { spawnSync } from 'child_process';
import { parseArgs } from 'util';
import {
  readManifest,
  writeManifest,
  APPROVALS,
  nextSkill,
  reviewApprovalReady,
  phaseForApproval,
  nextPhaseForApproval,
  allowedApprovalsFor,
  validateManifestState,
  validateApprovalArtifacts,
  epicStatus,
} from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h', default: false },
    id: { type: 'string' },
    approval: { type: 'string' },
    approve: { type: 'boolean', default: false },
    reset: { type: 'boolean', default: false },
  },
  strict: true,
});

const usage = 'Usage: manifest-approval.mjs --id <id> --approval <approval> [--approve|--reset]';
if (values.help) { console.log(usage); process.exit(0); }
if (!values.id || !values.approval) { console.error(usage); process.exit(1); }
if (!APPROVALS.includes(values.approval)) { console.error(`Invalid approval: ${values.approval}`); process.exit(1); }
if (values.approve && values.reset) { console.error('Cannot use --approve and --reset together'); process.exit(1); }

const repoRoot = process.cwd();
let manifest;
try { manifest = readManifest(values.id, repoRoot); } catch (error) { console.error(`Error: ${error.message}`); process.exit(1); }

const allowed = allowedApprovalsFor(manifest);
if (!allowed.includes(values.approval)) {
  console.error(`Approval '${values.approval}' does not apply to a '${manifest.class}' change. Allowed: ${allowed.join(', ')}`);
  process.exit(1);
}

function reviewPhaseForApproval() {
  if (['architect', 'specify'].includes(values.approval) && ['feature', 'epic'].includes(manifest.class)) return values.approval;
  if (values.approval === 'implement' && manifest.class === 'feature') return 'implement';
  if (values.approval === 'implement' && manifest.class === 'refactor') return 'refactor';
  return null;
}

function verifyContexts() {
  const script = path.join(path.dirname(new URL(import.meta.url).pathname), 'context-verify.mjs');
  for (const target of manifest.context_targets || []) {
    const result = spawnSync(process.execPath, [script, '--path', target, '--run-tests'], { cwd: repoRoot, encoding: 'utf8' });
    if (result.status !== 0) return result.stderr.trim() || result.stdout.trim() || `verification failed for '${target}'`;
  }
  return null;
}

if (values.approve) {
  const errors = validateManifestState(manifest);
  if (errors.length) { console.error(`Cannot approve an invalid manifest: ${errors.join('; ')}`); process.exit(1); }
  if (manifest.phase !== phaseForApproval(manifest, values.approval)) {
    console.error(`Cannot approve the ${values.approval} approval while phase is '${manifest.phase}'; expected '${phaseForApproval(manifest, values.approval)}'.`);
    process.exit(1);
  }
  const earlier = allowed.slice(0, allowed.indexOf(values.approval)).filter(approval => approval !== 'docs');
  if (values.approval === 'docs' && manifest.class !== 'epic' && manifest.approvals.implement !== 'approved') {
    console.error(`Cannot approve docs before implement is approved for '${values.id}'.`);
    process.exit(1);
  }
  if (!earlier.every(approval => manifest.approvals[approval] === 'approved')) {
    console.error(`Cannot approve ${values.approval} before all required predecessor approvals are approved.`);
    process.exit(1);
  }
  if ((manifest.kickbacks || []).some(kickback => !kickback.resolution)) {
    console.error('Cannot approve while a kickback remains unresolved. Resolve it with kickback-log.mjs resolve.');
    process.exit(1);
  }
  const artifactValidation = validateApprovalArtifacts(manifest, values.approval, repoRoot);
  if (!artifactValidation.valid) {
    console.error(`Cannot approve the ${values.approval} approval: artifact validation failed.`);
    artifactValidation.errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }
  const reviewPhase = reviewPhaseForApproval();
  if (reviewPhase) {
    const review = reviewApprovalReady(values.id, reviewPhase, repoRoot);
    if (!review.ready) { console.error(`Cannot approve the ${values.approval} approval: independent review not satisfied — ${review.reason}.`); process.exit(1); }
  }
  if (values.approval === 'docs') {
    if (manifest.class === 'epic') {
      const status = epicStatus(manifest, repoRoot);
      if (!manifest.children.length || status.ready !== manifest.children.length) {
        console.error('Cannot approve epic docs until every child is archive-ready.');
        process.exit(1);
      }
    }
  }
  if (values.approval === 'implement' || values.approval === 'docs') {
    const contextError = verifyContexts();
    if (contextError) { console.error(`Cannot approve ${values.approval}: ${contextError}`); process.exit(1); }
  }
  manifest.approvals[values.approval] = 'approved';
  manifest.phase = nextPhaseForApproval(manifest, values.approval);
  writeManifest(values.id, manifest, repoRoot);
  console.error(`Approval '${values.approval}' approved for change '${values.id}'`);
  const skill = nextSkill(manifest);
  if (skill) console.error(`Next skill: ${skill}`);
  process.stdout.write(JSON.stringify({ id: values.id, approval: values.approval, status: 'approved', phase: manifest.phase }) + '\n');
} else if (values.reset) {
  if (manifest.phase === 'archive-ready') { console.error('Cannot reset an archive-ready change. Log a kickback instead.'); process.exit(1); }
  const downstream = allowed.slice(allowed.indexOf(values.approval) + 1).filter(approval => manifest.approvals?.[approval] === 'approved');
  if (downstream.length) { console.error(`Cannot reset ${values.approval} while downstream approvals are approved: ${downstream.join(', ')}`); process.exit(1); }
  manifest.approvals[values.approval] = 'pending';
  manifest.phase = phaseForApproval(manifest, values.approval);
  writeManifest(values.id, manifest, repoRoot);
  console.error(`Approval '${values.approval}' reset to pending for change '${values.id}'`);
  process.stdout.write(JSON.stringify({ id: values.id, approval: values.approval, status: 'pending', phase: manifest.phase }) + '\n');
} else {
  const status = manifest.approvals?.[values.approval] || 'pending';
  process.stdout.write(JSON.stringify({ id: values.id, approval: values.approval, status }) + '\n');
}
