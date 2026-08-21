#!/usr/bin/env node
/** Verify strict CONTEXT provenance, drift, and executable firm-seam citations. */

import fs from 'fs';
import path from 'path';
import { execFileSync, execSync } from 'child_process';
import { parseArgs } from 'util';

const { values } = parseArgs({ options: {
  help: { type: 'boolean', short: 'h', default: false }, root: { type: 'string', default: process.cwd() },
  path: { type: 'string' }, all: { type: 'boolean', default: false }, 'run-tests': { type: 'boolean', default: false },
  ci: { type: 'boolean', default: false },
}, strict: true });
const usage = 'Usage: context-verify.mjs [--root <directory>] [--path <context-file>] [--all] [--run-tests] [--ci]';
if (values.help) { console.log(usage); process.exit(0); }
const repoRoot = path.resolve(values.root);

function isGitRepository() {
  try {
    return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() === 'true';
  } catch {
    return false;
  }
}

const gitRepository = isGitRepository();

function discover() {
  const result = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.changes') continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(candidate);
      else if (entry.name === 'CONTEXT.md') result.push(candidate);
    }
  }
  walk(repoRoot);
  return result;
}

function runGit(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function inScope(file, contextPath) {
  const scope = path.dirname(path.relative(repoRoot, contextPath));
  return scope === '' || scope === '.' || file === scope || file.startsWith(`${scope}/`);
}

function footerOnlyUpdate(contextPath, relPath, content, stamp) {
  if (!gitRepository || stamp !== runGit(['rev-parse', 'HEAD'])) return false;
  try {
    const committed = runGit(['show', `HEAD:${relPath}`]);
    const withoutFooter = value => value.replace(/^Provenance:\s*validated-at:\s*.+\s*$/im, '').trimEnd();
    return withoutFooter(committed) === withoutFooter(content);
  } catch {
    return false;
  }
}

function parseFirmSeams(content) {
  const seams = [];
  const authored = content.replace(/<!--[\s\S]*?-->/g, '');
  const blocks = [...authored.matchAll(/^###\s+Seam:[^\n]*\[firmness:\s*firm\][\s\S]*?(?=^###\s+Seam:|^##\s+|$(?![\s\S]))/gim)];
  for (const match of blocks) {
    const block = match[0];
    const id = block.match(/\[SEAM-([^\]]+)\]/i)?.[1];
    if (!id) continue;
    const seamId = `SEAM-${id}`;
    const citations = [...block.matchAll(new RegExp(`\\[${seamId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\][^→\\n]*(?:→|->)\\s*enforced-by:\\s*([^;\\n]+?)\\s*;\\s*command:\\s*(.+)$`, 'gim'))]
      .map(citation => ({ testPath: citation[1].trim(), command: citation[2].trim() }));
    seams.push({ seamId, criteria: [...block.matchAll(/\[AC-[A-Za-z0-9][A-Za-z0-9-]*\]/g)].length, citations });
  }
  return seams;
}

function validRootPath(candidate) {
  return Boolean(candidate) && !path.isAbsolute(candidate) && !candidate.split('/').includes('..') && !candidate.split('\\').includes('..');
}

const contextFiles = values.path
  ? [path.resolve(repoRoot, values.path)]
  : values.all ? discover() : [path.join(repoRoot, 'CONTEXT.md')];
const results = [];
let invalid = false;
let stale = false;
let firmFailure = false;

for (const contextPath of contextFiles) {
  const relPath = path.relative(repoRoot, contextPath);
  if (!fs.existsSync(contextPath)) {
    results.push({ path: relPath, valid: false, error: 'CONTEXT.md not found', isStale: true, firmSeamResults: [] });
    invalid = true;
    continue;
  }

  const content = fs.readFileSync(contextPath, 'utf8');
  const footers = [...content.matchAll(/^Provenance:\s*validated-at:\s*(.+)\s*$/gim)];
  const finalFooter = footers.length === 1 && content.trimEnd().endsWith(footers[0]?.[0].trim());
  const stamp = footers[0]?.[1]?.trim() || null;
  const sha = /^[a-f0-9]{40}$/i.test(stamp || '') ? stamp : null;
  const untracked = stamp === '<not-in-git-repo>' && !gitRepository;
  let provenanceValid = finalFooter && Boolean(sha || untracked);
  let changedFiles = [];

  if (sha && gitRepository) {
    try {
      runGit(['cat-file', '-e', `${sha}^{commit}`]);
      const committed = runGit(['diff', '--name-only', `${sha}..HEAD`, '--', path.dirname(relPath) || '.']);
      const dirty = [
        runGit(['diff', '--name-only', '--', path.dirname(relPath) || '.']),
        runGit(['diff', '--cached', '--name-only', '--', path.dirname(relPath) || '.']),
        runGit(['ls-files', '--others', '--exclude-standard', '--', path.dirname(relPath) || '.']),
      ].flatMap(output => output ? output.split('\n') : []);
      changedFiles = [...new Set([...(committed ? committed.split('\n') : []), ...dirty])]
        .filter(file => inScope(file, contextPath) && file !== '.changes' && !file.startsWith('.changes/'))
        // A full HEAD stamp necessarily changes after the reconciliation commit.
        // Permit that footer-only unstaged update, but no other context drift.
        .filter(file => file !== relPath || !footerOnlyUpdate(contextPath, relPath, content, sha));
    } catch {
      provenanceValid = false;
    }
  } else if (sha || (stamp === '<not-in-git-repo>' && gitRepository)) {
    provenanceValid = false;
  }

  const parsedSeams = parseFirmSeams(content);
  const structureErrors = [];
  const firmSeamResults = [];
  for (const seam of parsedSeams) {
    if (seam.criteria === 0) structureErrors.push(`${seam.seamId} has no acceptance criterion`);
    if (seam.citations.length === 0) structureErrors.push(`${seam.seamId} has no executable enforcing test`);
    for (const citation of seam.citations) {
      const testPath = citation.testPath;
      const absolutePath = validRootPath(testPath) ? path.resolve(repoRoot, testPath) : null;
      const exists = Boolean(absolutePath && fs.existsSync(absolutePath));
      const marker = exists && fs.readFileSync(absolutePath, 'utf8').includes(`[${seam.seamId}]`);
      const result = { seamId: seam.seamId, testPath, command: citation.command, exists, marker, passed: null };
      if (!exists) result.note = 'test file not found at repository-root-relative path';
      else if (!marker) result.note = 'test file does not contain the cited seam marker';
      firmSeamResults.push(result);
    }
  }
  if (structureErrors.length > 0 || firmSeamResults.some(result => !result.exists || !result.marker)) {
    invalid = true;
    firmFailure = true;
    firmSeamResults.filter(result => !result.exists || !result.marker).forEach(result => { result.passed = false; });
  }
  if ((values['run-tests'] || values.ci) && firmSeamResults.length > 0 && !firmFailure) {
    for (const result of firmSeamResults) {
      try {
        execSync(result.command, { cwd: repoRoot, stdio: 'pipe' });
        result.passed = true;
      } catch (error) {
        result.passed = false;
        result.note = String(error.message);
        firmFailure = true;
      }
    }
  }
  const isStale = !provenanceValid || changedFiles.length > 0;
  // A non-Git marker becomes stale after Git initialization, but remains a
  // migration warning rather than malformed provenance.
  if (!provenanceValid && !(stamp === '<not-in-git-repo>' && gitRepository)) invalid = true;
  if (isStale) stale = true;
  results.push({ path: relPath, sha, provenance: untracked ? 'untracked' : sha ? 'git' : null, provenanceValid, isStale, changedFiles, firmSeams: parsedSeams.length, firmSeamResults, structureErrors });
}

process.stdout.write(JSON.stringify(results) + '\n');
if (firmFailure || invalid) process.exit(1);
if (stale) process.exit(2);
