#!/usr/bin/env node
/**
 * Shared utilities for agent-toolkit scripts.
 * Import with: import { readManifest, writeManifest, ... } from '../../../packages/lib/index.mjs'
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// ── YAML minimal parser/serializer ───────────────────────────────────────────
// We keep a small bespoke implementation to avoid runtime npm dependencies.
// Supports: scalars, block sequences, block mappings, inline strings, comments.

/**
 * Parse the manifest YAML. Returns a plain JS object.
 * Only handles the subset used by manifest.yaml (scalars + simple maps/sequences).
 */
export function parseYaml(text) {
  // Strip full-line comments
  const lines = text.split('\n').map(l => l.replace(/^\s*#.*$/, ''));
  return parseBlock(lines, 0, 0).value;
}

function parseBlock(lines, startIdx, baseIndent) {
  const result = {};
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) { i++; continue; } // blank or comment-stripped

    const indent = trimmed.length - trimmed.trimStart().length;
    if (indent < baseIndent) break; // back to parent

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) { i++; continue; }

    const key = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();

    if (rest === '' || rest.startsWith('#')) {
      // block value on next line(s)
      const nextIndent = findNextIndent(lines, i + 1);
      if (nextIndent > indent) {
        const { value, endIdx } = isSequence(lines, i + 1, nextIndent)
          ? parseSequence(lines, i + 1, nextIndent)
          : parseBlock(lines, i + 1, nextIndent);
        result[key] = value;
        i = endIdx;
      } else {
        result[key] = null;
        i++;
      }
    } else if (rest.startsWith('- ')) {
      // inline sequence (rare in our format)
      result[key] = [rest.slice(2).replace(/^['"]|['"]$/g, '')];
      i++;
    } else {
      result[key] = parseScalar(rest);
      i++;
    }
  }

  return { value: result, endIdx: i };
}

function parseSequence(lines, startIdx, baseIndent) {
  const items = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) { i++; continue; }
    const indent = trimmed.length - trimmed.trimStart().length;
    if (indent < baseIndent) break;

    const item = trimmed.trimStart();
    if (item.startsWith('- ')) {
      const val = item.slice(2).trim();
      if (val === '' || val.startsWith('#')) {
        // block mapping as list item
        const nextIndent = findNextIndent(lines, i + 1);
        if (nextIndent > indent) {
          const { value, endIdx } = parseBlock(lines, i + 1, nextIndent);
          items.push(value);
          i = endIdx;
        } else {
          items.push(null);
          i++;
        }
      } else if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(val)) {
        // Mapping whose first key shares the sequence marker line. Merge any
        // indented continuation keys into the same object.
        const colonIdx = val.indexOf(':');
        const obj = {
          [val.slice(0, colonIdx).trim()]: parseScalar(val.slice(colonIdx + 1).trim()),
        };
        i++;

        const nextIndent = findNextIndent(lines, i);
        if (nextIndent > indent) {
          const { value, endIdx } = parseBlock(lines, i, nextIndent);
          Object.assign(obj, value);
          i = endIdx;
        }
        items.push(obj);
      } else {
        items.push(parseScalar(val));
        i++;
      }
    } else {
      break;
    }
  }
  return { value: items, endIdx: i };
}

function isSequence(lines, startIdx, indent) {
  for (let i = startIdx; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (!t.trim()) continue;
    const ind = t.length - t.trimStart().length;
    if (ind < indent) return false;
    return t.trimStart().startsWith('- ');
  }
  return false;
}

function findNextIndent(lines, from) {
  for (let i = from; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (!t.trim()) continue;
    return t.length - t.trimStart().length;
  }
  return -1;
}

function parseScalar(s) {
  const t = s.replace(/#.*$/, '').trim();
  if (t === '' || t === 'null' || t === '~') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === '[]') return [];
  if (t === '{}') return {};
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t.replace(/^['"]|['"]$/g, '');
}

/**
 * Minimal YAML serializer for manifest.yaml structure.
 * Produces human-readable YAML for the manifest shape.
 */
export function stringifyYaml(obj, indent = 0) {
  const pad = ' '.repeat(indent);
  const lines = [];

  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      lines.push(`${pad}${k}: null`);
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      if (Object.keys(v).length === 0) lines.push(`${pad}${k}: {}`);
      else {
        lines.push(`${pad}${k}:`);
        lines.push(stringifyYaml(v, indent + 2));
      }
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${pad}${k}: []`);
      } else {
        lines.push(`${pad}${k}:`);
        for (const item of v) {
          if (typeof item === 'object' && item !== null) {
            const entries = Object.entries(item);
            const first = entries[0];
            lines.push(`${pad}  - ${first[0]}: ${serializeScalar(first[1])}`);
            for (const [ik, iv] of entries.slice(1)) {
              lines.push(`${pad}    ${ik}: ${serializeScalar(iv)}`);
            }
          } else {
            lines.push(`${pad}  - ${serializeScalar(item)}`);
          }
        }
      }
    } else {
      lines.push(`${pad}${k}: ${serializeScalar(v)}`);
    }
  }
  return lines.join('\n');
}

function serializeScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (v === '') return '""';
  if (typeof v === 'string' && (v.includes(':') || v.includes('#') || v.includes('"'))) {
    return `"${v.replace(/"/g, '\\"')}"`;
  }
  return String(v);
}

