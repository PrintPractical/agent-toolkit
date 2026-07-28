#!/usr/bin/env node
/**
 * manifest-gate.mjs — Read or update a gate on a change manifest.
 *
 * Usage:
 *   node manifest-gate.mjs --id <id> --gate <gate>                   # read gate status
 *   node manifest-gate.mjs --id <id> --gate <gate> --approve         # approve gate
 *   node manifest-gate.mjs --id <id> --gate <gate> --reset           # reset to pending
 *   node manifest-gate.mjs --id <id> --stage <stage>                 # advance stage
 *
 * Output (stdout): JSON { id, gate, status } or { id, stage }
 * Progress (stderr): human-readable status
 */

import { parseArgs } from 'util';
import {
  readManifest,
  writeManifest,
  GATES,
  STAGES,
  nextSkill,
} from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    help:    { type: 'boolean', short: 'h', default: false },
    id:      { type: 'string' },
    gate:    { type: 'string' },
    stage:   { type: 'string' },
    approve: { type: 'boolean', default: false },
    reset:   { type: 'boolean', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: manifest-gate.mjs --id <id> --gate <gate> [--approve|--reset]');
  console.log('       manifest-gate.mjs --id <id> --stage <stage>');
  process.exit(0);
}

if (!values.id) {
  console.error('Usage: manifest-gate.mjs --id <id> --gate <gate> [--approve|--reset]');
  console.error('       manifest-gate.mjs --id <id> --stage <stage>');
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

// Stage update mode
if (values.stage) {
  if (!STAGES.includes(values.stage)) {
    console.error(`Invalid stage: ${values.stage}. Must be one of: ${STAGES.join(', ')}`);
    process.exit(1);
  }
  manifest.stage = values.stage;
  writeManifest(values.id, manifest, repoRoot);
  console.error(`Stage set to '${values.stage}' for change '${values.id}'`);
  const skill = nextSkill(manifest);
  if (skill) console.error(`Next skill: ${skill}`);
  process.stdout.write(JSON.stringify({ id: values.id, stage: values.stage }) + '\n');
  process.exit(0);
}

// Gate read/update mode
if (!values.gate) {
  console.error('Specify --gate <gate> or --stage <stage>');
  process.exit(1);
}

if (!GATES.includes(values.gate)) {
  console.error(`Invalid gate: ${values.gate}. Must be one of: ${GATES.join(', ')}`);
  process.exit(1);
}

if (values.approve && values.reset) {
  console.error('Cannot use --approve and --reset together');
  process.exit(1);
}

const currentStatus = manifest.gates?.[values.gate] ?? 'pending';

if (values.approve) {
  manifest.gates = manifest.gates || {};
  manifest.gates[values.gate] = 'approved';

  // Auto-advance stage when a gate is approved.
  // Epics follow a different progression: architect → specify → (decompose) → done
  // They never advance to plan or implement.
  const isEpic = manifest.class === 'epic';

  const gateToStageMap = isEpic
    ? {
        architect: 'specify',
        specify:   'specify', // epics stay at specify until decomposed; epic-split drives done
        docs:      'done',
      }
    : {
        architect: 'specify',
        specify:   'plan',
        plan:      'implement',
        implement: 'implement', // stays implement until docs also approved
        docs:      'done',
      };

  if (values.gate === 'docs') {
    manifest.stage = 'done';
  } else if (gateToStageMap[values.gate]) {
    // Only advance if currently at the expected stage
    if (manifest.stage === values.gate) {
      manifest.stage = gateToStageMap[values.gate];
    }
  }

  // For epics: after specify is approved, prompt the user to decompose
  if (isEpic && values.gate === 'specify') {
    const children = manifest.children || [];
    if (children.length === 0) {
      console.error(`\nEpic specify gate approved.`);
      console.error(`Next: run epic-split to create child change manifests:`);
      console.error(`  node packages/build/epic-split.mjs --epic ${values.id} --children '[...]'`);
      console.error(`  (architect will generate the children JSON from the architecture + decisions)`);
    } else {
      console.error(`\nEpic specify gate approved. ${children.length} child change(s) already exist.`);
      console.error(`Run 'architect' on each child to begin implementation:`);
      children.forEach(c => console.error(`  node packages/build/change-status.mjs --id ${c}`));
    }
  }

  writeManifest(values.id, manifest, repoRoot);
  console.error(`Gate '${values.gate}' approved for change '${values.id}'`);
  const skill = nextSkill(manifest);
  if (skill) console.error(`Next skill: ${skill}`);

  process.stdout.write(JSON.stringify({ id: values.id, gate: values.gate, status: 'approved' }) + '\n');

} else if (values.reset) {
  manifest.gates = manifest.gates || {};
  manifest.gates[values.gate] = 'pending';
  writeManifest(values.id, manifest, repoRoot);
  console.error(`Gate '${values.gate}' reset to pending for change '${values.id}'`);
  process.stdout.write(JSON.stringify({ id: values.id, gate: values.gate, status: 'pending' }) + '\n');

} else {
  // Read-only
  console.error(`Gate '${values.gate}' for change '${values.id}': ${currentStatus}`);
  process.stdout.write(JSON.stringify({ id: values.id, gate: values.gate, status: currentStatus }) + '\n');
}
