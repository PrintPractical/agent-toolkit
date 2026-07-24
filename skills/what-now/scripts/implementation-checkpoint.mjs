#!/usr/bin/env node
/**
 * Snapshot-bound implementation checkpoints, one implementation unit at a time.
 *
 * State is stored at .changes/active/<id>/implementation-state.json.
 * Machine-readable results are written to stdout; diagnostics go to stderr.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { readManifest, writeManifest } from './lib/index.mjs';

const PHASES = ['building', 'green', 'reviewed', 'refactoring', 'tested', 'verified'];
const UNIT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SNAPSHOT_PATTERN = /^[a-f0-9]{64}$/;
const REVIEW_CATEGORIES = ['blocking', 'kickback', 'cleanup'];
const REVIEW_STATUSES = ['unresolved', 'resolved'];
const REVIEW_SEVERITIES = ['critical', 'high', 'medium', 'low'];
const temporaryFiles = new Set();

function cleanupTemporaryFiles() {
  for (const file of temporaryFiles) {
    try { fs.unlinkSync(file); } catch {}
  }
}

process.on('exit', cleanupTemporaryFiles);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const HELP = `Usage:
  implementation-checkpoint.mjs --id <change-id> --init --units <json-or-file>
  implementation-checkpoint.mjs --id <change-id> --reset --units <json-file>
  implementation-checkpoint.mjs --id <change-id> --unit <unit-id> --baseline-test --command <command>
  implementation-checkpoint.mjs --id <change-id> --unit <unit-id> --initial-review --review <json-file>
  implementation-checkpoint.mjs --id <change-id> --unit <unit-id> --start-refactor
  implementation-checkpoint.mjs --id <change-id> --unit <unit-id> --final-test --command <command> [--no-change-rationale <text>]
  implementation-checkpoint.mjs --id <change-id> --unit <unit-id> --final-review --review <json-file>
  implementation-checkpoint.mjs --id <change-id> [--unit <unit-id>] --status
  implementation-checkpoint.mjs --id <change-id> --check-all

Unit declaration JSON:
  [{"id":"unit-id","files":["src/file"],"lockedTestFiles":["test/file"],
    "baselineCommand":"npm test -- --runInBand","finalCommand":"npm test"}]

Review JSON:
  {"version":1,"unitId":"unit-id","stage":"initial|final","snapshot":"<sha256>",
    "reviewerRole":"read-only-initial-reviewer|fresh-final-reviewer","reviewerId":"stable-session-id",
   "checks":["correctness", "structure", "tests"],
   "verdict":"ready-for-refactor|behavior-preserved","findings":[
      {"id":"finding-id","category":"blocking|kickback|cleanup",
       "severity":"critical|high|medium|low","status":"unresolved|resolved",
       "file":"src/file","line":1,"summary":"...","disposition":"..."}
    ],"noFindingsRationale":"required when findings is empty"}

Each transition invocation advances exactly one phase. Baseline and final test
commands run from --root (the current directory by default).`;

function fail(message) {
  throw new Error(message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRelativePath(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${label} must be a non-empty relative path`);
  }
  const normalized = path.posix.normalize(value.trim().replaceAll('\\', '/'));
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../') || path.posix.isAbsolute(normalized)) {
    fail(`${label} must stay within the repository: ${value}`);
  }
  return normalized;
}

function normalizePathList(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} array of relative paths`);
  }
  const result = [...new Set(value.map((item, index) => normalizeRelativePath(item, `${label}[${index}]`)))].sort();
  if (result.length !== value.length) fail(`${label} must not contain duplicate paths`);
  return result;
}

function loadJsonArgument(value, label, repoRoot) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} is required`);
  const trimmed = value.trim();
  try {
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
    return JSON.parse(fs.readFileSync(path.resolve(repoRoot, value), 'utf8'));
  } catch (error) {
    fail(`Could not read ${label}: ${error.message}`);
  }
}

function statePath(changeId, repoRoot) {
  return path.join(repoRoot, '.changes', 'active', changeId, 'implementation-state.json');
}

function unitsPath(changeId, repoRoot) {
  return path.join(repoRoot, '.changes', 'active', changeId, 'implementation-units.json');
}

function digestBytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

function selectedOpportunityBlocks(text, selectedIds) {
  const matches = [...text.matchAll(/^###\s+(RF-[A-Za-z0-9._-]+)\b[^\n]*\n/gm)];
  const blocks = new Map();
  for (const [index, match] of matches.entries()) {
    if (blocks.has(match[1])) fail(`Source artifact contains duplicate opportunity '${match[1]}'`);
    const nextSection = text.slice(match.index + match[0].length).search(/^#{2,3}\s+/m);
    const end = nextSection === -1 ? text.length : match.index + match[0].length + nextSection;
    blocks.set(match[1], text.slice(match.index, end).trim());
  }
  return selectedIds.map(id => {
    if (!blocks.has(id)) fail(`Selected opportunity '${id}' has no ranked opportunity record`);
    return blocks.get(id);
  });
}

function opportunityContract(block) {
  return block.split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^\*\*(?:Status|Disposition note):\*\*/.test(line))
    .join('\n');
}

function contractDigest(text, changeClass, selectedIds = []) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => changeClass === 'refactor'
    ? /^\*\*(?:Selected IDs|Selection gate):\*\*/.test(line) || /^\|\s*B-[A-Za-z0-9._-]+\s*\|/.test(line) || /^###\s+B-[A-Za-z0-9._-]+\b/.test(line)
    : /^>\s*\*\*(?:Checkpoint unit|Editable files|Locked test files|Baseline command|Final command):\*\*/.test(line));
  if (lines.length === 0) fail('Source artifact contains no machine-readable implementation contract');
  const opportunities = changeClass === 'refactor' ? selectedOpportunityBlocks(text, selectedIds).map(opportunityContract) : [];
  return digestBytes(Buffer.from([...opportunities, ...lines].join('\n')));
}

