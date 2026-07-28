#!/usr/bin/env node
/**
 * context-discover.mjs — Build a tree of all CONTEXT.md files in a repo.
 *
 * Usage:
 *   node context-discover.mjs [--root <dir>]
 *
 * Walks the directory tree and finds all CONTEXT.md files.
 * Skips .changes/, node_modules/, .git/, and any path matching --ignore.
 *
 * Output (stdout): JSON array of { path, relativePath, isRoot, hasProvenance, sha }
 * Progress (stderr): count summary
 */

import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';

const { values } = parseArgs({
  options: {
    help:   { type: 'boolean', short: 'h', default: false },
    root:   { type: 'string', default: process.cwd() },
    ignore: { type: 'string', default: '' }, // comma-separated additional dirs to skip
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: context-discover.mjs [--root <directory>] [--ignore <dir,dir,...>]');
  process.exit(0);
}

const repoRoot = path.resolve(values.root);
const ignoreDirs = new Set([
  '.git', 'node_modules', '.changes', 'target', 'dist', 'build', '.next', '.cache',
  ...( values.ignore ? values.ignore.split(',').map(s => s.trim()) : []),
]);

const results = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // permission error or broken symlink
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoreDirs.has(entry.name)) {
        walk(path.join(dir, entry.name));
      }
    } else if (entry.isFile() && entry.name === 'CONTEXT.md') {
      const filePath = path.join(dir, 'CONTEXT.md');
      const relativePath = path.relative(repoRoot, filePath);
      const content = fs.readFileSync(filePath, 'utf8');

      // Extract provenance SHA
      const provMatch = content.match(/Provenance:\s*validated-at:\s*([a-f0-9]{7,40})/i);
      const sha = provMatch ? provMatch[1] : null;

      // Root = lives at repo root
      const isRoot = dir === repoRoot;

      // Extract firm seam IDs + enforced-by citations
      const seamPattern = /\[SEAM-([^\]]+)\][^→]*→\s*enforced-by:\s*([^\n]+)/g;
      const firmSeams = [];
      let match;
      while ((match = seamPattern.exec(content)) !== null) {
        firmSeams.push({ id: `SEAM-${match[1]}`, test: match[2].trim() });
      }

      results.push({
        path: filePath,
        relativePath,
        isRoot,
        hasProvenance: !!sha,
        sha,
        firmSeams,
      });
    }
  }
}

walk(repoRoot);

console.error(`Found ${results.length} CONTEXT.md file(s) in ${repoRoot}`);
if (results.length > 0) {
  const withProv = results.filter(r => r.hasProvenance).length;
  const withFirm = results.filter(r => r.firmSeams.length > 0).length;
  console.error(`  With provenance: ${withProv}`);
  console.error(`  With firm seams: ${withFirm}`);
}

process.stdout.write(JSON.stringify(results) + '\n');
