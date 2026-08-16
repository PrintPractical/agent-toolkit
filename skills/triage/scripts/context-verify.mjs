#!/usr/bin/env node
/** Verify CONTEXT provenance, drift, and cited firm seams. */

import fs from 'fs';
import path from 'path';
import { execFileSync, execSync } from 'child_process';
import { parseArgs } from 'util';

const { values } = parseArgs({ options: {
  help: { type: 'boolean', short: 'h', default: false }, root: { type: 'string', default: process.cwd() },
  path: { type: 'string' }, all: { type: 'boolean', default: false }, 'run-tests': { type: 'boolean', default: false },
  ci: { type: 'boolean', default: false }, 'test-command': { type: 'string' },
}, strict: true });
const usage = 'Usage: context-verify.mjs [--root <directory>] [--path <context-file>] [--all] [--run-tests] [--ci] [--test-command <command>]';
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

let contextFiles;
if (values.path) contextFiles = [path.resolve(repoRoot, values.path)];
else if (values.all) contextFiles = discover();
else contextFiles = [path.join(repoRoot, 'CONTEXT.md')];
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
  const provenance = content.match(/Provenance:\s*validated-at:\s*(?:([a-f0-9]{7,40})|(<not-in-git-repo>))/i);
  const sha = provenance?.[1] || null;
  const untracked = Boolean(provenance?.[2]);
  let provenanceValid = Boolean(sha || untracked);
  let changedFiles = [];
  if (sha) {
    try {
      execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: repoRoot, stdio: 'pipe' });
      const output = execFileSync('git', ['diff', '--name-only', `${sha}..HEAD`, '--', path.dirname(relPath) || '.'], { cwd: repoRoot, encoding: 'utf8' }).trim();
      changedFiles = output ? output.split('\n') : [];
    } catch {
      provenanceValid = false;
    }
  }
  const isStale = !provenanceValid || changedFiles.length > 0 || (untracked && gitRepository);
  if (!provenanceValid) invalid = true;
  if (isStale) stale = true;
  const authoredContent = content.replace(/<!--[\s\S]*?-->/g, '');
  const firmSeams = [...authoredContent.matchAll(/\[SEAM-([^\]]+)\][^→\n]*(?:→|->)\s*enforced-by:\s*([^\n]+)/gi)]
    .map(match => ({ id: `SEAM-${match[1]}`, testPath: match[2].trim() }));
  const firmSeamResults = firmSeams.map(seam => ({
    seamId: seam.id,
    testPath: seam.testPath,
    exists: fs.existsSync(path.resolve(repoRoot, seam.testPath)) || fs.existsSync(path.resolve(path.dirname(contextPath), seam.testPath)),
    passed: null,
  }));
  if (firmSeamResults.some(result => !result.exists)) {
    firmFailure = true;
    firmSeamResults.filter(result => !result.exists).forEach(result => { result.passed = false; result.note = 'test file not found'; });
  }
  if ((values['run-tests'] || values.ci) && firmSeams.length > 0 && !firmFailure) {
    const command = values['test-command'] || process.env.AGENT_TOOLKIT_FIRM_TEST_COMMAND || 'npm test';
    try {
      execSync(command, { cwd: repoRoot, stdio: 'pipe' });
      firmSeamResults.forEach(result => { result.passed = true; result.command = command; });
    } catch (error) {
      firmFailure = true;
      firmSeamResults.forEach(result => { result.passed = false; result.command = command; result.note = String(error.message); });
    }
  }
  results.push({ path: relPath, sha, provenance: untracked ? 'untracked' : sha ? 'git' : null, provenanceValid, isStale, changedFiles, firmSeams: firmSeams.length, firmSeamResults });
}
process.stdout.write(JSON.stringify(results) + '\n');
if (firmFailure || invalid) process.exit(1);
if (stale) process.exit(2);
