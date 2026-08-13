#!/usr/bin/env node
/** Create a verified archive from archive-ready workspaces. */

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { parseArgs } from 'util';
import { readManifest, writeManifest, activeDir, archiveDir, changeDir, isArchiveReady } from './lib/index.mjs';

const { values } = parseArgs({ options: {
  help: { type: 'boolean', short: 'h', default: false }, id: { type: 'string' },
  cancel: { type: 'boolean', default: false }, reason: { type: 'string' },
}, strict: true });
const usage = 'Usage: change-archive.mjs --id <change-id> [--cancel --reason "<reason>"]';
if (values.help) { console.log(usage); process.exit(0); }
if (!values.id) { console.error(usage); process.exit(1); }
if (values.cancel && !values.reason?.trim()) { console.error('Cancellation requires --reason with a concrete explanation.'); process.exit(1); }
const repoRoot = process.cwd();
let manifest;
try { manifest = readManifest(values.id, repoRoot); } catch (error) { console.error(`Error: ${error.message}`); process.exit(1); }
if (values.cancel) {
  manifest.archive = { outcome: 'cancelled', reason: values.reason.trim(), at: new Date().toISOString() };
  manifest.phase = 'archive-ready';
  writeManifest(values.id, manifest, repoRoot);
}
if (manifest.phase !== 'archive-ready' || !isArchiveReady(manifest, repoRoot)) {
  console.error(`Error: change '${values.id}' is not eligible for archival. Reach archive-ready or use --cancel --reason.`); process.exit(1);
}
const ids = manifest.class === 'epic' ? [values.id, ...(manifest.children || [])] : [values.id];
if (manifest.class === 'epic') for (const childId of manifest.children || []) {
  let child;
  try { child = readManifest(childId, repoRoot); } catch (error) { console.error(`Error: child '${childId}' is unavailable: ${error.message}`); process.exit(1); }
  if (child.phase !== 'archive-ready' || !isArchiveReady(child, repoRoot)) { console.error(`Error: child '${childId}' is not archive-ready.`); process.exit(1); }
}
const destination = archiveDir(repoRoot);
fs.mkdirSync(destination, { recursive: true });
const staged = [];
try {
  for (const id of ids) {
    const finalPath = path.join(destination, `${id}.zip`);
    if (fs.existsSync(finalPath)) throw new Error(`archive already exists: ${finalPath}`);
    const source = changeDir(id, repoRoot);
    const workspace = path.join(activeDir(repoRoot), `.${id}.archiving`);
    if (fs.existsSync(workspace)) throw new Error(`recovery required for interrupted archive: ${workspace}`);
    fs.renameSync(source, workspace);
    const temporary = path.join(destination, `.${id}.${process.pid}.${Date.now()}.zip`);
    execFileSync('zip', ['-q', '-r', temporary, '.'], { cwd: workspace, stdio: 'pipe' });
    execFileSync('unzip', ['-tqq', temporary], { stdio: 'pipe' });
    staged.push({ id, source, workspace, temporary, finalPath });
  }
  for (const archive of staged) fs.renameSync(archive.temporary, archive.finalPath);
  for (const archive of staged) fs.rmSync(archive.workspace, { recursive: true });
} catch (error) {
  for (const archive of staged) {
    if (fs.existsSync(archive.temporary)) fs.rmSync(archive.temporary, { force: true });
    if (!fs.existsSync(archive.finalPath) && fs.existsSync(archive.workspace) && !fs.existsSync(archive.source)) fs.renameSync(archive.workspace, archive.source);
  }
  console.error(`Error: archive failed; run change-recover.mjs if an archiving workspace remains: ${error.message}`); process.exit(1);
}
console.error(`Archived ${ids.length} change workspace(s): ${ids.join(', ')}`);
process.stdout.write(JSON.stringify({ id: values.id, archives: staged.map(archive => archive.finalPath), outcome: manifest.archive?.outcome || 'completed' }) + '\n');
