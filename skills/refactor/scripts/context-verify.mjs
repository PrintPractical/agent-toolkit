#!/usr/bin/env node
/**
 * context-verify.mjs — Detect drift between CONTEXT.md files and code.
 *
 * Usage:
 *   node context-verify.mjs [--root <dir>] [--path <context-file>] [--all] [--run-tests]
 *
 * For each CONTEXT.md:
 *   1. Read provenance SHA
 *   2. Find files changed since that SHA in the component directory
 *   3. Run firm-seam tests (if --run-tests)
 *   4. Emit drift report
 *
 * Output (stdout): JSON array of DriftResult
 * Progress (stderr): human-readable report
 *
 * Exit codes:
 *   0 — no firm-seam failures
 *   1 — at least one firm-seam test failed (hard block)
 *   2 — stale only (warning; not a hard block)
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { parseArgs } from 'util';
import { getChangedFilesSince } from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    help:       { type: 'boolean', short: 'h', default: false },
    root:       { type: 'string', default: process.cwd() },
    path:       { type: 'string' }, // single CONTEXT.md path
    all:        { type: 'boolean', default: false },
    'run-tests': { type: 'boolean', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: context-verify.mjs [--root <directory>] [--path <context-file>] [--all] [--run-tests]');
  process.exit(0);
}

const repoRoot = path.resolve(values.root);

// Collect CONTEXT.md files to verify
let contextFiles = [];

if (values.path) {
  contextFiles = [path.resolve(values.path)];
} else if (values.all) {
  // Use context-discover output
  const discoverScript = path.join(path.dirname(new URL(import.meta.url).pathname), 'context-discover.mjs');
  try {
    const output = execSync(`node "${discoverScript}" --root "${repoRoot}"`, {
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    const discovered = JSON.parse(output);
    contextFiles = discovered.map(d => d.path);
  } catch (e) {
    console.error(`Error running context-discover: ${e.message}`);
    process.exit(1);
  }
} else {
  // Default: CONTEXT.md in cwd
  const defaultPath = path.join(repoRoot, 'CONTEXT.md');
  if (!fs.existsSync(defaultPath)) {
    console.error('No CONTEXT.md found. Use --all to verify all files or --path to specify one.');
    process.stdout.write(JSON.stringify([]) + '\n');
    process.exit(0);
  }
  contextFiles = [defaultPath];
}

const results = [];
let hasFirmFailure = false;
let hasStaleOnly = false;

for (const contextPath of contextFiles) {
  if (!fs.existsSync(contextPath)) {
    console.error(`Warning: CONTEXT.md not found: ${contextPath}`);
    continue;
  }

  const content = fs.readFileSync(contextPath, 'utf8');
  const componentDir = path.dirname(contextPath);
  const relPath = path.relative(repoRoot, contextPath);

  // Extract provenance SHA
  const provMatch = content.match(/Provenance:\s*validated-at:\s*([a-f0-9]{7,40})/i);
  const sha = provMatch ? provMatch[1] : null;

  // Detect staleness
  let changedFiles = [];
  let isStale = false;
  if (sha) {
    changedFiles = getChangedFilesSince(sha, componentDir, repoRoot);
    isStale = changedFiles.length > 0;
  }

  // Extract firm seam test citations
  const seamPattern = /\[SEAM-([^\]]+)\][^→\n]*(?:→|->)\s*enforced-by:\s*([^\n]+)/gi;
  const firmSeams = [];
  let match;
  while ((match = seamPattern.exec(content)) !== null) {
    firmSeams.push({ id: `SEAM-${match[1]}`, testPath: match[2].trim() });
  }

  // Run firm-seam tests if requested
  const firmSeamResults = [];
  if (values['run-tests'] && firmSeams.length > 0) {
    for (const seam of firmSeams) {
      // The test path from CONTEXT.md — agent/user writes these;
      // we attempt to run them as a best-effort check.
      // Language-agnostic: we just check if the file exists. Full execution
      // requires the project's test runner, which is out of scope here.
      const testPath = path.resolve(componentDir, seam.testPath);
      const exists = fs.existsSync(testPath);
      firmSeamResults.push({
        seamId: seam.id,
        testPath: seam.testPath,
        exists,
        passed: exists ? null : false, // null = exists but not run; false = missing
        note: exists ? 'file exists (run project test suite to verify)' : 'test file not found',
      });
      if (!exists) hasFirmFailure = true;
    }
  }

  const result = {
    path: relPath,
    sha,
    isStale,
    changedFiles,
    firmSeams: firmSeams.length,
    firmSeamResults,
  };

  results.push(result);

  // Human-readable output
  console.error(`\n── ${relPath} ──`);
  if (!sha) {
    console.error('  Provenance: MISSING (no validated-at SHA)');
  } else {
    console.error(`  Provenance: ${sha}`);
  }
  if (isStale) {
    hasStaleOnly = true;
    console.error(`  Status:     STALE (${changedFiles.length} file(s) changed since stamp)`);
    changedFiles.forEach(f => console.error(`    - ${f}`));
  } else {
    console.error('  Status:     current');
  }
  if (firmSeams.length > 0) {
    console.error(`  Firm seams: ${firmSeams.length} with test citations`);
    if (values['run-tests']) {
      for (const r of firmSeamResults) {
        const icon = r.exists ? '✓' : '✗';
        console.error(`    ${icon} [${r.seamId}] → ${r.testPath} (${r.note})`);
      }
    }
  }
}

console.error(`\nSummary: ${results.length} file(s) checked`);
const staleCount = results.filter(r => r.isStale).length;
if (staleCount > 0) console.error(`  Stale: ${staleCount} (warning — run 'verify' skill to reconcile)`);
if (hasFirmFailure) console.error(`  Firm-seam test files missing: YES (hard block)`);

process.stdout.write(JSON.stringify(results) + '\n');

if (hasFirmFailure) process.exit(1);
if (hasStaleOnly && !hasFirmFailure) process.exit(2);
process.exit(0);