// ── Manifest I/O ─────────────────────────────────────────────────────────────

/**
 * Find the active changes directory relative to cwd or a provided root.
 */
export function changesDir(repoRoot = process.cwd()) {
  return path.join(repoRoot, '.changes');
}

export function activeDir(repoRoot = process.cwd()) {
  return path.join(changesDir(repoRoot), 'active');
}

export function archiveDir(repoRoot = process.cwd()) {
  return path.join(changesDir(repoRoot), 'archive');
}

export function changeDir(id, repoRoot = process.cwd()) {
  return path.join(activeDir(repoRoot), id);
}

export function manifestPath(id, repoRoot = process.cwd()) {
  return path.join(changeDir(id, repoRoot), 'manifest.yaml');
}

/**
 * Read and parse a manifest. Throws if not found.
 */
export function readManifest(id, repoRoot = process.cwd()) {
  const mp = manifestPath(id, repoRoot);
  if (!fs.existsSync(mp)) {
    throw new Error(`Manifest not found: ${mp}`);
  }
  return parseYaml(fs.readFileSync(mp, 'utf8'));
}

/**
 * Write a manifest object back to disk.
 */
export function writeManifest(id, manifest, repoRoot = process.cwd()) {
  const mp = manifestPath(id, repoRoot);
  fs.mkdirSync(path.dirname(mp), { recursive: true });
  const temporary = `${mp}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, stringifyYaml(manifest) + '\n', 'utf8');
  fs.renameSync(temporary, mp);
}

/**
 * List all active change IDs.
 */
export function listActiveChanges(repoRoot = process.cwd()) {
  const dir = activeDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => {
    return fs.statSync(path.join(dir, name)).isDirectory();
  });
}

// ── Independent review log ──────────────────────────────────────────────────
// Each change stores an append-only list of structured review entries. Version 2
// forms bounded cycles that the approval validates independently of the recording CLI.

export const REVIEW_PHASES = ['architect', 'specify', 'implement', 'refactor'];
export const REVIEW_ROLES = ['auditor', 'verifier'];
export const REVIEW_VERDICTS = ['approved', 'changes-requested'];
export const REVIEW_SEVERITIES = ['blocker', 'major'];
export const REVIEW_CATEGORIES = ['correctness', 'security', 'simplicity', 'maintainability', 'idioms'];
export const REVIEW_RESOLUTION_STATUSES = ['resolved', 'unresolved'];

const REVIEW_PREFIXES = {
  architect: 'AV',
  specify: 'SV',
  implement: 'RV',
  refactor: 'RV',
};

export function reviewsPath(id, repoRoot = process.cwd()) {
  return path.join(changeDir(id, repoRoot), 'reviews.json');
}

/**
 * Read the review entries for a change. Returns [] when none exist.
 */
export function readReviews(id, repoRoot = process.cwd()) {
  const rp = reviewsPath(id, repoRoot);
  if (!fs.existsSync(rp)) return [];
  const parsed = JSON.parse(fs.readFileSync(rp, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`Corrupt reviews file (expected an array): ${rp}`);
  }
  return parsed;
}

/**
 * Append a review entry and persist. Returns the written entry.
 */
export function appendReview(id, entry, repoRoot = process.cwd()) {
  const reviews = readReviews(id, repoRoot);
  reviews.push(entry);
  const rp = reviewsPath(id, repoRoot);
  fs.mkdirSync(path.dirname(rp), { recursive: true });
  const temporary = `${rp}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(reviews, null, 2) + '\n', 'utf8');
  fs.renameSync(temporary, rp);
  return entry;
}

/**
 * The most recent review entry for a phase, or null.
 */
export function latestReview(id, phase, repoRoot = process.cwd()) {
  const reviews = readReviews(id, repoRoot).filter(r => r.phase === phase);
  return reviews.length ? reviews[reviews.length - 1] : null;
}

