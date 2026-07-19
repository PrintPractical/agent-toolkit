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
    title:    { type: 'string' },
    class:    { type: 'string', default: 'feature' },
    language: { type: 'string', default: '' },
    parent:   { type: 'string', default: '' },  // epic change ID
  },
  strict: true,
});

if (!values.title) {
  console.error('Usage: change-new.mjs --title "<title>" [--class feature|bug|small|epic] [--language rust|c|cpp] [--parent <epic-id>]');
  process.exit(1);
}

const validClasses = ['feature', 'bug', 'small', 'epic'];
if (!validClasses.includes(values.class)) {
  console.error(`Invalid class: ${values.class}. Must be one of: ${validClasses.join(', ')}`);
  process.exit(1);
}

// Children of an epic must be feature/bug/small, not another epic
if (values.parent && values.class === 'epic') {
  console.error('Error: an epic cannot be a child of another epic. Use class feature, bug, or small.');
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

// Epics only use architect + specify gates. They never run plan/implement/docs.
const gates = values.class === 'epic'
  ? { architect: 'pending', specify: 'pending' }
  : { architect: 'pending', specify: 'pending', plan: 'pending', implement: 'pending', docs: 'pending' };

const manifest = {
  id,
  title: values.title,
  class: values.class,
  stage: 'architect',
  language: values.language,
  ...(values.parent ? { parent: values.parent } : {}),
  ...(values.class === 'epic' ? { children: [] } : {}),
  gates,
  artifacts: {
    architecture: 'architecture.md',
    decisions:    'decisions.md',
    plan:         'plan.md',
  },
  context_targets: ['CONTEXT.md'],
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
} else {
  console.error(`Stage: architect — run the 'architect' skill next`);
}

// Write to stdout as JSON for agent consumption
process.stdout.write(JSON.stringify({ id, dir, ...(values.parent ? { parent: values.parent } : {}) }) + '\n');