function readOptionalManifest(changeId, repoRoot) {
  try {
    return readManifest(changeId, repoRoot);
  } catch (error) {
    if (error.message.startsWith('Manifest not found:')) return null;
    throw error;
  }
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  temporaryFiles.add(temporary);
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, file);
  temporaryFiles.delete(temporary);
}

function readState(file, changeId) {
  if (!fs.existsSync(file)) fail(`Implementation state not found: ${file}. Run --init first.`);
  let state;
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Could not read implementation state: ${error.message}`);
  }
  if (!isPlainObject(state) || state.version !== 2 || state.changeId !== changeId ||
      !Array.isArray(state.expectedUnitIds) || !isPlainObject(state.units)) {
    fail(`Invalid implementation state: ${file}`);
  }
  return state;
}

function snapshot(relativePaths, repoRoot) {
  const aggregate = createHash('sha256');
  const files = [];
  for (const relativePath of [...relativePaths].sort()) {
    const absolutePath = path.resolve(repoRoot, ...relativePath.split('/'));
    let stat = null;
    try {
      stat = fs.lstatSync(absolutePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const exists = stat !== null;
    aggregate.update(relativePath, 'utf8');
    aggregate.update(Buffer.from([0, exists ? 1 : 0, 0]));
    if (!exists) {
      files.push({ path: relativePath, exists: false, sha256: null, bytes: 0 });
      continue;
    }
    const mode = stat.mode & 0o7777;
    const type = stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'file' : null;
    if (!type) fail(`Snapshot path is not a file or symlink: ${relativePath}`);
    const content = type === 'symlink' ? Buffer.from(fs.readlinkSync(absolutePath)) : fs.readFileSync(absolutePath);
    aggregate.update(type, 'utf8');
    aggregate.update(Buffer.from([0]));
    aggregate.update(String(mode), 'utf8');
    aggregate.update(Buffer.from([0]));
    aggregate.update(content);
    aggregate.update(Buffer.from([0]));
    files.push({
      path: relativePath,
      exists: true,
      type,
      mode,
      ...(type === 'symlink' ? { target: content.toString('utf8') } : {}),
      sha256: createHash('sha256').update(content).digest('hex'),
      bytes: content.length,
    });
  }
  return { sha256: aggregate.digest('hex'), files };
}

function unitSnapshot(unit, repoRoot) {
  return snapshot([...new Set([...unit.files, ...unit.lockedTestFiles])], repoRoot);
}

function lockedTestSnapshot(unit, repoRoot) {
  return snapshot(unit.lockedTestFiles, repoRoot);
}

function worktreeState(repoRoot) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const chunks = result.stdout.split('\0').filter(Boolean);
  const statuses = new Map();
  for (let index = 0; index < chunks.length; index += 1) {
    const entry = chunks[index];
    const status = entry.slice(0, 2);
    const relativePath = normalizeRelativePath(entry.slice(3), 'git status path');
    if (!relativePath.startsWith('.changes/')) statuses.set(relativePath, status);
    if (/[RC]/.test(status) && chunks[index + 1]) {
      const original = normalizeRelativePath(chunks[index + 1], 'git rename source');
      if (!original.startsWith('.changes/')) statuses.set(original, status);
      index += 1;
    }
  }
  const resultState = {};
  for (const [relativePath, status] of [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const item = snapshot([relativePath], repoRoot);
    resultState[relativePath] = { status, snapshot: item.sha256 };
  }
  return resultState;
}

function gitHead(repoRoot) {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function gitIndexDivergence(relativePaths, repoRoot) {
  const result = spawnSync('git', ['diff', '--name-only', '-z', '--', ...relativePaths], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.split('\0').filter(Boolean).map(item => normalizeRelativePath(item, 'git index path')).sort();
}

function gitUntrackedPaths(relativePaths, repoRoot) {
  if (relativePaths.length === 0) return [];
  const result = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', ...relativePaths], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.split('\0').filter(Boolean).map(item => normalizeRelativePath(item, 'git untracked path')).sort();
}

function committedPathsSince(initialHead, repoRoot) {
  if (!initialHead) return [];
  const currentHead = gitHead(repoRoot);
  if (!currentHead) return ['git-history-unavailable'];
  const result = spawnSync('git', ['diff', '--name-only', '-z', initialHead, currentHead], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return ['git-history-unavailable'];
  return result.stdout.split('\0').filter(Boolean)
    .map(item => normalizeRelativePath(item, 'git history path'))
    .filter(item => !item.startsWith('.changes/'));
}

function unexplainedWorktreeChanges(state, repoRoot, allowedPaths = []) {
  const declared = new Set(Object.values(state.units).flatMap(unit => [...unit.files, ...unit.lockedTestFiles]));
  const allowed = new Set(allowedPaths);
  const unexplained = new Set(committedPathsSince(state.initialHead, repoRoot).filter(item => !declared.has(item) && !allowed.has(item)));
  if (state.initialWorktree !== null) {
    const current = worktreeState(repoRoot);
    if (current === null) unexplained.add('git-worktree-unavailable');
    else {
      const paths = new Set([...Object.keys(state.initialWorktree), ...Object.keys(current)]);
      for (const relativePath of paths) {
        if (!declared.has(relativePath) && !allowed.has(relativePath) && JSON.stringify(state.initialWorktree[relativePath] ?? null) !== JSON.stringify(current[relativePath] ?? null)) {
          unexplained.add(relativePath);
        }
      }
    }
  }
  return [...unexplained].sort();
}

function getUnit(state, unitId) {
  if (!unitId) fail('--unit <unit-id> is required for this action');
  const unit = state.units[unitId];
  if (!unit) fail(`Unknown implementation unit '${unitId}'`);
  if (!PHASES.includes(unit.phase)) fail(`Unit '${unitId}' has invalid phase '${unit.phase}'`);
  return unit;
}

function clearToBuilding(unit) {
  unit.phase = 'building';
  unit.baseline = null;
  unit.initialReview = null;
  unit.refactorStartedAt = null;
  unit.tested = null;
  unit.finalReview = null;
  unit.noChangeRationale = null;
}

function clearToRefactoring(unit) {
  unit.phase = 'refactoring';
  unit.tested = null;
  unit.finalReview = null;
  unit.noChangeRationale = null;
}

function detectInvalidation(unit, repoRoot) {
  const lockedCurrent = lockedTestSnapshot(unit, repoRoot);
  if (unit.lockedTestBaseline && lockedCurrent.sha256 !== unit.lockedTestBaseline.sha256) {
    return { locked: true, reason: 'locked test files differ from the immutable first-green baseline', current: lockedCurrent };
  }
  if (unit.phase === 'building') return null;

  const current = unitSnapshot(unit, repoRoot);
  if (unit.phase === 'green' && current.sha256 !== unit.baseline.snapshot.sha256) {
    return { phase: 'building', reason: 'declared files changed after the green baseline' };
  }
  if (unit.phase === 'reviewed' && current.sha256 !== unit.initialReview.snapshot) {
    return { phase: 'building', reason: 'declared files changed after the initial review' };
  }
  if ((unit.phase === 'tested' || unit.phase === 'verified') && current.sha256 !== unit.tested?.snapshot?.sha256) {
    return { phase: 'refactoring', reason: 'declared files changed after the final test' };
  }
  return null;
}

function invalidateIfNeeded(unit, file, state, repoRoot) {
  const invalidation = detectInvalidation(unit, repoRoot);
  if (!invalidation) {
    if (unit.lockViolation) unit.lockViolation = null;
    return;
  }
  if (invalidation.locked) {
    unit.lockViolation = {
      detectedAt: new Date().toISOString(),
      expected: unit.lockedTestBaseline.sha256,
      actual: invalidation.current.sha256,
    };
    writeState(file, state);
    fail(`Unit '${unit.id}' is blocked: ${invalidation.reason}. Restore the locked files; they cannot be re-baselined.`);
  }
  if (invalidation.phase === 'building') clearToBuilding(unit);
  else clearToRefactoring(unit);
  writeState(file, state);
  fail(`Unit '${unit.id}' was invalidated to '${invalidation.phase}': ${invalidation.reason}. No requested transition was performed.`);
}

function requirePhase(unit, expected, action) {
  if (unit.phase !== expected) {
    fail(`${action} requires unit '${unit.id}' to be '${expected}', currently '${unit.phase}'`);
  }
}

function runTestCommand(command, repoRoot, label) {
  if (typeof command !== 'string' || command.trim() === '') fail('--command <command> is required for test transitions');
  console.error(`Running ${label}: ${command}`);
  const result = spawnSync(command, {
    cwd: repoRoot,
    shell: true,
    encoding: 'utf8',
    env: process.env,
  });
  if (result.stdout) process.stderr.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) fail(`${label} could not run: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status ?? 'unknown'}`);
}

function normalizeCommand(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} must be a non-empty command`);
  const command = value.trim();
  if (/^(?:true|:|exit\s+0|(?:node|bun|deno)\s+-e\s+["']?process\.exit\(0\)["']?)\s*;?$/i.test(command)) {
    fail(`${label} must run a substantive verification command, not '${command}'`);
  }
  return command;
}

function normalizeReview(review, expectedStage, unit) {
  if (!isPlainObject(review)) fail('Review JSON must be an object');
  if (review.version !== 1) fail('Review version must be 1');
  if (review.unitId !== unit.id) fail(`Review unitId must be '${unit.id}'`);
  if (review.stage !== expectedStage) fail(`Review stage must be '${expectedStage}'`);
  if (typeof review.snapshot !== 'string' || !SNAPSHOT_PATTERN.test(review.snapshot)) {
    fail('Review snapshot must be a lowercase SHA-256 digest');
  }
  if (!Array.isArray(review.findings)) fail('Review findings must be an array');
  const expectedRole = expectedStage === 'initial' ? 'read-only-initial-reviewer' : 'fresh-final-reviewer';
  if (review.reviewerRole !== expectedRole) fail(`${expectedStage} reviewerRole must be '${expectedRole}'`);
  if (typeof review.reviewerId !== 'string' || !UNIT_ID_PATTERN.test(review.reviewerId)) {
    fail('Review reviewerId must be a stable non-empty session identifier');
  }
  if (expectedStage === 'final' && review.reviewerId === unit.initialReview?.reviewerId) {
    fail('Final reviewerId must differ from the initial reviewerId');
  }
  if (!Array.isArray(review.checks) || review.checks.length === 0 || review.checks.some(check => typeof check !== 'string' || check.trim() === '')) {
    fail('Review checks must be a non-empty array of substantive check descriptions');
  }

  const findingIds = new Set();
  const findings = review.findings.map((finding, index) => {
    if (!isPlainObject(finding)) fail(`Review finding ${index} must be an object`);
    if (typeof finding.id !== 'string' || !UNIT_ID_PATTERN.test(finding.id)) {
      fail(`Review finding ${index} must have a stable id`);
    }
    if (findingIds.has(finding.id)) fail(`Duplicate review finding id '${finding.id}'`);
    findingIds.add(finding.id);
    if (!REVIEW_CATEGORIES.includes(finding.category)) {
      fail(`Review finding '${finding.id}' has invalid category '${finding.category}'`);
    }
    if (finding.category === 'kickback') {
      const route = unit.changeClass === 'refactor'
        ? 'must stop this refactor and create an architect change'
        : 'must use kickback-log.mjs';
      fail(`Review finding '${finding.id}' is a kickback and ${route}; it cannot be resolved inside a review report`);
    }
    if (!REVIEW_STATUSES.includes(finding.status)) {
      fail(`Review finding '${finding.id}' has invalid status '${finding.status}'`);
    }
    if (!REVIEW_SEVERITIES.includes(finding.severity)) {
      fail(`Review finding '${finding.id}' has invalid severity '${finding.severity}'`);
    }
    const file = normalizeRelativePath(finding.file, `Review finding '${finding.id}'.file`);
    if (!Number.isInteger(finding.line) || finding.line < 1) {
      fail(`Review finding '${finding.id}' must have a positive line number`);
    }
    if (typeof finding.summary !== 'string' || finding.summary.trim() === '') {
      fail(`Review finding '${finding.id}' must have a non-empty summary`);
    }
    if (typeof finding.disposition !== 'string' || finding.disposition.trim() === '') {
      fail(`Review finding '${finding.id}' must have a non-empty disposition`);
    }
    return {
      id: finding.id,
      category: finding.category,
      severity: finding.severity,
      status: finding.status,
      file,
      line: finding.line,
      summary: finding.summary.trim(),
      disposition: finding.disposition.trim(),
    };
  });

  if (findings.length === 0 && !substantiveRationale(review.noFindingsRationale)) {
    fail('A review with no findings requires a substantive noFindingsRationale');
  }

  const expectedVerdict = expectedStage === 'initial' ? 'ready-for-refactor' : 'behavior-preserved';
  if (review.verdict !== expectedVerdict) {
    fail(`${expectedStage} review verdict must be '${expectedVerdict}'`);
  }
  return {
    version: 1,
    unitId: unit.id,
    stage: expectedStage,
    snapshot: review.snapshot,
    reviewerRole: review.reviewerRole,
    reviewerId: review.reviewerId,
    checks: review.checks.map(check => check.trim()),
    verdict: review.verdict,
    findings,
    noFindingsRationale: findings.length === 0 ? review.noFindingsRationale.trim() : null,
  };
}

function unresolved(review, categories) {
  return review.findings.filter(finding => finding.status === 'unresolved' && categories.includes(finding.category));
}

function reviewerIds(state) {
  const used = new Set(state.reviewerIds || []);
  for (const [id, candidate] of Object.entries(state.units)) {
    if (candidate.initialReview?.reviewerId) used.add(candidate.initialReview.reviewerId);
    if (candidate.finalReview?.reviewerId) used.add(candidate.finalReview.reviewerId);
  }
  return used;
}

function validateReviewerSeparation(review, state) {
  const used = reviewerIds(state);
  if (used.has(review.reviewerId)) fail(`ReviewerId '${review.reviewerId}' was already used by another implementation unit`);
}

function substantiveRationale(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  const words = trimmed.match(/[A-Za-z0-9]+/g) || [];
  return trimmed.length >= 20 && words.length >= 4 && !/^(?:n\/?a|none|no changes?|not needed)\.?$/i.test(trimmed);
}

function healthForUnit(unit, repoRoot) {
  let current;
  let lockedTestsCurrent = true;
  try {
    current = unitSnapshot(unit, repoRoot);
    if (unit.lockedTestBaseline) {
      lockedTestsCurrent = lockedTestSnapshot(unit, repoRoot).sha256 === unit.lockedTestBaseline.sha256;
    }
  } catch (error) {
    return { id: unit.id, phase: unit.phase, current: false, reason: error.message };
  }
  const boundSnapshot = unit.phase === 'green' ? unit.baseline?.snapshot?.sha256
    : unit.phase === 'reviewed' ? unit.initialReview?.snapshot
      : (unit.phase === 'tested' || unit.phase === 'verified') ? unit.tested?.snapshot?.sha256
        : null;
  return {
    id: unit.id,
    phase: unit.phase,
    snapshot: current.sha256,
    boundSnapshot,
    current: lockedTestsCurrent && (boundSnapshot === null || boundSnapshot === current.sha256),
    lockedTestsCurrent,
  };
}


function stripMarkdownCode(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('`') && trimmed.endsWith('`') ? trimmed.slice(1, -1).trim() : trimmed;
}

function parseJsonList(value, label, { paths = false, allowEmpty = false, pattern = null } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(stripMarkdownCode(value));
  } catch (error) {
    fail(`${label} must be a JSON array: ${error.message}`);
  }
  if (paths) return normalizePathList(parsed, label, { allowEmpty });
  if (!Array.isArray(parsed) || (!allowEmpty && parsed.length === 0)) {
    fail(`${label} must be ${allowEmpty ? 'an' : 'a non-empty'} JSON array`);
  }
  const normalized = parsed.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '' || (pattern && !pattern.test(item.trim()))) {
      fail(`${label}[${index}] is invalid`);
    }
    return item.trim();
  });
  if (new Set(normalized).size !== normalized.length) fail(`${label} must not contain duplicates`);
  return normalized.sort();
}