function validateStructuredFinding(finding, phase, regression = false) {
  const errors = [];
  const prefix = REVIEW_PREFIXES[phase];
  if (!finding || typeof finding !== 'object' || Array.isArray(finding)) {
    return ['finding must be a JSON object'];
  }
  if (typeof finding.id !== 'string' || !new RegExp(`^${prefix}-[0-9]{3}$`).test(finding.id)) {
    errors.push(`finding id must match ${prefix}-NNN for phase '${phase}'`);
  }
  if (!REVIEW_SEVERITIES.includes(finding.severity)) {
    errors.push(`finding '${finding.id || '?'}' severity must be one of: ${REVIEW_SEVERITIES.join(', ')}`);
  }
  if (regression && finding.severity !== 'blocker') {
    errors.push(`verifier regression '${finding.id || '?'}' must have blocker severity; new major or low findings are not allowed`);
  }
  if (!REVIEW_CATEGORIES.includes(finding.category)) {
    errors.push(`finding '${finding.id || '?'}' category must be one of: ${REVIEW_CATEGORIES.join(', ')}`);
  }
  for (const field of ['location', 'impact', 'alternative']) {
    if (typeof finding[field] !== 'string' || !finding[field].trim()) {
      errors.push(`finding '${finding.id || '?'}' requires a non-empty ${field}`);
    }
  }
  return errors;
}

/**
 * Validate and summarize one structured v2 cycle. Incomplete cycles are valid
 * but not ready; malformed or over-budget cycles are invalid and never ready.
 */
export function structuredReviewCycleState(entries, phase, cycle) {
  const staged = entries.filter(entry => entry.version === 2 && entry.phase === phase && entry.cycle === cycle);
  const errors = [];
  if (staged.length === 0) {
    return { valid: true, ready: false, reason: `no ${phase} review recorded for cycle '${cycle}'`, errors };
  }

  const auditors = staged.filter(entry => entry.role === 'auditor');
  const verifiers = staged.filter(entry => entry.role === 'verifier');
  if (auditors.length !== 1) errors.push(`cycle '${cycle}' must contain exactly one discovery auditor`);
  if (staged[0]?.role !== 'auditor') errors.push(`cycle '${cycle}' must begin with its discovery auditor`);
  if (verifiers.length > 2) errors.push(`cycle '${cycle}' exceeds the limit of one initial verification plus one targeted re-verification`);

  for (const entry of staged) {
    if (!REVIEW_ROLES.includes(entry.role)) errors.push(`cycle '${cycle}' contains invalid role '${entry.role}'`);
    if (!REVIEW_VERDICTS.includes(entry.verdict)) errors.push(`cycle '${cycle}' contains invalid verdict '${entry.verdict}'`);
    if (typeof entry.reviewer !== 'string' || !entry.reviewer.trim()) errors.push(`cycle '${cycle}' contains an empty reviewer`);
  }

  const auditor = auditors[0];
  const originalIds = new Set();
  if (auditor) {
    if (!Array.isArray(auditor.findings)) errors.push(`cycle '${cycle}' auditor findings must be an array`);
    for (const finding of Array.isArray(auditor.findings) ? auditor.findings : []) {
      errors.push(...validateStructuredFinding(finding, phase));
      if (originalIds.has(finding?.id)) errors.push(`cycle '${cycle}' repeats original finding id '${finding?.id}'`);
      originalIds.add(finding?.id);
    }
    if (auditor.findings?.length > 0 && auditor.verdict !== 'changes-requested') {
      errors.push(`cycle '${cycle}' auditor findings require a changes-requested verdict`);
    }
    if (auditor.findings?.length === 0 && auditor.verdict === 'changes-requested') {
      errors.push(`cycle '${cycle}' changes-requested auditor requires at least one finding`);
    }
  }

  const originalStatuses = new Map([...originalIds].map(id => [id, 'unresolved']));
  const regressionStatuses = new Map();
  const allIds = new Set(originalIds);

  verifiers.forEach((verifier, index) => {
    const expectedVerification = index === 0 ? 'initial' : 'targeted-reverification';
    if (verifier.verification !== expectedVerification) {
      errors.push(`cycle '${cycle}' verifier ${index + 1} must be marked '${expectedVerification}'`);
    }
    if (auditor && verifier.reviewer === auditor.reviewer) {
      errors.push(`cycle '${cycle}' verifier reviewer must differ from auditor '${auditor.reviewer}'`);
    }
    if (verifiers.slice(0, index).some(prior => prior.reviewer === verifier.reviewer)) {
      errors.push(`cycle '${cycle}' targeted re-verification requires a fresh verifier`);
    }
    if (Array.isArray(verifier.findings) && verifier.findings.length > 0) {
      errors.push(`cycle '${cycle}' verifier cannot add findings; only blocker regressions are allowed`);
    }
    if (!Array.isArray(verifier.resolutions)) errors.push(`cycle '${cycle}' verifier resolutions must be an array`);
    const seenResolutions = new Set();
    for (const resolution of Array.isArray(verifier.resolutions) ? verifier.resolutions : []) {
      if (!resolution || typeof resolution !== 'object' || !originalIds.has(resolution.id)) {
        errors.push(`verifier resolution '${resolution?.id || '?'}' is not an original auditor finding id`);
        continue;
      }
      if (seenResolutions.has(resolution.id)) errors.push(`verifier repeats resolution '${resolution.id}' in one entry`);
      seenResolutions.add(resolution.id);
      if (!REVIEW_RESOLUTION_STATUSES.includes(resolution.status)) {
        errors.push(`resolution '${resolution.id}' status must be one of: ${REVIEW_RESOLUTION_STATUSES.join(', ')}`);
      } else {
        originalStatuses.set(resolution.id, resolution.status);
      }
    }

    if (!Array.isArray(verifier.regressionResolutions)) errors.push(`cycle '${cycle}' verifier regressionResolutions must be an array`);
    const seenRegressionResolutions = new Set();
    for (const resolution of Array.isArray(verifier.regressionResolutions) ? verifier.regressionResolutions : []) {
      if (!resolution || typeof resolution !== 'object' || !regressionStatuses.has(resolution.id)) {
        errors.push(`regression resolution '${resolution?.id || '?'}' does not reference a blocker regression from an earlier verification`);
        continue;
      }
      if (seenRegressionResolutions.has(resolution.id)) errors.push(`verifier repeats regression resolution '${resolution.id}' in one entry`);
      seenRegressionResolutions.add(resolution.id);
      if (!REVIEW_RESOLUTION_STATUSES.includes(resolution.status)) {
        errors.push(`regression resolution '${resolution.id}' status must be one of: ${REVIEW_RESOLUTION_STATUSES.join(', ')}`);
      } else {
        regressionStatuses.set(resolution.id, resolution.status);
      }
    }

    if (!Array.isArray(verifier.regressions)) errors.push(`cycle '${cycle}' verifier regressions must be an array`);
    for (const regression of Array.isArray(verifier.regressions) ? verifier.regressions : []) {
      errors.push(...validateStructuredFinding(regression, phase, true));
      if (allIds.has(regression?.id)) errors.push(`cycle '${cycle}' reuses finding id '${regression?.id}'`);
      allIds.add(regression?.id);
      regressionStatuses.set(regression?.id, 'unresolved');
    }
  });

  if (errors.length > 0) {
    return { valid: false, ready: false, reason: errors[0], errors };
  }
  if (verifiers.length === 0) {
    return { valid: true, ready: false, reason: `cycle '${cycle}' has no verifier review`, errors };
  }
  const latest = verifiers[verifiers.length - 1];
  if (latest.verdict !== 'approved') {
    return { valid: true, ready: false, reason: `latest ${phase} verifier verdict for cycle '${cycle}' is not approved`, errors };
  }
  const unresolvedOriginal = [...originalStatuses].find(([, status]) => status !== 'resolved');
  if (unresolvedOriginal) {
    return { valid: true, ready: false, reason: `original finding '${unresolvedOriginal[0]}' is unresolved`, errors };
  }
  const unresolvedRegression = [...regressionStatuses].find(([, status]) => status !== 'resolved');
  if (unresolvedRegression) {
    return { valid: true, ready: false, reason: `blocker regression '${unresolvedRegression[0]}' is unresolved`, errors };
  }
  return { valid: true, ready: true, reason: `cycle '${cycle}' approved by verifier '${latest.reviewer}'`, errors };
}

