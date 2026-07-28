#!/usr/bin/env node
/**
 * change-status.mjs — Print current stage and recommended next skill for active changes.
 *
 * Usage:
 *   node change-status.mjs                    # list all active changes
 *   node change-status.mjs --id <change-id>   # status for a specific change
 *
 * Output (stdout): JSON array of change status objects
 * Progress (stderr): human-readable table
 */

import { parseArgs } from 'util';
import {
  listActiveChanges,
  readManifest,
  nextSkill,
  epicStatus,
} from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h', default: false },
    id:   { type: 'string' },
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: change-status.mjs [--id <change-id>]');
  process.exit(0);
}

const repoRoot = process.cwd();

const ids = values.id
  ? [values.id]
  : listActiveChanges(repoRoot);

if (ids.length === 0) {
  console.error('No active changes found in .changes/active/');
  process.stdout.write(JSON.stringify([]) + '\n');
  process.exit(0);
}

const results = [];

for (const id of ids) {
  let manifest;
  try {
    manifest = readManifest(id, repoRoot);
  } catch (e) {
    console.error(`Warning: could not read manifest for ${id}: ${e.message}`);
    continue;
  }

  const skill = nextSkill(manifest);
  const defectKickbacks = (manifest.kickbacks || []).filter(k => k.type === 'defect').length;
  const totalKickbacks = (manifest.kickbacks || []).length;
  const isEpic = manifest.class === 'epic';

  const status = {
    id,
    title: manifest.title,
    class: manifest.class,
    stage: manifest.stage,
    language: manifest.language || null,
    gates: manifest.gates,
    next_skill: skill,
    kickbacks: { defect: defectKickbacks, amendment: totalKickbacks - defectKickbacks, total: totalKickbacks },
    ...(manifest.parent ? { parent: manifest.parent } : {}),
    ...(isEpic ? { epic_status: epicStatus(manifest, repoRoot) } : {}),
  };

  results.push(status);

  // Human-readable stderr output
  console.error(`\n── ${id} ──`);
  console.error(`  Title:      ${manifest.title}`);
  console.error(`  Class:      ${manifest.class}`);
  if (manifest.parent) console.error(`  Parent:     ${manifest.parent}`);
  console.error(`  Stage:      ${manifest.stage}`);
  if (manifest.language) console.error(`  Language:   ${manifest.language}`);

  if (isEpic) {
    const es = status.epic_status;
    const children = manifest.children || [];
    console.error(`  Children:   ${children.length} total — ${es.done} done, ${es.inProgress} in-progress, ${es.pending} pending`);
    if (children.length > 0) {
      // Show each child's stage
      for (const childId of children) {
        let childStage = 'archived';
        try {
          const child = readManifest(childId, repoRoot);
          childStage = child.stage;
        } catch { /* archived */ }
        console.error(`    • ${childId} [${childStage}]`);
      }
    }
    if (es.done === children.length && children.length > 0) {
      console.error(`  Status:     ALL CHILDREN DONE — epic complete`);
    } else if (skill) {
      console.error(`  Next:       ${skill}`);
    }
  } else {
    console.error(`  Gates:      ${Object.entries(manifest.gates || {}).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    if (skill) {
      console.error(`  Next skill: ${skill}`);
    } else {
      console.error(`  Status:     done`);
    }
  }

  if (totalKickbacks > 0) {
    console.error(`  Kickbacks:  ${defectKickbacks} defect, ${totalKickbacks - defectKickbacks} amendment`);
  }
}

process.stdout.write(JSON.stringify(results) + '\n');