function sameList(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedUnitContracts(manifest, changeId, repoRoot) {
  const artifact = normalizeRelativePath(
    manifest.class === 'refactor' ? manifest.artifacts?.refactor || 'refactor.md' : manifest.artifacts?.plan || 'plan.md',
    'checkpoint source artifact',
  );
  const file = path.join(repoRoot, '.changes', 'active', changeId, artifact);
  if (!fs.existsSync(file)) fail(`Checkpoint source artifact not found: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  const contracts = new Map();
  let ids;
  if (manifest.class === 'refactor') {
    ids = [...text.matchAll(/^###\s+(B-[A-Za-z0-9._-]+)\b/gm)].map(match => match[1]);
    const tableRows = text.split('\n').filter(line => /^\|\s*B-[A-Za-z0-9._-]+\s*\|/.test(line));
    for (const row of tableRows) {
      const columns = row.split('|').slice(1, -1).map(value => value.trim());
      if (columns.length < 6) fail('Refactor implementation-unit table must include baseline and final commands');
      contracts.set(columns[0], {
        selectedIds: parseJsonList(columns[1], `Refactor unit '${columns[0]}' selected IDs`, { pattern: /^RF-[A-Za-z0-9._-]+$/ }),
        files: parseJsonList(columns[2], `Refactor unit '${columns[0]}' editable files`, { paths: true }),
        lockedTestFiles: parseJsonList(columns[3], `Refactor unit '${columns[0]}' locked test files`, { paths: true, allowEmpty: true }),
        baselineCommand: stripMarkdownCode(columns[4]),
        finalCommand: stripMarkdownCode(columns[5]),
      });
    }
  } else {
    const markers = [...text.matchAll(/>\s*\*\*Checkpoint unit:\*\*\s*([A-Za-z0-9][A-Za-z0-9._-]*)/g)];
    ids = markers.map(match => match[1]);
    for (const [index, marker] of markers.entries()) {
      const segment = text.slice(marker.index, markers[index + 1]?.index ?? text.length);
      const baselineCommand = segment.match(/>\s*\*\*Baseline command:\*\*\s*`([^`]+)`/)?.[1]?.trim();
      const finalCommand = segment.match(/>\s*\*\*Final command:\*\*\s*`([^`]+)`/)?.[1]?.trim();
      const editableFiles = segment.match(/>\s*\*\*Editable files:\*\*\s*(`[^`]+`)/)?.[1];
      const lockedTestFiles = segment.match(/>\s*\*\*Locked test files:\*\*\s*(`[^`]+`)/)?.[1];
      if (!baselineCommand || !finalCommand || !editableFiles || !lockedTestFiles) {
        fail(`Checkpoint unit '${marker[1]}' must declare machine-readable files, locks, baseline command, and final command`);
      }
      contracts.set(marker[1], {
        files: parseJsonList(editableFiles, `Checkpoint unit '${marker[1]}' editable files`, { paths: true }),
        lockedTestFiles: parseJsonList(lockedTestFiles, `Checkpoint unit '${marker[1]}' locked test files`, { paths: true, allowEmpty: true }),
        baselineCommand,
        finalCommand,
      });
    }
  }
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) fail(`${artifact} contains no machine-readable checkpoint unit declarations`);
  if (unique.length !== ids.length) fail(`${artifact} contains duplicate checkpoint unit declarations`);
  if (contracts.size !== unique.length || unique.some(id => !contracts.has(id))) fail(`${artifact} unit command declarations do not match its checkpoint units`);
  if (manifest.class === 'refactor') {
    const approved = Array.isArray(manifest.refactor_selected_ids) ? [...manifest.refactor_selected_ids].sort() : [];
    const assigned = [...contracts.values()].flatMap(contract => contract.selectedIds).sort();
    if (new Set(assigned).size !== assigned.length) fail('Each selected refactor opportunity must belong to exactly one implementation unit');
    if (!sameList(assigned, approved)) fail('Refactor implementation units must cover exactly the user-approved RF IDs');
  }
  return { ids: unique, contracts, digest: contractDigest(text, manifest.class, manifest.refactor_selected_ids || []) };
}

function validateImplementationAuthorization(manifest) {
  if (manifest.stage !== 'implement') fail(`Implementation checkpoints require stage 'implement', currently '${manifest.stage}'`);
  if (manifest.class === 'refactor') {
    if (manifest.gates?.refactor !== 'approved' || manifest.refactor_mode !== 'execute') {
      fail('Refactor implementation requires the approved execution selection gate');
    }
  } else if (manifest.gates?.plan !== 'approved') {
    fail('Implementation checkpoints require the approved plan gate');
  }
}

function validateManifestBinding(manifest, state, changeId, repoRoot) {
  const epoch = Number.isInteger(manifest.checkpoint_epoch) ? manifest.checkpoint_epoch : 0;
  if (state.checkpointEpoch !== epoch) {
    fail(`Implementation state epoch ${state.checkpointEpoch} is stale; manifest epoch is ${epoch}. Resolve and reapprove the upstream change, then use --reset.`);
  }
  validateImplementationAuthorization(manifest);
  const canonical = unitsPath(changeId, repoRoot);
  if (!fs.existsSync(canonical)) fail(`Canonical unit declarations not found: ${canonical}`);
  const digest = digestBytes(fs.readFileSync(canonical));
  if (digest !== state.declarationDigest) fail('Canonical implementation unit declarations changed after initialization; use the supported --reset flow');
  const expected = expectedUnitContracts(manifest, changeId, repoRoot);
  if (!manifest.implementation_contract_digest || manifest.implementation_contract_digest !== expected.digest || state.contractDigest !== expected.digest) {
    fail('The machine-readable implementation contract differs from the upstream gate-approved artifact; reset and reapprove it');
  }
  if (JSON.stringify(expected.ids) !== JSON.stringify(state.expectedUnitIds)) {
    fail(`Checkpoint units do not match ${manifest.class === 'refactor' ? 'refactor.md batches' : 'plan.md sections'}`);
  }
  for (const id of expected.ids) {
    const contract = expected.contracts.get(id);
    if (!sameList(state.units[id].files, contract.files) || !sameList(state.units[id].lockedTestFiles, contract.lockedTestFiles) ||
        !sameList(state.units[id].selectedIds || [], contract.selectedIds || []) ||
        state.units[id].baselineCommand !== contract.baselineCommand || state.units[id].finalCommand !== contract.finalCommand) {
      fail(`Unit '${id}' files, locks, or commands do not match the source artifact`);
    }
  }
}

function initializeState(values, repoRoot, file, manifest, { reset = false, reviewerIds: priorReviewerIds = [] } = {}) {
  const canonical = unitsPath(values.id, repoRoot);
  if (manifest) {
    if (path.resolve(repoRoot, values.units || '') !== canonical) {
      fail(`Manifest-backed changes must use --units ${path.relative(repoRoot, canonical)}`);
    }
    validateImplementationAuthorization(manifest);
  }
  const declarations = loadJsonArgument(values.units, '--units', repoRoot);
  if (!Array.isArray(declarations) || declarations.length === 0) fail('--units must declare at least one implementation unit');
  const units = {};
  const ownedPaths = new Map();
  for (const [index, declaration] of declarations.entries()) {
    if (!isPlainObject(declaration)) fail(`Unit declaration ${index} must be an object`);
    if (typeof declaration.id !== 'string' || !UNIT_ID_PATTERN.test(declaration.id)) fail(`Unit declaration ${index} has an invalid stable id`);
    if (units[declaration.id]) fail(`Duplicate implementation unit id '${declaration.id}'`);
    const files = normalizePathList(declaration.files, `units[${index}].files`);
    const lockedTestFiles = normalizePathList(declaration.lockedTestFiles, `units[${index}].lockedTestFiles`, { allowEmpty: true });
    const overlap = files.find(item => lockedTestFiles.includes(item));
    if (overlap) fail(`Unit '${declaration.id}' declares '${overlap}' as both implementation and locked test file`);
    for (const ownedPath of [...files, ...lockedTestFiles]) {
      if (ownedPaths.has(ownedPath)) fail(`Path '${ownedPath}' is owned by both '${ownedPaths.get(ownedPath)}' and '${declaration.id}'`);
      ownedPaths.set(ownedPath, declaration.id);
    }
    units[declaration.id] = {
      id: declaration.id,
      changeClass: manifest?.class || null,
      files,
      lockedTestFiles,
      baselineCommand: normalizeCommand(declaration.baselineCommand, `units[${index}].baselineCommand`),
      finalCommand: normalizeCommand(declaration.finalCommand, `units[${index}].finalCommand`),
      phase: 'building',
      lockedTestBaseline: null,
      lockViolation: null,
      baseline: null,
      initialReview: null,
      refactorStartedAt: null,
      tested: null,
      finalReview: null,
      noChangeRationale: null,
    };
  }
  const ids = Object.keys(units).sort();
  let expected = null;
  if (manifest) {
    expected = expectedUnitContracts(manifest, values.id, repoRoot);
    if (!manifest.implementation_contract_digest && ['bug', 'small'].includes(manifest.class)) {
      manifest.implementation_contract_digest = expected.digest;
      writeManifest(values.id, manifest, repoRoot);
    }
    if (manifest.implementation_contract_digest !== expected.digest) {
      fail('The machine-readable implementation contract differs from the upstream gate-approved artifact');
    }
    if (JSON.stringify(expected.ids) !== JSON.stringify(ids)) fail(`Declared units must exactly match ${manifest.class === 'refactor' ? 'refactor.md batch headings' : 'plan.md checkpoint markers'}`);
    for (const id of ids) {
      const contract = expected.contracts.get(id);
      if (!sameList(units[id].files, contract.files) || !sameList(units[id].lockedTestFiles, contract.lockedTestFiles) ||
          units[id].baselineCommand !== contract.baselineCommand || units[id].finalCommand !== contract.finalCommand) {
        fail(`Unit '${id}' files, locks, and commands must exactly match the source artifact`);
      }
      units[id].selectedIds = contract.selectedIds || [];
    }
  }
  const initialHead = gitHead(repoRoot);
  const initialWorktree = worktreeState(repoRoot);
  if (manifest && (!initialHead || initialWorktree === null)) {
    fail('Manifest-backed checkpoints require an initialized Git repository with a valid HEAD');
  }
  for (const unit of Object.values(units)) unit.initialSnapshot = unitSnapshot(unit, repoRoot);
  const state = {
    version: 2,
    changeId: values.id,
    checkpointEpoch: manifest && Number.isInteger(manifest.checkpoint_epoch) ? manifest.checkpoint_epoch : 0,
    declarationDigest: manifest ? digestBytes(fs.readFileSync(canonical)) : digestBytes(Buffer.from(JSON.stringify(declarations))),
    contractDigest: expected?.digest || null,
    expectedUnitIds: ids,
    units: Object.fromEntries(ids.map(id => [id, units[id]])),
    initializedAt: new Date().toISOString(),
    initialHead,
    initialWorktree,
    reviewerIds: [...new Set(priorReviewerIds)].sort(),
    reset,
  };
  writeState(file, state);
  return state;
}

function expectedOwnershipSnapshot(unit) {
  if (unit.phase === 'building') return unit.initialSnapshot?.sha256;
  if (unit.phase === 'green') return unit.baseline?.snapshot?.sha256;
  if (unit.phase === 'reviewed') return unit.initialReview?.snapshot;
  if (unit.phase === 'tested' || unit.phase === 'verified') return unit.tested?.snapshot?.sha256;
  return null;
}

function validateOtherUnitBoundaries(state, activeUnitId, repoRoot) {
  for (const id of state.expectedUnitIds) {
    if (id === activeUnitId) continue;
    const unit = state.units[id];
    const expected = expectedOwnershipSnapshot(unit);
    if (!expected || unitSnapshot(unit, repoRoot).sha256 !== expected) {
      fail(`Unit '${activeUnitId}' cannot proceed because path ownership for unit '${id}' changed outside its checkpoint cycle`);
    }
  }
}

function validateGitIndex(state, repoRoot, additionalPaths = []) {
  if (!state.initialHead) return;
  const declared = [...Object.values(state.units).flatMap(unit => [...unit.files, ...unit.lockedTestFiles]), ...additionalPaths];
  const divergent = gitIndexDivergence(declared, repoRoot);
  if (divergent === null) fail('Git index state is unavailable; checkpoint verification fails closed');
  const untrackedDocs = gitUntrackedPaths(additionalPaths, repoRoot);
  if (untrackedDocs === null) fail('Git untracked-file state is unavailable; checkpoint verification fails closed');
  const inconsistent = [...new Set([...divergent, ...untrackedDocs])].sort();
  if (inconsistent.length > 0) fail(`Git index content differs from the reviewed worktree for: ${inconsistent.join(', ')}`);
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function main() {
  const { values } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h', default: false },
      root: { type: 'string', default: process.cwd() },
      id: { type: 'string' },
      unit: { type: 'string' },
      init: { type: 'boolean', default: false },
      reset: { type: 'boolean', default: false },
      units: { type: 'string' },
      'baseline-test': { type: 'boolean', default: false },
      'initial-review': { type: 'boolean', default: false },
      'start-refactor': { type: 'boolean', default: false },
      'final-test': { type: 'boolean', default: false },
      'final-review': { type: 'boolean', default: false },
      status: { type: 'boolean', default: false },
      'check-all': { type: 'boolean', default: false },
      'allow-docs': { type: 'boolean', default: false },
      command: { type: 'string' },
      review: { type: 'string' },
      'no-change-rationale': { type: 'string' },
    },
    strict: true,
  });

  if (values.help) {
    console.log(HELP);
    return;
  }
  if (!values.id || !UNIT_ID_PATTERN.test(values.id)) fail('--id must be a stable identifier using letters, numbers, dot, underscore, or hyphen');

  const actions = [
    ['init', values.init],
    ['reset', values.reset],
    ['baseline-test', values['baseline-test']],
    ['initial-review', values['initial-review']],
    ['start-refactor', values['start-refactor']],
    ['final-test', values['final-test']],
    ['final-review', values['final-review']],
    ['status', values.status],
    ['check-all', values['check-all']],
  ].filter(([, selected]) => selected).map(([name]) => name);
  if (actions.length !== 1) fail('Select exactly one action. Use --help for usage.');

  const action = actions[0];
  const repoRoot = path.resolve(values.root);
  const file = statePath(values.id, repoRoot);

  const manifest = readOptionalManifest(values.id, repoRoot);

  if (action === 'init' || action === 'reset') {
    let priorReviewerIds = [];
    if (action === 'init' && fs.existsSync(file)) fail(`Implementation state already exists: ${file}`);
    if (action === 'reset') {
      if (!manifest) fail('--reset requires an active manifest');
      if (!fs.existsSync(file)) fail('Implementation state does not exist; use --init');
      const unresolved = (manifest.kickbacks || []).filter(item => typeof item.resolution !== 'string' || item.resolution.trim() === '');
      const authorizationReady = manifest.class === 'refactor'
        ? manifest.stage === 'implement' && manifest.gates?.refactor === 'approved' && manifest.refactor_mode === 'execute'
        : manifest.stage === 'implement' && manifest.gates?.plan === 'approved' && unresolved.length === 0;
      if (!authorizationReady) {
        fail('--reset is allowed only after the amended plan or refactor selection gate is reapproved');
      }
      const previous = readState(file, values.id);
      priorReviewerIds = [...reviewerIds(previous)];
      if (previous.checkpointEpoch === (manifest.checkpoint_epoch ?? 0)) fail('--reset requires a newer manifest checkpoint_epoch');
      const history = path.join(repoRoot, '.changes', 'active', values.id, 'checkpoint-history', `epoch-${previous.checkpointEpoch}-${Date.now()}`);
      fs.mkdirSync(history, { recursive: true });
      fs.copyFileSync(file, path.join(history, 'implementation-state.json'));
      const reviews = path.join(repoRoot, '.changes', 'active', values.id, 'reviews');
      if (fs.existsSync(reviews)) fs.cpSync(reviews, path.join(history, 'reviews'), { recursive: true });
    }
    const state = initializeState(values, repoRoot, file, manifest, { reset: action === 'reset', reviewerIds: priorReviewerIds });
    if (action === 'reset') fs.rmSync(path.join(repoRoot, '.changes', 'active', values.id, 'reviews'), { recursive: true, force: true });
    console.error(`${action === 'reset' ? 'Reset' : 'Initialized'} ${state.expectedUnitIds.length} implementation unit(s) for '${values.id}'`);
    output({ id: values.id, transition: action === 'reset' ? 'reset' : 'initialized', stateFile: path.relative(repoRoot, file), expectedUnitIds: state.expectedUnitIds });
    return;
  }

  const state = readState(file, values.id);
  if (manifest) validateManifestBinding(manifest, state, values.id, repoRoot);
  if (action === 'check-all') {
    const allowedDocs = values['allow-docs'] && manifest ? (manifest.context_targets || []).map(item => normalizeRelativePath(item, 'context target')) : [];
    validateGitIndex(state, repoRoot, allowedDocs);
    const units = state.expectedUnitIds.map(id => healthForUnit(getUnit(state, id), repoRoot));
    const unexplainedFiles = unexplainedWorktreeChanges(state, repoRoot, allowedDocs);
    const valid = units.every(unit => unit.phase === 'verified' && unit.current && unit.lockedTestsCurrent) && unexplainedFiles.length === 0;
    output({ id: values.id, valid, units, unexplainedFiles });
    if (!valid) fail(unexplainedFiles.length > 0
      ? `Undeclared worktree changes appeared after initialization: ${unexplainedFiles.join(', ')}`
      : 'Not all expected implementation units are verified and current');
    return;
  }

  if (action === 'status') {
    const selected = values.unit ? [getUnit(state, values.unit)] : state.expectedUnitIds.map(id => getUnit(state, id));
    output({ id: values.id, units: selected.map(unit => healthForUnit(unit, repoRoot)) });
    return;
  }

  const unit = getUnit(state, values.unit);
  validateGitIndex(state, repoRoot);
  validateOtherUnitBoundaries(state, unit.id, repoRoot);
  invalidateIfNeeded(unit, file, state, repoRoot);

  if (action === 'baseline-test') {
    requirePhase(unit, 'building', '--baseline-test');
    if (values.command !== unit.baselineCommand) fail(`--command must exactly match the declared baselineCommand for unit '${unit.id}'`);
    runTestCommand(values.command, repoRoot, 'baseline test');
    const lockedAfter = lockedTestSnapshot(unit, repoRoot);
    if (unit.lockedTestBaseline && lockedAfter.sha256 !== unit.lockedTestBaseline.sha256) {
      unit.lockViolation = { detectedAt: new Date().toISOString(), expected: unit.lockedTestBaseline.sha256, actual: lockedAfter.sha256 };
      writeState(file, state);
      fail(`Unit '${unit.id}' is blocked: the baseline command changed immutable locked test files`);
    }
    if (!unit.lockedTestBaseline) unit.lockedTestBaseline = lockedAfter;
    unit.baseline = {
      snapshot: unitSnapshot(unit, repoRoot),
      command: values.command,
      passedAt: new Date().toISOString(),
    };
    unit.phase = 'green';
  } else if (action === 'initial-review') {
    requirePhase(unit, 'green', '--initial-review');
    const review = normalizeReview(loadJsonArgument(values.review, '--review', repoRoot), 'initial', unit);
    validateReviewerSeparation(review, state);
    const current = unitSnapshot(unit, repoRoot);
    if (review.snapshot !== unit.baseline.snapshot.sha256 || review.snapshot !== current.sha256) {
      fail('Initial review snapshot does not match the green and current snapshot');
    }
    const blockers = unresolved(review, ['blocking']);
    if (blockers.length > 0) fail(`Initial review has unresolved blocking findings: ${blockers.map(item => item.id).join(', ')}`);
    const reviewPath = path.join(repoRoot, '.changes', 'active', values.id, 'reviews', `${unit.id}-initial.json`);
    writeState(reviewPath, review);
    unit.initialReview = { ...review, report: path.relative(repoRoot, reviewPath), acceptedAt: new Date().toISOString() };
    state.reviewerIds = [...reviewerIds(state)].sort();
    unit.phase = 'reviewed';
  } else if (action === 'start-refactor') {
    requirePhase(unit, 'reviewed', '--start-refactor');
    unit.refactorStartedAt = new Date().toISOString();
    unit.phase = 'refactoring';
  } else if (action === 'final-test') {
    requirePhase(unit, 'refactoring', '--final-test');
    if (values.command !== unit.finalCommand) fail(`--command must exactly match the declared finalCommand for unit '${unit.id}'`);
    const before = unitSnapshot(unit, repoRoot);
    const noChange = before.sha256 === unit.initialReview.snapshot;
    if (noChange && !substantiveRationale(values['no-change-rationale'])) {
      fail('A no-op refactor requires a substantive --no-change-rationale (at least four words and 20 characters)');
    }
    runTestCommand(values.command, repoRoot, 'final test');
    const lockedAfter = lockedTestSnapshot(unit, repoRoot);
    if (lockedAfter.sha256 !== unit.lockedTestBaseline.sha256) {
      unit.lockViolation = { detectedAt: new Date().toISOString(), expected: unit.lockedTestBaseline.sha256, actual: lockedAfter.sha256 };
      writeState(file, state);
      fail(`Unit '${unit.id}' is blocked: the final test command changed immutable locked test files`);
    }
    const finalSnapshot = unitSnapshot(unit, repoRoot);
    const finalNoChange = finalSnapshot.sha256 === unit.initialReview.snapshot;
    if (finalNoChange && !substantiveRationale(values['no-change-rationale'])) {
      fail('The final test produced a no-op refactor; provide a substantive --no-change-rationale and run it again');
    }
    unit.tested = {
      snapshot: finalSnapshot,
      command: values.command,
      passedAt: new Date().toISOString(),
    };
    unit.noChangeRationale = finalNoChange ? values['no-change-rationale'].trim() : null;
    unit.phase = 'tested';
  } else if (action === 'final-review') {
    requirePhase(unit, 'tested', '--final-review');
    const review = normalizeReview(loadJsonArgument(values.review, '--review', repoRoot), 'final', unit);
    validateReviewerSeparation(review, state);
    const current = unitSnapshot(unit, repoRoot);
    if (review.snapshot !== unit.tested.snapshot.sha256 || review.snapshot !== current.sha256) {
      fail('Final review snapshot does not match the tested and current snapshot');
    }
    const blockers = unresolved(review, ['blocking']);
    if (blockers.length > 0) fail(`Final review has unresolved blocking findings: ${blockers.map(item => item.id).join(', ')}`);
    const reviewPath = path.join(repoRoot, '.changes', 'active', values.id, 'reviews', `${unit.id}-final.json`);
    writeState(reviewPath, review);
    unit.finalReview = { ...review, report: path.relative(repoRoot, reviewPath), acceptedAt: new Date().toISOString() };
    state.reviewerIds = [...reviewerIds(state)].sort();
    unit.phase = 'verified';
  }

  writeState(file, state);
  console.error(`Unit '${unit.id}' advanced to '${unit.phase}'`);
  output({ id: values.id, unitId: unit.id, phase: unit.phase, snapshot: unitSnapshot(unit, repoRoot).sha256 });
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