/**
 * Whether a phase's review approval is satisfied.
 * Version 2 validates the current bounded cycle and all of its structured
 * findings, resolutions, regressions, reviewer separation, and pass budget.
 * Earlier cycles remain immutable review history after a kickback starts a new
 * epoch.
 * Returns { ready, reason }.
 */
export function reviewApprovalReady(id, phase, repoRoot = process.cwd()) {
  const reviews = readReviews(id, repoRoot);
  const unsupported = reviews.find(entry => entry.version !== 2);
  if (unsupported) {
    return { ready: false, reason: `reviews.json contains unsupported review version '${unsupported.version ?? 'missing'}'; only version 2 is supported` };
  }
  const phased = reviews.filter(entry => entry.phase === phase);
  if (phased.length === 0) return { ready: false, reason: `no ${phase} review recorded` };
  const manifest = readManifest(id, repoRoot);
  const expectedCycle = expectedReviewCycle(manifest, phase);
  const currentEpoch = reviewEpoch(manifest, phase);
  for (const entry of phased) {
    const match = new RegExp(`^${phase}-(\\d+)$`).exec(entry.cycle || '');
    if (!match || Number(match[1]) > currentEpoch) {
      return { ready: false, reason: `${phase} review cycles must be current or historical epochs through '${expectedCycle}'` };
    }
  }
  const current = phased.filter(entry => entry.cycle === expectedCycle);
  if (current.length === 0) {
    return { ready: false, reason: `no ${phase} review recorded for current cycle '${expectedCycle}'` };
  }
  const state = structuredReviewCycleState(current, phase, expectedCycle);
  return { ready: state.ready, reason: state.reason };
}

export function expectedReviewCycle(manifest, phase) {
  return `${phase}-${reviewEpoch(manifest, phase)}`;
}

function reviewEpoch(manifest, phase) {
  const epoch = manifest.review_epochs?.[phase];
  return epoch === undefined ? 1 : epoch;
}

// ── Git utilities ─────────────────────────────────────────────────────────────

