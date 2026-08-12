#!/usr/bin/env node
/**
 * kickback-log.mjs — Log a kickback entry to a change manifest.
 *
 * Usage:
 *   node kickback-log.mjs --id <id> --type defect|amendment --phase specify|plan|implement \
 *     --impact specify|plan|implementation --missed "What the spec should have caught"
 *
 * Output (stdout): JSON { id, kickback, total_defects, frequency }
 * Progress (stderr): human-readable
 */

import { parseArgs } from 'util';
import {
  readManifest,
  writeManifest,
  listActiveChanges,
  kickbackImpact,
} from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    help:       { type: 'boolean', short: 'h', default: false },
    id:         { type: 'string' },
    type:       { type: 'string' },   // defect | amendment
    phase:      { type: 'string' },   // specify | plan | implement
    missed:     { type: 'string' },
    resolution: { type: 'string', default: '' },
    impact:     { type: 'string', default: 'specify' },
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: kickback-log.mjs --id <id> --type defect|amendment --phase <phase> --impact specify|plan|implementation --missed "<text>" [--resolution "<text>"]');
  process.exit(0);
}

if (!values.id || !values.type || !values.phase || !values.missed) {
  console.error('Usage: kickback-log.mjs --id <id> --type defect|amendment --phase <phase> --impact specify|plan|implementation --missed "<text>" [--resolution "<text>"]');
  process.exit(1);
}

if (!['defect', 'amendment'].includes(values.type)) {
  console.error('--type must be defect or amendment');
  process.exit(1);
}

if (!['specify', 'plan', 'implement'].includes(values.phase)) {
  console.error('--phase must be specify, plan, or implement');
  process.exit(1);
}

const repoRoot = process.cwd();
let manifest;

try {
  manifest = readManifest(values.id, repoRoot);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}

let impact;
try {
  impact = kickbackImpact(values.impact);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const entry = {
  type:       values.type,
  phase:      values.phase,
  at:         new Date().toISOString(),
  missed:     values.missed,
  resolution: values.resolution || '',
  impact: impact.impact,
  invalidated_approvals: impact.invalidatedApprovals.join(','),
  restart_phase: impact.restartPhase,
};

manifest.kickbacks = manifest.kickbacks || [];
manifest.kickbacks.push(entry);
manifest.approvals = manifest.approvals || {};
for (const approval of impact.invalidatedApprovals) manifest.approvals[approval] = 'pending';
manifest.phase = impact.restartPhase;

writeManifest(values.id, manifest, repoRoot);

const defectCount = manifest.kickbacks.filter(k => k.type === 'defect').length;
const totalChanges = listActiveChanges(repoRoot).length + 1; // +1 approximate; accurate tracking requires completed changes count
const frequency = defectCount; // raw count; ratio requires total completed changes

console.error(`Kickback logged for change '${values.id}':`);
console.error(`  Type:       ${values.type}`);
  console.error(`  Phase:      ${values.phase}`);
console.error(`  Missed:     ${values.missed}`);
if (values.resolution) console.error(`  Resolution: ${values.resolution}`);
console.error(`  Total defect kickbacks this change: ${defectCount}`);
console.error(`  Impact:     ${impact.impact}`);
console.error(`  Restart:    ${impact.restartPhase} (${impact.invalidatedApprovals.length ? `${impact.invalidatedApprovals.join(', ')} approval(s) reset` : 'no upstream approvals reset'})`);

if (values.type === 'defect') {
  console.error(`\nThis is a DEFECT kickback — the spec process should have caught this.`);
  console.error(`Resume at '${impact.restartPhase}' and re-approve only the invalidated approvals.`);
} else {
  console.error(`\nThis is an AMENDMENT kickback — legitimate requirement evolution.`);
  console.error(`Resume at '${impact.restartPhase}' and re-approve only the invalidated approvals.`);
}

process.stdout.write(JSON.stringify({
  id: values.id,
  kickback: entry,
  total_defects: defectCount,
  frequency,
  phase: manifest.phase,
  reset_approvals: impact.invalidatedApprovals,
}) + '\n');
