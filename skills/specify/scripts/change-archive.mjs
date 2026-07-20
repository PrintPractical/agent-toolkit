#!/usr/bin/env node
/**
 * change-archive.mjs — Zip a completed change and remove the active directory.
 *
 * Usage: node change-archive.mjs --id <change-id>
 *
 * Precondition: manifest.gates.docs must be 'approved'.
 * Output (stdout): JSON { id, archive }
 * Progress (stderr): human-readable status
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { parseArgs } from 'util';
import {
  readManifest,
  writeManifest,
  activeDir,
  archiveDir,
  changeDir,
} from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    help:  { type: 'boolean', short: 'h', default: false },
    id:    { type: 'string' },
    force: { type: 'boolean', default: false }, // bypass docs gate check (emergency use)
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: change-archive.mjs --id <change-id> [--force]');
  process.exit(0);
}

if (!values.id) {
  console.error('Usage: change-archive.mjs --id <change-id> [--force]');
  process.exit(1);
}

const repoRoot = process.cwd();
const id = values.id;

let manifest;
try {
  manifest = readManifest(id, repoRoot);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}

if (!values.force && manifest.gates?.docs !== 'approved') {
  console.error(`Error: docs gate is not approved for change '${id}'.`);
  console.error('Approve the docs gate first (run verify + reconcile CONTEXT.md files), then archive.');
  console.error('Use --force to bypass (not recommended).');
  process.exit(1);
}

const srcDir = changeDir(id, repoRoot);
const archDir = archiveDir(repoRoot);
const zipPath = path.join(archDir, `${id}.zip`);

fs.mkdirSync(archDir, { recursive: true });

console.error(`Archiving change: ${id}`);
console.error(`  Source:  ${srcDir}`);
console.error(`  Archive: ${zipPath}`);

// Update manifest stage before zipping
manifest.stage = 'done';
writeManifest(id, manifest, repoRoot);

try {
  // Use system zip (available on macOS/Linux); fallback message for Windows
  execSync(`zip -r "${zipPath}" .`, { cwd: srcDir, stdio: ['pipe', 'pipe', 'pipe'] });
} catch (e) {
  console.error(`Error: zip failed: ${e.message}`);
  console.error('Ensure zip is installed (macOS/Linux: built-in; Windows: use WSL or install zip).');
  process.exit(1);
}

console.error(`Zip created: ${zipPath}`);

// Remove active directory
fs.rmSync(srcDir, { recursive: true, force: true });
console.error(`Active directory removed: ${srcDir}`);
console.error(`Change '${id}' archived successfully.`);

process.stdout.write(JSON.stringify({ id, archive: zipPath }) + '\n');
