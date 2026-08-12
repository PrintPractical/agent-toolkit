#!/usr/bin/env node
/**
 * review-log.mjs — Record and query bounded independent review cycles.
 *
 * A review entry is an attestation: no content hashing, file locking,
 * epoch, or Git-index inspection. A discovery auditor and distinct verifier
 * drive each formal architecture, specification, implementation, or refactor
 * approval.
 *
 * Usage (structured v2):
 *   node review-log.mjs record --id <id> --phase <phase> --cycle <cycle> \
 *     --role auditor|verifier --reviewer <label> --verdict approved|changes-requested \
 *     [--finding '<json>']... [--resolution <ID>=resolved|unresolved]... \
  *     [--regression '<json>']... [--regression-resolution <ID>=resolved|unresolved]...
 *
 *   node review-log.mjs status --id <id> [--phase <phase>]
 *
 * Output (stdout): JSON. Progress/status (stderr): human-readable.
 */

import { parseArgs } from 'util';
import {
  readManifest,
  appendReview,
  readReviews,
  latestReview,
  reviewApprovalReady,
  REVIEW_PHASES,
  REVIEW_ROLES,
  REVIEW_VERDICTS,
  REVIEW_RESOLUTION_STATUSES,
  structuredReviewCycleState,
} from './lib/index.mjs';

