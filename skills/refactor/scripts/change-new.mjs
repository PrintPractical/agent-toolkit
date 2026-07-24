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
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: change-new.mjs --title "<title>" [--class feature|bug|small|epic|refactor] [--language <idiom-pack-id>] [--parent <epic-id>]');
  process.exit(0);
}

if (!values.title) {
  console.error('Usage: change-new.mjs --title "<title>" [--class feature|bug|small|epic|refactor] [--language <idiom-pack-id>] [--parent <epic-id>]');
  process.exit(1);
}

const validClasses = ['feature', 'bug', 'small', 'epic', 'refactor'];
if (!validClasses.includes(values.class)) {
  console.error(`Invalid class: ${values.class}. Must be one of: ${validClasses.join(', ')}`);
  process.exit(1);
}

// Maintenance refactors and nested epics are never epic children.
if (values.parent && ['epic', 'refactor'].includes(values.class)) {
  console.error('Error: epic children must use class feature, bug, or small.');
  process.exit(1);
}

const repoRoot = process.cwd();

// Validate parent exists and is an epic
if (values.parent) {
  try {
    const parentManifest = readManifest(values.parent, repoRoot);
    if (parentManifest.class !== 'epic') {
      console.error(`Error: parent '${values.parent}' is not an epic (class: ${parentManifest.class}). Only epics can have children.`);
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

const isRefactor = values.class === 'refactor';
const isTriage = ['bug', 'small'].includes(values.class) && !values.parent;

// Epics and maintenance refactors have dedicated lifecycles. Standalone bug
// and small changes enter triage's abbreviated implementation flow directly.
const gates = values.class === 'epic'
  ? { architect: 'pending', specify: 'pending' }
  : isRefactor
    ? { refactor: 'pending', implement: 'pending', docs: 'pending' }
    : isTriage
      ? { architect: 'approved', specify: 'approved', plan: 'approved', implement: 'pending', docs: 'pending' }
      : { architect: 'pending', specify: 'pending', plan: 'pending', implement: 'pending', docs: 'pending' };

const artifacts = isRefactor
  ? { refactor: 'refactor.md', implementation_units: 'implementation-units.json', implementation_state: 'implementation-state.json', reviews: 'reviews/' }
  : { architecture: 'architecture.md', decisions: 'decisions.md', plan: 'plan.md' };

const manifest = {
  id,
  title: values.title,
  class: values.class,
  stage: isRefactor ? 'refactor' : isTriage ? 'implement' : 'architect',
  language: values.language,
  ...(values.parent ? { parent: values.parent } : {}),
  ...(values.class === 'epic' ? { children: [] } : {}),
  gates,
  artifacts,
  context_targets: ['CONTEXT.md'],
  checkpoint_epoch: 0,
  kickbacks: [],
};

writeManifest(id, manifest, repoRoot);
console.error(`Manifest written: ${path.join(dir, 'manifest.yaml')}`);

// Link child to parent epic
if (values.parent) {
  addChildToEpic(values.parent, id, repoRoot);
  console.error(`Linked as child of epic: ${values.parent}`);
  console.error(`Stage: architect — run the 'architect' skill next (child change)`);
} else if (values.class === 'epic') {
  console.error(`Stage: architect — run the 'architect' skill next`);
  console.error(`  Epic flow: architect → specify → (auto-decompose into children)`);
} else if (isRefactor) {
  console.error(`Stage: refactor — run the 'refactor' skill to audit and select opportunities`);
} else if (isTriage) {
  console.error(`Stage: implement — continue the abbreviated 'triage' workflow`);
} else {
  console.error(`Stage: architect — run the 'architect' skill next`);
}

// Write to stdout as JSON for agent consumption
process.stdout.write(JSON.stringify({ id, dir, ...(values.parent ? { parent: values.parent } : {}) }) + '\n');
