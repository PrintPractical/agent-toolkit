#!/usr/bin/env node
/** Log or resolve a legal feature-spine kickback. */

import { parseArgs } from 'util';
import { readManifest, writeManifest, listActiveChanges, kickbackImpact } from './lib/index.mjs';

const { values } = parseArgs({ options: {
  help: { type: 'boolean', short: 'h', default: false }, id: { type: 'string' }, type: { type: 'string' },
  phase: { type: 'string' }, missed: { type: 'string' }, resolution: { type: 'string', default: '' },
  impact: { type: 'string', default: 'specify' }, resolve: { type: 'string' },
}, strict: true });
const usage = 'Usage: kickback-log.mjs --id <id> --type defect|amendment --phase specify|plan|implement --impact specify|plan|implementation --missed "<text>"\n       kickback-log.mjs --id <id> --resolve <1-based-entry> --resolution "<text>"';
if (values.help) { console.log(usage); process.exit(0); }
if (!values.id) { console.error(usage); process.exit(1); }
const repoRoot = process.cwd();
let manifest;
try { manifest = readManifest(values.id, repoRoot); } catch (error) { console.error(`Error: ${error.message}`); process.exit(1); }
if (values.resolve) {
  const index = Number(values.resolve);
  if (!Number.isInteger(index) || index < 1 || index > (manifest.kickbacks || []).length || !values.resolution.trim()) {
    console.error('Resolve requires a valid --resolve entry number and non-empty --resolution.'); process.exit(1);
  }
  manifest.kickbacks[index - 1].resolution = values.resolution.trim();
  writeManifest(values.id, manifest, repoRoot);
  process.stdout.write(JSON.stringify({ id: values.id, resolved: index }) + '\n');
  process.exit(0);
}
if (!values.type || !values.phase || !values.missed) { console.error(usage); process.exit(1); }
if (!['defect', 'amendment'].includes(values.type)) { console.error('--type must be defect or amendment'); process.exit(1); }
if (!['specify', 'plan', 'implement'].includes(values.phase)) { console.error('--phase must be specify, plan, or implement'); process.exit(1); }
if (manifest.class !== 'feature' || !['specify', 'plan', 'implement'].includes(manifest.phase)) {
  console.error(`Kickbacks apply only to an active feature spine; '${manifest.class}' is at '${manifest.phase}'.`); process.exit(1);
}
let impact;
try { impact = kickbackImpact(values.impact); } catch (error) { console.error(error.message); process.exit(1); }
if (['specify', 'plan', 'implement'].indexOf(impact.restartPhase) > ['specify', 'plan', 'implement'].indexOf(manifest.phase)) {
  console.error(`Kickback impact '${impact.impact}' cannot advance phase '${manifest.phase}'.`); process.exit(1);
}
const entry = {
  type: values.type, phase: values.phase, at: new Date().toISOString(), missed: values.missed,
  resolution: values.resolution, impact: impact.impact, invalidated_approvals: impact.invalidatedApprovals.join(','), restart_phase: impact.restartPhase,
};
manifest.kickbacks = manifest.kickbacks || [];
manifest.kickbacks.push(entry);
for (const approval of impact.invalidatedApprovals) manifest.approvals[approval] = 'pending';
manifest.review_epochs = manifest.review_epochs || {};
for (const phase of impact.reviewPhases) manifest.review_epochs[phase] = (manifest.review_epochs[phase] || 1) + 1;
manifest.phase = impact.restartPhase;
writeManifest(values.id, manifest, repoRoot);
const defectCount = manifest.kickbacks.filter(kickback => kickback.type === 'defect').length;
process.stdout.write(JSON.stringify({ id: values.id, kickback: entry, total_defects: defectCount, active_changes: listActiveChanges(repoRoot).length, phase: manifest.phase, reset_approvals: impact.invalidatedApprovals }) + '\n');
