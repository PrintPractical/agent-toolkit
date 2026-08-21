#!/usr/bin/env node
/**
 * change-status.mjs — Print current phase and recommended next skill for active changes.
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
  validateManifestState,
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
    console.error(`Error: could not read manifest for ${id}: ${e.message}`);
    if (values.id) process.exit(1);
    continue;
  }

  const stateErrors = validateManifestState(manifest);

  const skill = stateErrors.length === 0 ? nextSkill(manifest, repoRoot) : null;
  const defectKickbacks = (manifest.kickbacks || []).filter(k => k.type === 'defect').length;
  const totalKickbacks = (manifest.kickbacks || []).length;
  const unresolvedKickback = [...(manifest.kickbacks || [])].reverse().find(k => !k.resolution);
  const isEpic = manifest.class === 'epic';

  const status = {
    id,
    title: manifest.title,
    class: manifest.class,
    phase: manifest.phase,
    language: manifest.language || null,
    approvals: manifest.approvals,
    next_skill: skill,
    ...(stateErrors.length ? { state_errors: stateErrors } : {}),
    kickbacks: { defect: defectKickbacks, amendment: totalKickbacks - defectKickbacks, total: totalKickbacks },
    ...(unresolvedKickback ? { unresolved_kickback: unresolvedKickback } : {}),
    ...(manifest.parent ? { parent: manifest.parent } : {}),
    ...(isEpic ? { epic_status: epicStatus(manifest, repoRoot) } : {}),
  };

  results.push(status);

  // Human-readable stderr output
  console.error(`\n── ${id} ──`);
  console.error(`  Title:      ${manifest.title}`);
  console.error(`  Class:      ${manifest.class}`);
  if (manifest.parent) console.error(`  Parent:     ${manifest.parent}`);
  console.error(`  Phase:      ${manifest.phase}`);
  if (manifest.language) console.error(`  Language:   ${manifest.language}`);

  if (isEpic) {
    const es = status.epic_status;
    const children = manifest.children || [];
    console.error(`  Children:   ${children.length} total — ${es.ready} archive-ready, ${es.archived} archived, ${es.inProgress} in-progress, ${es.pending} pending, ${es.missing} missing`);
    if (children.length > 0) {
      // Show each child's phase
      for (const childId of children) {
        let childPhase = 'missing';
        try {
          const child = readManifest(childId, repoRoot);
          childPhase = child.phase;
        } catch { /* status includes verified archives separately */ }
        console.error(`    • ${childId} [${childPhase}]`);
      }
    }
    if (es.ready === children.length && children.length > 0) {
      console.error(`  Status:     ALL CHILDREN ARCHIVE-READY — reconcile epic docs`);
    } else if (skill) {
      console.error(`  Next:       ${skill}`);
    }
  } else {
    console.error(`  Approvals:  ${Object.entries(manifest.approvals || {}).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    if (skill) {
      console.error(`  Next skill: ${skill}`);
    } else {
      console.error(`  Status:     awaiting lifecycle repair`);
    }
  }

  if (totalKickbacks > 0) {
    console.error(`  Kickbacks:  ${defectKickbacks} defect, ${totalKickbacks - defectKickbacks} amendment`);
  }
  if (unresolvedKickback) {
    const invalidated = Array.isArray(unresolvedKickback.invalidated_approvals)
      ? unresolvedKickback.invalidated_approvals
      : (unresolvedKickback.invalidated_approvals || 'specify,plan').split(',');
    console.error(`  Restart:    ${unresolvedKickback.restart_phase || 'specify'} (${invalidated.join(', ')})`);
  }
  if (stateErrors.length) console.error(`  Invalid:    ${stateErrors.join('; ')}`);
}

process.stdout.write(JSON.stringify(results) + '\n');
