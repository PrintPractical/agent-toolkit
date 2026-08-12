#!/usr/bin/env node
/**
 * manifest-approval.mjs — Read or update an approval on a change manifest.
 *
 * Usage:
 *   node manifest-approval.mjs --id <id> --approval <approval>                   # read approval status
 *   node manifest-approval.mjs --id <id> --approval <approval> --approve         # approve
 *   node manifest-approval.mjs --id <id> --approval <approval> --reset           # reset to pending
 *
 * Output (stdout): JSON { id, approval, status }
 * Progress (stderr): human-readable status
 */

import { parseArgs } from 'util';
import {
  readManifest,
  writeManifest,
  APPROVALS,
  nextSkill,
  reviewApprovalReady,
  phaseForApproval,
  validateApprovalArtifacts,
  completeEpicIfDelivered,
} from './lib/index.mjs';

// Which approvals are meaningful for each change class. A refactor never enters the
// spec spine; an epic never plans or implements directly.
const ALLOWED_APPROVALS = {
  refactor: ['refactor', 'implement', 'docs'],
  epic:     ['architect', 'specify'],
};

function allowedApprovalsFor(manifest) {
  return ALLOWED_APPROVALS[manifest.class] || ['architect', 'specify', 'plan', 'implement', 'docs'];
}

// Feature and epic architecture/specification artifacts require bounded review
// cycles. Formal implementation review remains limited to feature/refactor;
// lightweight bug/small changes and epic implementation are exempt.
function reviewPhaseForApproval(manifest, approval) {
  if (['architect', 'specify'].includes(approval) && ['feature', 'epic'].includes(manifest.class)) return approval;
  if (approval === 'implement' && manifest.class === 'refactor') return 'refactor';
  if (approval === 'implement' && manifest.class === 'feature') return 'implement';
  return null;
}

const { values } = parseArgs({
  options: {
    help:    { type: 'boolean', short: 'h', default: false },
    id:      { type: 'string' },
    approval:{ type: 'string' },
    approve: { type: 'boolean', default: false },
    reset:   { type: 'boolean', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: manifest-approval.mjs --id <id> --approval <approval> [--approve|--reset]');
  process.exit(0);
}

if (!values.id) {
  console.error('Usage: manifest-approval.mjs --id <id> --approval <approval> [--approve|--reset]');
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

if (!values.approval) {
  console.error('Specify --approval <approval>');
  process.exit(1);
}

if (!APPROVALS.includes(values.approval)) {
  console.error(`Invalid approval: ${values.approval}. Must be one of: ${APPROVALS.join(', ')}`);
  process.exit(1);
}

const allowedApprovals = allowedApprovalsFor(manifest);
if (!allowedApprovals.includes(values.approval)) {
  console.error(`Approval '${values.approval}' does not apply to a '${manifest.class || 'feature'}' change. Allowed: ${allowedApprovals.join(', ')}`);
  process.exit(1);
}

if (values.approve && values.reset) {
  console.error('Cannot use --approve and --reset together');
  process.exit(1);
}

const currentStatus = manifest.approvals?.[values.approval] ?? 'pending';

if (values.approve) {
  manifest.approvals = manifest.approvals || {};

  // ── Approval preconditions (no file tracking; ordering + review only) ──

  const expectedPhase = phaseForApproval(manifest, values.approval);
  if (manifest.phase !== expectedPhase) {
    console.error(`Cannot approve the ${values.approval} approval while phase is '${manifest.phase}'; expected '${expectedPhase}'.`);
    process.exit(1);
  }

  const validation = validateApprovalArtifacts(manifest, values.approval, repoRoot);
  if (!validation.valid) {
    console.error(`Cannot approve the ${values.approval} approval: artifact validation failed.`);
    validation.errors.forEach(error => console.error(`  - ${error}`));
    process.exit(1);
  }

  // Ordering: for classes that implement, docs cannot precede implement.
  if (values.approval === 'docs' && allowedApprovals.includes('implement') && manifest.approvals.implement !== 'approved') {
    console.error(`Cannot approve docs before implement is approved for '${values.id}'.`);
    process.exit(1);
  }

  // Applicable approvals require a completed bounded independent-review cycle.
  const reviewPhase = reviewPhaseForApproval(manifest, values.approval);
  if (reviewPhase) {
    const review = reviewApprovalReady(values.id, reviewPhase, repoRoot);
    if (!review.ready) {
      console.error(`Cannot approve the ${values.approval} approval: independent review not satisfied — ${review.reason}.`);
      console.error(`Record one discovery auditor and a distinct verifier approval with review-log.mjs (phase ${reviewPhase}).`);
      process.exit(1);
    }
  }

  manifest.approvals[values.approval] = 'approved';

  // Auto-advance phase when an approval is approved.
  // Epics follow a different progression: architect → specify → (decompose) → done
  // They never advance to plan or implement.
  const isEpic = manifest.class === 'epic';
  const isRefactor = manifest.class === 'refactor';

  const approvalToPhaseMap = isEpic
    ? {
        architect: 'specify',
        specify:   'specify', // epics stay at specify until epic-split moves them to decomposed
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

  if (values.approval === 'docs') {
    manifest.phase = 'done';
  } else if (approvalToPhaseMap[values.approval]) {
    // Only advance if currently at the expected phase
    if (manifest.phase === values.approval) {
      manifest.phase = approvalToPhaseMap[values.approval];
    }
  }

  // For epics: after specify is approved, prompt the user to decompose
  if (isEpic && values.approval === 'specify') {
    const children = manifest.children || [];
    if (children.length === 0) {
      console.error(`\nEpic specify approval recorded.`);
      console.error(`Next: run epic-split to create child change manifests:`);
      console.error(`  node "$SKILL_DIR/scripts/epic-split.mjs" --epic ${values.id} --children '[...]'`);
      console.error(`  (architect will generate the children JSON from the architecture + decisions)`);
    } else {
      console.error(`\nEpic specify approval recorded. ${children.length} child change(s) already exist.`);
      console.error(`Run 'architect' on each child to begin implementation:`);
      children.forEach(c => console.error(`  node "$SKILL_DIR/scripts/change-status.mjs" --id ${c}`));
    }
  }

  writeManifest(values.id, manifest, repoRoot);
  if (manifest.parent && manifest.phase === 'done') {
    const parent = completeEpicIfDelivered(manifest.parent, repoRoot);
    if (parent.phase === 'done') console.error(`Parent epic '${manifest.parent}' is complete.`);
  }
  console.error(`Approval '${values.approval}' approved for change '${values.id}'`);
  const skill = nextSkill(manifest);
  if (skill) console.error(`Next skill: ${skill}`);

  process.stdout.write(JSON.stringify({ id: values.id, approval: values.approval, status: 'approved' }) + '\n');

} else if (values.reset) {
  manifest.approvals = manifest.approvals || {};
  manifest.approvals[values.approval] = 'pending';
  writeManifest(values.id, manifest, repoRoot);
  console.error(`Approval '${values.approval}' reset to pending for change '${values.id}'`);
  process.stdout.write(JSON.stringify({ id: values.id, approval: values.approval, status: 'pending' }) + '\n');

} else {
  // Read-only
  console.error(`Approval '${values.approval}' for change '${values.id}': ${currentStatus}`);
  process.stdout.write(JSON.stringify({ id: values.id, approval: values.approval, status: currentStatus }) + '\n');
}
