#!/usr/bin/env node
/**
 * change-new.mjs — Create a new active change workspace.
 *
 * Usage:
 *   node change-new.mjs --title "Add rate limiter" [--class feature] [--language rust]
 *   node change-new.mjs --title "Child task" --parent <epic-id> [--language rust]
 *
 * When --parent is provided, the new change is linked as a child of the epic
 * and the epic's children list is updated.
 *
 * Output (stdout): JSON { id, dir, parent? }
 * Progress (stderr): human-readable status lines
 */

import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import {
  generateChangeId,
  changeDir,
  writeManifest,
  readManifest,
  addChildToEpic,
} from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    help:     { type: 'boolean', short: 'h', default: false },
    title:    { type: 'string' },
    class:    { type: 'string', default: 'feature' },
    language: { type: 'string', default: '' },
    parent:   { type: 'string', default: '' },  // epic change ID
    mode:     { type: 'string', default: 'execute' }, // refactor: execute | audit-only
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: change-new.mjs --title "<title>" [--class feature|bug|small|epic|refactor] [--language <idiom-pack-id>] [--parent <epic-id>] [--mode execute|audit-only]');
  process.exit(0);
}

if (!values.title) {
  console.error('Usage: change-new.mjs --title "<title>" [--class feature|bug|small|epic|refactor] [--language <idiom-pack-id>] [--parent <epic-id>] [--mode execute|audit-only]');
  process.exit(1);
}

const validClasses = ['feature', 'bug', 'small', 'epic', 'refactor'];
if (!validClasses.includes(values.class)) {
  console.error(`Invalid class: ${values.class}. Must be one of: ${validClasses.join(', ')}`);
  process.exit(1);
}

// Children of an epic must be feature/bug/small, not another epic or a refactor
if (values.parent && (values.class === 'epic' || values.class === 'refactor')) {
  console.error(`Error: a ${values.class} cannot be a child of an epic. Use class feature, bug, or small.`);
  process.exit(1);
}

if (values.class === 'refactor' && !['execute', 'audit-only'].includes(values.mode)) {
  console.error(`Invalid --mode: ${values.mode}. Must be execute or audit-only.`);
  process.exit(1);
}

const repoRoot = process.cwd();

// Validate parent before creating anything so rejected requests leave no orphan.
if (values.parent) {
  try {
    const parentManifest = readManifest(values.parent, repoRoot);
    if (parentManifest.class !== 'epic') {
      console.error(`Error: parent '${values.parent}' is not an epic (class: ${parentManifest.class}). Only epics can have children.`);
      process.exit(1);
    }
    if (parentManifest.phase !== 'specify' || parentManifest.approvals?.architect !== 'approved' || parentManifest.approvals?.specify !== 'approved') {
      console.error(`Error: parent '${values.parent}' must have approved architect and specify approvals before a child can be created.`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`Error: parent manifest not found: ${e.message}`);
    process.exit(1);
  }
}

const id = generateChangeId(values.title, repoRoot);
const dir = changeDir(id, repoRoot);

console.error(`Creating change: ${id}`);
fs.mkdirSync(dir, { recursive: true });

// Epics only use architect + specify + coordinated docs approvals.
// Refactors skip the spec spine: refactor (audit + selection) → implement → docs.
const approvals = values.class === 'epic'
  ? { architect: 'pending', specify: 'pending', docs: 'pending' }
  : values.class === 'refactor'
  ? values.mode === 'audit-only'
    ? { refactor: 'pending' }
    : { refactor: 'pending', implement: 'pending', docs: 'pending' }
  : ['bug', 'small'].includes(values.class)
  ? { implement: 'pending', docs: 'pending' }
  : { architect: 'pending', specify: 'pending', plan: 'pending', implement: 'pending', docs: 'pending' };

const isRefactor = values.class === 'refactor';

const manifest = {
  id,
  title: values.title,
  class: values.class,
  phase: isRefactor ? 'refactor' : ['bug', 'small'].includes(values.class) ? 'implement' : 'architect',
  language: values.language,
  ...(values.parent ? { parent: values.parent } : {}),
  ...(values.class === 'epic' ? { children: [] } : {}),
  ...(isRefactor ? { refactor_mode: values.mode, refactor_selected_ids: [] } : {}),
  approvals,
  artifacts: isRefactor
    ? { change_brief: 'change-brief.md', refactor: 'refactor.md' }
    : {
        change_brief: 'change-brief.md',
        architecture: 'architecture.md',
        decisions:    'decisions.md',
        plan:         'plan.md',
      },
  context_targets: ['CONTEXT.md'],
  kickbacks: [],
  review_epochs: {},
};

writeManifest(id, manifest, repoRoot);
console.error(`Manifest written: ${path.join(dir, 'manifest.yaml')}`);

// Link child to parent epic
if (values.parent) {
  addChildToEpic(values.parent, id, repoRoot);
  console.error(`Linked as child of epic: ${values.parent}`);
  console.error(`Phase: ${manifest.phase} — run the '${manifest.phase === 'implement' ? 'triage' : 'architect'}' skill next (child change)`);
} else if (values.class === 'epic') {
  console.error(`Phase: architect — run the 'architect' skill next`);
  console.error(`  Epic flow: architect → specify → (auto-decompose into children)`);
} else if (isRefactor) {
  console.error(`Phase: refactor — run the 'refactor' skill next`);
  console.error(`  Refactor flow: refactor (audit + selection) → implement (execute + review) → docs`);
} else {
  console.error(`Phase: ${manifest.phase} — run the '${manifest.phase === 'implement' ? 'triage' : 'architect'}' skill next`);
}

// Write to stdout as JSON for agent consumption
process.stdout.write(JSON.stringify({ id, dir, ...(values.parent ? { parent: values.parent } : {}) }) + '\n');