const USAGE =
  'Usage:\n' +
  '  review-log.mjs record --id <id> --phase architect|specify|implement|refactor --cycle <cycle> \\\n' +
  '    --role auditor --reviewer <label> --verdict <verdict> [--finding \'<json>\']...\n' +
  '  review-log.mjs record --id <id> --phase <phase> --cycle <cycle> --role verifier \\\n' +
  '    --reviewer <label> --verdict <verdict> [--resolution <ID>=resolved|unresolved]... \\\n' +
  '    [--regression \'<json>\']... [--regression-resolution <ID>=resolved|unresolved]...\n' +
  '  review-log.mjs status --id <id> [--phase <phase>]\n' +
  '\nFinding JSON: {"id":"RV-001","severity":"blocker|major","category":"correctness|security|simplicity|maintainability|idioms","location":"<path:line>","impact":"<impact>","alternative":"<concrete alternative>"}\n' +
  'All review records require a structured --cycle.';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    help:     { type: 'boolean', short: 'h', default: false },
    id:       { type: 'string' },
    phase:    { type: 'string' },
    role:     { type: 'string' },
    reviewer: { type: 'string' },
    verdict:  { type: 'string' },
    cycle:    { type: 'string' },
    finding:  { type: 'string', multiple: true, default: [] },
    resolution: { type: 'string', multiple: true, default: [] },
    regression: { type: 'string', multiple: true, default: [] },
    'regression-resolution': { type: 'string', multiple: true, default: [] },
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
  if (!values.phase || !REVIEW_PHASES.includes(values.phase)) {
    fail(`--phase must be one of: ${REVIEW_PHASES.join(', ')}`);
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
  if (!values.cycle) fail('--cycle is required for new review records');

  const reviewer = values.reviewer.trim();

  const reviews = readReviews(values.id, repoRoot);
  const structuredArgs = values.resolution.length + values.regression.length + values['regression-resolution'].length;

  let entry;
  {
    const cycle = values.cycle.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(cycle)) fail('--cycle must use letters, numbers, dot, underscore, or hyphen');
    const expectedCycle = `${values.phase}-1`;
    if (cycle !== expectedCycle) fail(`--cycle for phase '${values.phase}' must be '${expectedCycle}'`);
    const cycleEntries = reviews.filter(item => item.version === 2 && item.phase === values.phase && item.cycle === cycle);
    const otherCycles = reviews.filter(item => item.version === 2 && item.phase === values.phase && item.cycle !== cycle);
    const auditors = cycleEntries.filter(item => item.role === 'auditor');
    const verifiers = cycleEntries.filter(item => item.role === 'verifier');

    if (values.role === 'auditor') {
      if (otherCycles.length > 0) fail(`phase '${values.phase}' already used its bounded discovery cycle`);
      if (cycleEntries.length > 0) fail(`cycle '${cycle}' already exists; exactly one discovery auditor is allowed`);
      if (structuredArgs > 0) fail('auditor entries cannot contain resolutions or regressions');
      if (values.verdict === 'changes-requested' && values.finding.length === 0) fail('a changes-requested verdict requires at least one --finding');
    } else {
      if (auditors.length !== 1) fail(`cycle '${cycle}' requires exactly one discovery auditor before verification`);
      if (verifiers.length >= 2) fail(`cycle '${cycle}' already used its initial verification and one targeted re-verification`);
      if (values.finding.length > 0) fail('verifiers cannot add --finding entries; use --regression for blocker-only regressions');
      if (reviewer === auditors[0].reviewer) fail(`verifier reviewer must be different from auditor '${auditors[0].reviewer}'`);
      if (verifiers.some(item => item.reviewer === reviewer)) fail(`targeted re-verification requires a fresh verifier label`);
      const current = structuredReviewCycleState(reviews, values.phase, cycle);
      if (current.ready) fail(`cycle '${cycle}' is already ready and cannot be re-verified`);
    }

    const parseJsonFindings = (args, option) => args.map((value, index) => {
      try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected an object');
        return parsed;
      } catch (error) {
        fail(`${option} ${index + 1} must be a JSON object: ${error.message}`);
      }
    });
    const parseResolutions = (args, option) => args.map(value => {
      const match = /^([A-Z]{2}-[0-9]{3})=(resolved|unresolved)$/.exec(value);
      if (!match || !REVIEW_RESOLUTION_STATUSES.includes(match[2])) {
        fail(`${option} must be <ID>=resolved|unresolved (got '${value}')`);
      }
      return { id: match[1], status: match[2] };
    });

    entry = {
      version: 2,
      cycle,
      phase: values.phase,
      role: values.role,
      reviewer,
      verdict: values.verdict,
      ...(values.role === 'auditor'
        ? { findings: parseJsonFindings(values.finding, '--finding') }
        : {
            verification: verifiers.length === 0 ? 'initial' : 'targeted-reverification',
            resolutions: parseResolutions(values.resolution, '--resolution'),
            regressions: parseJsonFindings(values.regression, '--regression'),
            regressionResolutions: parseResolutions(values['regression-resolution'], '--regression-resolution'),
          }),
      at: new Date().toISOString(),
    };

    const existingIds = new Set(reviews
      .filter(item => item.version === 2 && item.cycle !== cycle)
      .flatMap(item => [...(item.findings || []), ...(item.regressions || [])].map(finding => finding.id)));
    const reusedId = [...(entry.findings || []), ...(entry.regressions || [])]
      .map(finding => finding.id)
      .find(findingId => existingIds.has(findingId));
    if (reusedId) fail(`structured finding id '${reusedId}' was already used in another review cycle`);

    const prospective = structuredReviewCycleState([...reviews, entry], values.phase, cycle);
    if (!prospective.valid) fail(prospective.errors.join('; '));
  }

  appendReview(values.id, entry, repoRoot);
  const approval = reviewApprovalReady(values.id, values.phase, repoRoot);

  console.error(`Recorded ${values.role} review for '${values.id}' (phase ${values.phase}):`);
  console.error(`  Reviewer: ${reviewer}`);
  console.error(`  Verdict:  ${values.verdict}`);
  console.error(`  Findings: ${values.finding.length + values.regression.length}`);
  console.error(`  Approval: ${approval.ready ? 'READY' : 'not ready'} — ${approval.reason}`);

  process.stdout.write(JSON.stringify({ id: values.id, entry, approval }) + '\n');
  process.exit(0);
}

if (command === 'status') {
  const phases = values.phase ? [values.phase] : REVIEW_PHASES;
  if (values.phase && !REVIEW_PHASES.includes(values.phase)) {
    fail(`--phase must be one of: ${REVIEW_PHASES.join(', ')}`);
  }

  const report = {};
  for (const phase of phases) {
    const latest = latestReview(values.id, phase, repoRoot);
    const approval = reviewApprovalReady(values.id, phase, repoRoot);
    report[phase] = { latest, approval };
    console.error(`[${phase}] ${approval.ready ? 'READY' : 'not ready'} — ${approval.reason}`);
  }

  process.stdout.write(JSON.stringify({ id: values.id, phases: report }) + '\n');
  process.exit(0);
}
