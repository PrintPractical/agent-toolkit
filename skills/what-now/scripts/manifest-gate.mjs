#!/usr/bin/env node
/**
 * manifest-gate.mjs — Read or update a gate on a change manifest.
 *
 * Usage:
 *   node manifest-gate.mjs --id <id> --gate <gate>                   # read gate status
 *   node manifest-gate.mjs --id <id> --gate <gate> --approve         # approve gate
 *   node manifest-gate.mjs --id <id> --gate <gate> --reset           # reset to pending
 *
 * Output (stdout): JSON { id, gate, status }
 * Progress (stderr): human-readable status
 */

import { parseArgs } from 'util';
import {
  readManifest,
  writeManifest,
  GATES,
  STAGES,
  nextSkill,
  reviewGateReady,
  gateStage,
  validateGateArtifacts,
} from './lib/index.mjs';

// Which gates are meaningful for each change class. A refactor never enters the
// spec spine; an epic never plans or implements directly.
const ALLOWED_GATES = {
  refactor: ['refactor', 'implement', 'docs'],
  epic:     ['architect', 'specify', 'docs'],
};

function allowedGatesFor(manifest) {
  return ALLOWED_GATES[manifest.class] || ['architect', 'specify', 'plan', 'implement', 'docs'];
}

// Feature and epic architecture/specification artifacts require bounded review
// cycles. Formal implementation review remains limited to feature/refactor;
// lightweight bug/small changes and epic implementation are exempt.
function reviewStageForGate(manifest, gate) {
  if (['architect', 'specify'].includes(gate) && ['feature', 'epic'].includes(manifest.class)) return gate;
  if (gate === 'implement' && manifest.class === 'refactor') return 'refactor';
  if (gate === 'implement' && manifest.class === 'feature') return 'implement';
  return null;
}

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
  process.exit(0);
}

if (!values.id) {
  console.error('Usage: manifest-gate.mjs --id <id> --gate <gate> [--approve|--reset]');
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

// Stage query mode. Stage transitions are gate-driven.
if (values.stage) {
  if (!STAGES.includes(values.stage)) {
    console.error(`Invalid stage: ${values.stage}. Must be one of: ${STAGES.join(', ')}`);
    process.exit(1);
  }
  if (values.stage !== manifest.stage) {
    console.error('Direct stage changes are not supported. Approve or reset the corresponding gate instead.');
    process.exit(1);
  }
  writeManifest(values.id, manifest, repoRoot);
  console.error(`Stage is '${values.stage}' for change '${values.id}'`);
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

const allowedGates = allowedGatesFor(manifest);
if (!allowedGates.includes(values.gate)) {
  console.error(`Gate '${values.gate}' does not apply to a '${manifest.class || 'feature'}' change. Allowed: ${allowedGates.join(', ')}`);
  process.exit(1);
}

if (values.approve && values.reset) {
  console.error('Cannot use --approve and --reset together');
  process.exit(1);
}

const currentStatus = manifest.gates?.[values.gate] ?? 'pending';

if (values.approve) {
  manifest.gates = manifest.gates || {};

  // ── Approval preconditions (no file tracking; ordering + review only) ──

  const expectedStage = gateStage(manifest, values.gate);
  if (manifest.stage !== expectedStage) {
    console.error(`Cannot approve the ${values.gate} gate while stage is '${manifest.stage}'; expected '${expectedStage}'.`);
    process.exit(1);
  }

  const validation = validateGateArtifacts(manifest, values.gate, repoRoot);
  if (!validation.valid) {
    console.error(`Cannot approve the ${values.gate} gate: artifact validation failed.`);
    validation.errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }

  // Ordering: for classes that implement, docs cannot precede implement.
  if (values.gate === 'docs' && allowedGates.includes('implement') && manifest.gates.implement !== 'approved') {
    console.error(`Cannot approve the docs gate before the implement gate is approved for '${values.id}'.`);
    process.exit(1);
  }

  // Applicable gates require a completed bounded independent-review cycle.
  const reviewStage = reviewStageForGate(manifest, values.gate);
  if (reviewStage) {
    const gate = reviewGateReady(values.id, reviewStage, repoRoot);
    if (!gate.ready) {
      console.error(`Cannot approve the ${values.gate} gate: independent review not satisfied — ${gate.reason}.`);
      console.error(`Record one discovery auditor and a distinct verifier approval with review-log.mjs (stage ${reviewStage}).`);
      process.exit(1);
    }
  }

  manifest.gates[values.gate] = 'approved';

  // Auto-advance stage when a gate is approved.
  // Epics follow a different progression: architect → specify → (decompose) → done
  // They never advance to plan or implement.
  const isEpic = manifest.class === 'epic';
  const isRefactor = manifest.class === 'refactor';

  const gateToStageMap = isEpic
    ? {
        architect: 'specify',
        specify:   'specify', // epics stay at specify until decomposed; epic-split drives done
        docs:      'done',
      }
    : isRefactor
    ? {
        refactor:  'implement', // audit/selection approved → execute
        implement: 'implement', // stays implement until docs also approved
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
