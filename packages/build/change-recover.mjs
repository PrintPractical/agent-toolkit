#!/usr/bin/env node
/** Recover interrupted archive staging directories without guessing lifecycle state. */

import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import { activeDir, archiveDir } from './lib/index.mjs';

const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h', default: false }, id: { type: 'string' } }, strict: true });
if (values.help) { console.log('Usage: change-recover.mjs --id <change-id>'); process.exit(0); }
if (!values.id) { console.error('Usage: change-recover.mjs --id <change-id>'); process.exit(1); }
const repoRoot = process.cwd();
const staged = path.join(activeDir(repoRoot), `.${values.id}.archiving`);
const active = path.join(activeDir(repoRoot), values.id);
const archive = path.join(archiveDir(repoRoot), `${values.id}.zip`);
if (!fs.existsSync(staged)) { console.error(`No interrupted archive staging directory for '${values.id}'.`); process.exit(1); }
if (fs.existsSync(archive)) {
  fs.rmSync(staged, { recursive: true });
  process.stdout.write(JSON.stringify({ id: values.id, recovered: 'removed-published-staging' }) + '\n');
} else if (!fs.existsSync(active)) {
  fs.renameSync(staged, active);
  process.stdout.write(JSON.stringify({ id: values.id, recovered: 'restored-active-workspace' }) + '\n');
} else {
  console.error(`Both staged and active workspaces exist for '${values.id}'; resolve manually.`); process.exit(1);
}
