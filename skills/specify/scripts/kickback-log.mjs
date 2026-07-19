#!/usr/bin/env node
/**
 * kickback-log.mjs — Log a kickback entry to a change manifest.
 *
 * Usage:
 *   node kickback-log.mjs --id <id> --type defect|amendment --stage specify|plan|implement \
 *     --missed "What the spec should have caught" --resolution "What was decided"
 *
 * Output (stdout): JSON { id, kickback, total_defects, frequency }
 * Progress (stderr): human-readable
 */

import { parseArgs } from 'util';
import {
  readManifest,
  writeManifest,
  listActiveChanges,
} from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    id:         { type: 'string' },
    type:       { type: 'string' },   // defect | amendment
    stage:      { type: 'string' },   // specify | plan | implement
    missed:     { type: 'string' },
    resolution: { type: 'string', default: '' },
  },
  strict: true,
});

if (!values.id || !values.type || !values.stage || !values.missed) {
  console.error('Usage: kickback-log.mjs --id <id> --type defect|amendment --stage <stage> --missed "<text>" [--resolution "<text>"]');
  process.exit(1);
}

if (!['defect', 'amendment'].includes(values.type)) {
  console.error('--type must be defect or amendment');
  process.exit(1);
}

if (!['specify', 'plan', 'implement'].includes(values.stage)) {
  console.error('--stage must be specify, plan, or implement');
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

const entry = {
  type:       values.type,
  stage:      values.stage,
  at:         new Date().toISOString(),
  missed:     values.missed,
  resolution: values.resolution || '',
};

manifest.kickbacks = manifest.kickbacks || [];
manifest.kickbacks.push(entry);

writeManifest(values.id, manifest, repoRoot);

const defectCount = manifest.kickbacks.filter(k => k.type === 'defect').length;
const totalChanges = listActiveChanges(repoRoot).length + 1; // +1 approximate; accurate tracking requires completed changes count
const frequency = defectCount; // raw count; ratio requires total completed changes

console.error(`Kickback logged for change '${values.id}':`);
console.error(`  Type:       ${values.type}`);
console.error(`  Stage:      ${values.stage}`);
console.error(`  Missed:     ${values.missed}`);
if (values.resolution) console.error(`  Resolution: ${values.resolution}`);
console.error(`  Total defect kickbacks this change: ${defectCount}`);

if (values.type === 'defect') {
  console.error(`\nThis is a DEFECT kickback — the spec process should have caught this.`);
  console.error(`Return to 'specify' for an amendment session before resuming 'implement'.`);
} else {
  console.error(`\nThis is an AMENDMENT kickback — legitimate requirement evolution.`);
  console.error(`Return to 'specify' to incorporate the new information.`);
}

process.stdout.write(JSON.stringify({
  id: values.id,
  kickback: entry,
  total_defects: defectCount,
  frequency,
}) + '\n');
