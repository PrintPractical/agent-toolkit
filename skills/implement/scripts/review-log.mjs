#!/usr/bin/env node
/**
 * review-log.mjs — Record and query the independent implementation-review cycle.
 *
 * This is the lightweight replacement for the old snapshot-bound checkpoint
 * system. A review entry is an attestation — no content hashing, file locking,
 * epoch, or Git-index inspection. Two distinct reviewers drive the gate: a
 * fresh `auditor` records what should be refactored, and after the cleanup a
 * fresh `verifier` confirms behavior is preserved and approves.
 *
 * Usage:
 *   node review-log.mjs record --id <id> --stage implement|refactor \
 *     --role auditor|verifier --reviewer <label> --verdict approved|changes-requested \
 *     [--finding "<file[:line]> [category] <required action>"]...
 *
 *   node review-log.mjs status --id <id> [--stage implement|refactor]
 *
 * Output (stdout): JSON. Progress/status (stderr): human-readable.
 */

import { parseArgs } from 'util';
import {
  readManifest,
  appendReview,
  readReviews,
  latestReview,
  reviewGateReady,
  REVIEW_STAGES,
  REVIEW_ROLES,
  REVIEW_VERDICTS,
} from './lib/index.mjs';

const USAGE =
  'Usage:\n' +
  '  review-log.mjs record --id <id> --stage implement|refactor --role auditor|verifier \\\n' +
  '    --reviewer <label> --verdict approved|changes-requested [--finding "<text>"]...\n' +
  '  review-log.mjs status --id <id> [--stage implement|refactor]';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help:     { type: 'boolean', short: 'h', default: false },
    id:       { type: 'string' },
    stage:    { type: 'string' },
    role:     { type: 'string' },
    reviewer: { type: 'string' },
    verdict:  { type: 'string' },
    finding:  { type: 'string', multiple: true, default: [] },
  },
  strict: true,
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const command = positionals[0];
const repoRoot = process.cwd();

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

if (!command || !['record', 'status'].includes(command)) {
  console.error(USAGE);
  process.exit(1);
}

if (!values.id) fail('--id is required');

// Confirm the change exists before touching its review log.
try {
  readManifest(values.id, repoRoot);
} catch (e) {
  fail(e.message);
}

if (command === 'record') {
  if (!values.stage || !REVIEW_STAGES.includes(values.stage)) {
    fail(`--stage must be one of: ${REVIEW_STAGES.join(', ')}`);
  }
  if (!values.role || !REVIEW_ROLES.includes(values.role)) {
    fail(`--role must be one of: ${REVIEW_ROLES.join(', ')}`);
  }
  if (!values.reviewer || !values.reviewer.trim()) {
    fail('--reviewer must be a non-empty self-declared label');
  }
  if (!values.verdict || !REVIEW_VERDICTS.includes(values.verdict)) {
    fail(`--verdict must be one of: ${REVIEW_VERDICTS.join(', ')}`);
  }
  if (values.verdict === 'changes-requested' && values.finding.length === 0) {
    fail('a changes-requested verdict requires at least one --finding');
  }

  const reviewer = values.reviewer.trim();

  // An auditor and the approving verifier must be genuinely different reviewers.
  if (values.role === 'verifier' && values.verdict === 'approved') {
    const priorAuditor = readReviews(values.id, repoRoot)
      .filter(r => r.stage === values.stage)
      .find(r => r.role === 'auditor' && r.reviewer && r.reviewer !== reviewer);
    if (!priorAuditor) {
      fail(`cannot approve as verifier '${reviewer}': record a prior auditor review from a different reviewer for stage '${values.stage}' first`);
    }
  }

  const entry = {
    version: 1,
    stage: values.stage,
    role: values.role,
    reviewer,
    verdict: values.verdict,
    findings: values.finding,
    at: new Date().toISOString(),
  };

  appendReview(values.id, entry, repoRoot);
  const gate = reviewGateReady(values.id, values.stage, repoRoot);

  console.error(`Recorded ${values.role} review for '${values.id}' (stage ${values.stage}):`);
  console.error(`  Reviewer: ${reviewer}`);
  console.error(`  Verdict:  ${values.verdict}`);
  console.error(`  Findings: ${values.finding.length}`);
  console.error(`  Gate:     ${gate.ready ? 'READY' : 'not ready'} — ${gate.reason}`);

  process.stdout.write(JSON.stringify({ id: values.id, entry, gate }) + '\n');
  process.exit(0);
}

if (command === 'status') {
  const stages = values.stage ? [values.stage] : REVIEW_STAGES;
  if (values.stage && !REVIEW_STAGES.includes(values.stage)) {
    fail(`--stage must be one of: ${REVIEW_STAGES.join(', ')}`);
  }

  const report = {};
  for (const stage of stages) {
    const latest = latestReview(values.id, stage, repoRoot);
    const gate = reviewGateReady(values.id, stage, repoRoot);
    report[stage] = { latest, gate };
    console.error(`[${stage}] ${gate.ready ? 'READY' : 'not ready'} — ${gate.reason}`);
  }

  process.stdout.write(JSON.stringify({ id: values.id, stages: report }) + '\n');
  process.exit(0);
}