/**
 * Get the current HEAD SHA. Returns null if not in a git repo.
 */
export function getHeadSha(repoRoot = process.cwd()) {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString().trim();
  } catch {
    return null;
  }
}

/**
 * Get files changed since a given SHA in a given directory.
 * Returns an array of relative file paths.
 */
export function getChangedFilesSince(sha, dirPath, repoRoot = process.cwd()) {
  if (!sha) return [];
  try {
    const result = execSync(
      `git diff --name-only "${sha}"..HEAD -- "${dirPath}"`,
      { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();
    return result ? result.split('\n') : [];
  } catch {
    return [];
  }
}

// ── ID generation ─────────────────────────────────────────────────────────────

/**
 * Generate a change ID from a title.
 * Format: YYYY-MM-DD-<kebab-slug>
 */
export function generateChangeId(title, repoRoot = process.cwd()) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/-$/, '');

  let id = `${date}-${slug}`;
  const dir = activeDir(repoRoot);
  const archive = archiveDir(repoRoot);
  const exists = candidate => fs.existsSync(path.join(dir, candidate)) || fs.existsSync(path.join(archive, `${candidate}.zip`));

  // Collision avoidance
  if (exists(id)) {
    let n = 2;
    while (exists(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }

  return id;
}

// ── Phase ordering ─────────────────────────────────────────────────────────────

export const PHASES = ['refactor', 'architect', 'specify', 'plan', 'implement', 'decomposed', 'archive-ready'];
export const APPROVALS = ['refactor', 'architect', 'specify', 'plan', 'implement', 'docs'];
export const KICKBACK_IMPACTS = ['specify', 'plan', 'implementation'];

const LIFECYCLES = {
  feature: { approvals: ['architect', 'specify', 'plan', 'implement', 'docs'], phases: ['architect', 'specify', 'plan', 'implement', 'archive-ready'] },
  bug: { approvals: ['implement', 'docs'], phases: ['implement', 'archive-ready'] },
  small: { approvals: ['implement', 'docs'], phases: ['implement', 'archive-ready'] },
  epic: { approvals: ['architect', 'specify', 'docs'], phases: ['architect', 'specify', 'decomposed', 'archive-ready'] },
  refactor: { approvals: ['refactor', 'implement', 'docs'], phases: ['refactor', 'implement', 'archive-ready'] },
};

export function allowedApprovalsFor(manifest) {
  if (manifest.class === 'refactor' && manifest.refactor_mode === 'audit-only') return ['refactor'];
  return LIFECYCLES[manifest.class]?.approvals || [];
}

export function phaseForApproval(manifest, approval) {
  if (approval === 'docs') return manifest.class === 'epic' ? 'decomposed' : 'implement';
  return approval;
}

export function nextPhaseForApproval(manifest, approval) {
  if (approval === 'docs') return 'archive-ready';
  if (manifest.class === 'refactor' && approval === 'refactor') {
    return manifest.refactor_mode === 'audit-only' ? 'archive-ready' : 'implement';
  }
  if (approval === 'architect') return 'specify';
  if (approval === 'specify') return manifest.class === 'epic' ? 'specify' : 'plan';
  if (approval === 'plan') return 'implement';
  return manifest.phase;
}

export function validateManifestState(manifest) {
  const errors = [];
  const lifecycle = LIFECYCLES[manifest.class];
  if (!lifecycle) return [`invalid change class '${manifest.class}'`];
  if (!lifecycle.phases.includes(manifest.phase)) errors.push(`phase '${manifest.phase}' is not valid for '${manifest.class}'`);
  const allowed = new Set(allowedApprovalsFor(manifest));
  const approvals = manifest.approvals || {};
  for (const [approval, status] of Object.entries(approvals)) {
    if (!allowed.has(approval)) errors.push(`approval '${approval}' does not apply to '${manifest.class}'`);
    if (!['pending', 'approved'].includes(status)) errors.push(`approval '${approval}' has invalid status '${status}'`);
  }
  for (const approval of allowed) if (!approvals[approval]) errors.push(`missing '${approval}' approval`);
  if (manifest.review_epochs !== undefined) {
    if (!manifest.review_epochs || typeof manifest.review_epochs !== 'object' || Array.isArray(manifest.review_epochs)) {
      errors.push('review_epochs must be a mapping of review phases to positive integers');
    } else {
      for (const [phase, epoch] of Object.entries(manifest.review_epochs)) {
        if (!REVIEW_PHASES.includes(phase)) errors.push(`review_epochs contains invalid review phase '${phase}'`);
        if (!Number.isInteger(epoch) || epoch < 1) errors.push(`review_epochs.${phase} must be a positive integer`);
      }
    }
  }
  if (manifest.class === 'epic' && !Array.isArray(manifest.children)) errors.push('epic children must be an array');
  if (manifest.class !== 'epic' && Array.isArray(manifest.children)) errors.push('only epics may have children');
  if (manifest.phase === 'archive-ready' && !isArchiveReady(manifest)) errors.push('archive-ready change does not satisfy archive preconditions');
  return errors;
}

export function isArchiveReady(manifest, repoRoot = process.cwd()) {
  if (manifest.archive?.outcome === 'cancelled') return typeof manifest.archive.reason === 'string' && manifest.archive.reason.trim().length > 0;
  if (manifest.class === 'refactor' && manifest.refactor_mode === 'audit-only') return manifest.approvals?.refactor === 'approved';
  if (manifest.class === 'epic') {
    const status = epicStatus(manifest, repoRoot);
    return manifest.approvals?.architect === 'approved' && manifest.approvals?.specify === 'approved' && manifest.approvals?.docs === 'approved' && status.total > 0 && status.ready === status.total;
  }
  return manifest.approvals?.implement === 'approved' && manifest.approvals?.docs === 'approved';
}

export function phaseIndex(phase) {
  return PHASES.indexOf(phase);
}

export function artifactPath(manifest, artifact, repoRoot = process.cwd()) {
  const file = manifest.artifacts?.[artifact] || `${artifact}.md`;
  return path.join(changeDir(manifest.id, repoRoot), file);
}

export function kickbackImpact(impact) {
  if (!KICKBACK_IMPACTS.includes(impact)) {
    throw new Error(`impact must be one of: ${KICKBACK_IMPACTS.join(', ')}`);
  }
  if (impact === 'specify') {
    return { impact, invalidatedApprovals: ['specify', 'plan', 'implement', 'docs'], restartPhase: 'specify', reviewPhases: ['specify', 'implement'] };
  }
  if (impact === 'plan') {
    return { impact, invalidatedApprovals: ['plan', 'implement', 'docs'], restartPhase: 'plan', reviewPhases: ['implement'] };
  }
  return { impact, invalidatedApprovals: ['implement', 'docs'], restartPhase: 'implement', reviewPhases: ['implement'] };
}

function readArtifact(manifest, artifact, repoRoot, errors) {
  const file = artifactPath(manifest, artifact, repoRoot);
  if (!fs.existsSync(file)) {
    errors.push(`missing ${artifact} artifact: ${file}`);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function unresolvedBlockers(content) {
  return /\*\*Classification:\*\* blocker[\s\S]{0,240}\*\*Disposition:\*\* unresolved/i.test(content);
}

function hasFencedSourceCode(content) {
  return /^```(?:bash|c|cpp|csharp|css|go|html|java|javascript|js|jsx|kotlin|python|py|ruby|rs|rust|scala|sh|shell|sql|swift|toml|ts|tsx|typescript|yaml|yml)\b/im.test(content);
}

function hasReviewCycleReference(content) {
  return /^##\s+(?:bounded\s+|adversarial\s+)?review[- ]cycle(?:\s+reference)?\s*$/im.test(content);
}

function reviewCycleReference(content) {
  return content.match(/^(?:\*\*Cycle:\*\*|Cycle:)\s*`?([A-Za-z0-9._-]+)`?\s*$/im)?.[1] || null;
}

function reviewFindingIds(content, prefix) {
  return new Set(content.split('\n')
    .map(line => line.match(new RegExp(`^\\|\\s*(${prefix}-[0-9]{3})\\s*\\|`, 'i'))?.[1]?.toUpperCase())
    .filter(Boolean));
}

function validateArtifactReviewIds(manifest, phase, content, repoRoot, errors) {
  const entries = readReviews(manifest.id, repoRoot)
    .filter(entry => entry.version === 2 && entry.phase === phase && entry.cycle === expectedReviewCycle(manifest, phase));
  if (entries.length === 0) return;
  const prefix = REVIEW_PREFIXES[phase];
  const artifactIds = reviewFindingIds(content, prefix);
  const logIds = new Set(entries
    .flatMap(entry => [...(entry.findings || []), ...(entry.regressions || [])])
    .map(finding => finding.id));
  const missing = [...logIds].filter(id => !artifactIds.has(id));
  const extra = [...artifactIds].filter(id => !logIds.has(id));
  if (missing.length > 0 || extra.length > 0) {
    errors.push(`${phase} artifact review IDs must match reviews.json cycle '${expectedReviewCycle(manifest, phase)}' (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`);
  }
}

/**
 * Check only structural evidence required before an approval is granted. Semantic
 * design review remains the responsibility of the user and review subagents.
 */
export function validateApprovalArtifacts(manifest, approval, repoRoot = process.cwd()) {
  const errors = [];
  if (!['architect', 'specify', 'plan'].includes(approval)) return { valid: true, errors };

  if (approval === 'architect') {
    const architecture = readArtifact(manifest, 'architecture', repoRoot, errors);
    const sections = ['## Summary', '## Architecture Confirmation Ledger', '## Architectural Decisions', '## Seams', '## Validity Check Results'];
    for (const section of sections) {
      if (architecture && !architecture.includes(section)) errors.push(`architecture.md missing required section: ${section}`);
    }
    if (architecture && ['feature', 'epic'].includes(manifest.class) && !hasReviewCycleReference(architecture)) {
      errors.push('architecture.md missing required section: ## Review Cycle Reference');
    }
    const expectedCycle = expectedReviewCycle(manifest, 'architect');
    if (architecture && ['feature', 'epic'].includes(manifest.class) && reviewCycleReference(architecture) !== expectedCycle) {
      errors.push(`architecture.md review cycle reference must be ${expectedCycle}`);
    }
    const ledger = architecture.match(/## Architecture Confirmation Ledger\s*\n([\s\S]*?)(?:\n## |$)/i)?.[1] || '';
    const rows = ledger.split('\n').filter(line => /^\|\s*A-\d+/i.test(line));
    for (const row of rows) {
      const cells = row.split('|').map(cell => cell.trim());
      if (cells[6]?.toLowerCase() !== 'confirmed') errors.push(`architecture confirmation ledger row is not explicitly confirmed: ${cells[1] || row}`);
      if (!cells[5]) errors.push(`architecture confirmation ledger row has no explicit user response: ${cells[1] || row}`);
    }
    if (architecture && !/\*\*Status:\*\* passed(?:-after-resolution)?\b/i.test(architecture)) {
      errors.push('architecture.md validity status must be passed or passed-after-resolution');
    }
    if (architecture && unresolvedBlockers(architecture)) errors.push('architecture.md has an unresolved blocker');
    if (architecture && ['feature', 'epic'].includes(manifest.class)) {
      validateArtifactReviewIds(manifest, 'architect', architecture, repoRoot, errors);
    }
  }

  if (approval === 'specify') {
    const decisions = readArtifact(manifest, 'decisions', repoRoot, errors);
    const sections = ['## Confirmation Ledger', '## Interface Changes', '## Decision Log', '## Dry-Run Findings'];
    for (const section of sections) {
      if (decisions && !decisions.includes(section)) errors.push(`decisions.md missing required section: ${section}`);
    }
    if (decisions && ['feature', 'epic'].includes(manifest.class) && !hasReviewCycleReference(decisions)) {
      errors.push('decisions.md missing required section: ## Review Cycle Reference');
    }
    const expectedCycle = expectedReviewCycle(manifest, 'specify');
    if (decisions && ['feature', 'epic'].includes(manifest.class) && reviewCycleReference(decisions) !== expectedCycle) {
      errors.push(`decisions.md review cycle reference must be ${expectedCycle}`);
    }
    const ledger = decisions.match(/## Confirmation Ledger\s*\n([\s\S]*?)(?:\n## |$)/i)?.[1] || '';
    const rows = ledger.split('\n').filter(line => /^\|\s*D-\d+/i.test(line));
    for (const row of rows) {
      const cells = row.split('|').map(cell => cell.trim());
      if (cells[6]?.toLowerCase() !== 'confirmed') errors.push(`confirmation ledger row is not explicitly confirmed: ${cells[1] || row}`);
      if (!cells[5]) errors.push(`confirmation ledger row has no explicit user response: ${cells[1] || row}`);
    }
    if (decisions && unresolvedBlockers(decisions)) errors.push('decisions.md has an unresolved dry-run blocker');
    if (decisions && ['feature', 'epic'].includes(manifest.class)) {
      validateArtifactReviewIds(manifest, 'specify', decisions, repoRoot, errors);
    }
  }

  if (approval === 'plan') {
    const plan = readArtifact(manifest, 'plan', repoRoot, errors);
    if (plan && !plan.includes('## Traceability check')) errors.push('plan.md missing required section: ## Traceability check');
    if (plan && !/^\|\s*AC ID\s*\|\s*Task\(s\)\s*\|\s*Firm-seam test task\s*\|/mi.test(plan)) {
      errors.push('plan.md missing traceability table');
    }
    const firmSeams = [...plan.matchAll(/\[firmness:\s*firm\]/gi)].length;
    const firmTasks = [...plan.matchAll(/\[seam:[^\]]+firmness:\s*firm\]/gi)].length;
    if (firmSeams > firmTasks) errors.push('plan.md has firm seams without matching firm-seam test tasks');
    if (plan && hasFencedSourceCode(plan)) {
      errors.push('plan.md contains a fenced source-code block; replace it with a concise functional specification');
    }
    if (plan && unresolvedBlockers(plan)) errors.push('plan.md has an unresolved blocker');
  }

  return { valid: errors.length === 0, errors };
}

export function nextSkill(manifest) {
  const phase = manifest.phase;
  const approvals = manifest.approvals || {};

  if (phase === 'archive-ready') return 'change-archive';

  // Epics: architect → specify → decompose → done (no plan/implement)
  if (manifest.class === 'epic') {
    return epicNextAction(manifest);
  }

  // Refactor changes audit, obtain selection approval, execute the selected
  // cleanup with independent review, and reconcile docs without entering the
  // spec spine.
  if (manifest.class === 'refactor') {
    if (phase === 'refactor' && approvals.refactor !== 'approved') return 'refactor (audit and selection)';
    if (phase === 'implement' && approvals.implement !== 'approved') return 'refactor (execute selected batches)';
    if (phase === 'implement' && approvals.implement === 'approved' && approvals.docs !== 'approved') return 'refactor (docs reconciliation)';
    return null;
  }

  if (['bug', 'small'].includes(manifest.class)) {
    if (phase === 'implement' && approvals.implement !== 'approved') return 'triage (implement and self-check)';
    if (phase === 'implement') return 'triage (docs reconciliation)';
    return null;
  }
  if (phase === 'architect' && approvals.architect !== 'approved') return 'architect';
  if (phase === 'architect' && approvals.architect === 'approved') return 'specify';
  if (phase === 'specify'   && approvals.specify !== 'approved')  return 'specify';
  if (phase === 'specify'   && approvals.specify === 'approved')  return 'plan';
  if (phase === 'plan'      && approvals.plan !== 'approved')     return 'plan';
  if (phase === 'plan'      && approvals.plan === 'approved')     return 'implement';
  if (phase === 'implement' && approvals.implement !== 'approved') return 'implement';
  if (phase === 'implement' && approvals.implement === 'approved' && approvals.docs !== 'approved') return 'implement (docs reconciliation)';
  return null;
}

// ── Epic helpers ──────────────────────────────────────────────────────────────

/**
 * Epic phase progression:
 *   architect → specify → decomposed (epic-split) → archive-ready
 *
 * Epics never run plan or implement. They plan; their children implement.
 */
export function epicNextAction(manifest) {
  const approvals  = manifest.approvals  || {};
  const phase  = manifest.phase  || 'architect';
  const children = manifest.children || [];

  if (phase === 'archive-ready') return 'change-archive';

  // architect approval
  if (approvals.architect !== 'approved') return 'architect (identify children + overall design)';

  // specify approval — cross-cutting contracts
  if (phase === 'architect' || phase === 'specify') {
    if (approvals.specify !== 'approved') return 'specify (cross-cutting contracts)';
  }

  // decompose — create child manifests from the approved arch+decisions
  if (approvals.specify === 'approved' && children.length === 0) {
    return 'epic-split (decompose into child changes)';
  }

  // Children exist — track their progress and complete the parent once delivered.
  if (children.length > 0 && approvals.specify === 'approved') {
    const status = epicStatus(manifest);
    if (status.ready === children.length) return 'implement (epic docs reconciliation)';
    return null; // children drive completion; use change-status to track
  }

  return null;
}

/**
 * Compute epic completion status from child manifests.
 * Returns { total, ready, archived, inProgress, pending, missing, byPhase }
 */
export function epicStatus(epicManifest, repoRoot = process.cwd()) {
  const children = epicManifest.children || [];
  const result = {
    total: children.length,
    ready: 0,
    archived: 0,
    inProgress: 0,
    pending: 0,
    missing: 0,
    byPhase: {},
  };

  for (const childId of children) {
    let child;
    try {
      child = readManifest(childId, repoRoot);
    } catch {
      if (fs.existsSync(path.join(archiveDir(repoRoot), `${childId}.zip`))) {
        result.archived++;
        result.byPhase.archived = (result.byPhase.archived || 0) + 1;
      } else {
        result.missing++;
        result.byPhase.missing = (result.byPhase.missing || 0) + 1;
      }
      continue;
    }
    const phase = child.phase || 'architect';
    result.byPhase[phase] = (result.byPhase[phase] || 0) + 1;
    if (phase === 'archive-ready') result.ready++;
    else if (phase === 'architect') result.pending++;
    else result.inProgress++;
  }

  return result;
}

/** Mark a decomposed epic archive-ready after every child is archive-ready. */
export function completeEpicIfDelivered(epicId, repoRoot = process.cwd()) {
  const epic = readManifest(epicId, repoRoot);
  if (epic.class !== 'epic' || epic.phase !== 'decomposed') return epic;
  const status = epicStatus(epic, repoRoot);
  return epic;
}

/**
 * Add a child change ID to an epic manifest's children list.
 * Updates the epic manifest on disk.
 */
export function addChildToEpic(epicId, childId, repoRoot = process.cwd()) {
  const epic = readManifest(epicId, repoRoot);
  if (epic.class !== 'epic') {
    throw new Error(`Change '${epicId}' is not an epic (class: ${epic.class})`);
  }
  if (epic.phase !== 'specify' || epic.approvals?.architect !== 'approved' || epic.approvals?.specify !== 'approved') {
    throw new Error(`Epic '${epicId}' must have approved architect and specify approvals before children can be added`);
  }
  epic.children = epic.children || [];
  if (!epic.children.includes(childId)) {
    epic.children.push(childId);
    writeManifest(epicId, epic, repoRoot);
  }
  return epic;
}
