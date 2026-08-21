#!/usr/bin/env node
/**
 * epic-split.mjs — Create child change manifests from an existing epic architecture.md.
 *
 * Use this when you already ran architect on an epic and produced a single architecture.md
 * that describes multiple sub-tasks. This script reads the architecture.md, presents the
 * proposed children for confirmation, then creates child manifests.
 *
 * Usage:
 *   node epic-split.mjs --epic <epic-id> --children '<json-array>'
 *
 * The --children argument is a JSON array of child change descriptions:
 *   '[{"title":"...", "class":"feature", "language":"rust"}, ...]'
 *
 * Typically you do NOT call this directly. The architect skill calls it after the
 * decomposition discussion. You can also call it manually to convert an existing
 * epic architecture.md into child changes.
 *
 * Output (stdout): JSON { epic_id, children: [{id, title, dir}] }
 * Progress (stderr): human-readable status
 */

import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import {
  readManifest,
  writeManifest,
  generateChangeId,
  changeDir,
  activeDir,
} from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    help:     { type: 'boolean', short: 'h', default: false },
    epic:     { type: 'string' },
    children: { type: 'string' },   // JSON array of { title, class?, language? }
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: epic-split.mjs --epic <epic-id> --children \'[{"title":"...", "class":"feature"}, ...]\'');
  process.exit(0);
}

if (!values.epic || !values.children) {
  console.error('Usage: epic-split.mjs --epic <epic-id> --children \'[{"title":"...", "class":"feature"}, ...]\'');
  console.error('');
  console.error('Each child entry: { title: string, class?: "feature"|"bug"|"small", language?: string }');
  process.exit(1);
}

const repoRoot = process.cwd();

// Validate epic
let epicManifest;
try {
  epicManifest = readManifest(values.epic, repoRoot);
} catch (e) {
  console.error(`Error: could not read epic manifest: ${e.message}`);
  process.exit(1);
}

if (epicManifest.class !== 'epic') {
  console.error(`Error: '${values.epic}' is not an epic (class: ${epicManifest.class})`);
  process.exit(1);
}
if (epicManifest.phase !== 'specify' || epicManifest.approvals?.architect !== 'approved' || epicManifest.approvals?.specify !== 'approved') {
  console.error(`Error: epic '${values.epic}' must be in specify with architect and specify approvals approved.`);
  process.exit(1);
}
if ((epicManifest.children || []).length > 0) {
  console.error(`Error: epic '${values.epic}' is already decomposed; create the complete child set in one split.`);
  process.exit(1);
}

// Parse children list
let childDefs;
try {
  childDefs = JSON.parse(values.children);
  if (!Array.isArray(childDefs)) throw new Error('Expected a JSON array');
} catch (e) {
  console.error(`Error: --children must be a valid JSON array: ${e.message}`);
  process.exit(1);
}

if (childDefs.length === 0) {
  console.error('Error: --children array is empty');
  process.exit(1);
}

const validClasses = ['feature', 'bug', 'small'];
for (const child of childDefs) {
  if (!child.title) {
    console.error(`Error: each child must have a "title" field`);
    process.exit(1);
  }
  const cls = child.class || 'feature';
  if (!validClasses.includes(cls)) {
    console.error(`Error: invalid class "${cls}" for child "${child.title}". Must be: ${validClasses.join(', ')}`);
    process.exit(1);
  }
}

// Create child workspaces first, then publish the parent link as one transition.
const createdChildren = [];
const architectureDir = path.join(activeDir(repoRoot), values.epic);

console.error(`\nCreating ${childDefs.length} child change(s) for epic: ${values.epic}`);
console.error(`Epic: ${epicManifest.title}\n`);

for (const childDef of childDefs) {
  const cls = childDef.class || 'feature';
  const lang = childDef.language || epicManifest.language || '';
  const id = generateChangeId(childDef.title, repoRoot);
  const dir = changeDir(id, repoRoot);

  fs.mkdirSync(dir, { recursive: true });

  const manifest = {
    id,
    title: childDef.title,
    class: cls,
    phase: ['bug', 'small'].includes(cls) ? 'implement' : 'architect',
    language: lang,
    parent: values.epic,
    approvals: ['bug', 'small'].includes(cls)
      ? { implement: 'pending' }
      : { architect: 'pending', specify: 'pending', plan: 'pending', implement: 'pending' },
    artifacts: {
      change_brief: 'change-brief.md',
      architecture: 'architecture.md',
      decisions:    'decisions.md',
      plan:         'plan.md',
      implementation: 'implementation.md',
    },
    context_targets: epicManifest.context_targets || ['CONTEXT.md'],
    kickbacks: [],
    review_epochs: {},
  };

  writeManifest(id, manifest, repoRoot);

  // If the epic has a notes field for this child (from architecture.md parsing),
  // write a seed note to the child's directory
  if (childDef.notes) {
    const seedPath = path.join(dir, 'architect-seed.md');
    const seedContent = [
      `# Architect Seed — ${childDef.title}`,
      '',
      `**Epic:** ${epicManifest.title} (${values.epic})`,
      '',
      '## Notes from epic architecture.md',
      '',
      childDef.notes,
      '',
      '> This seed was generated by epic-split.mjs from the epic\'s architecture.md.',
      '> Use it as context when running the architect skill for this child change.',
    ].join('\n');
    fs.writeFileSync(seedPath, seedContent, 'utf8');
  }

  console.error(`  ✓ ${id}`);
  console.error(`    Title:    ${childDef.title}`);
  console.error(`    Class:    ${cls}`);
  if (lang) console.error(`    Language: ${lang}`);
  if (childDef.notes) console.error(`    Seed:     architect-seed.md`);

  createdChildren.push({ id, title: childDef.title, dir, class: cls, language: lang });
}

// Publish the complete child set only after every child workspace exists.
const updatedEpic = readManifest(values.epic, repoRoot);
updatedEpic.children = createdChildren.map(child => child.id);
updatedEpic.phase = 'decomposed';
writeManifest(values.epic, updatedEpic, repoRoot);

// Re-read updated epic manifest for final status
const completedEpic = readManifest(values.epic, repoRoot);
console.error(`\nEpic '${values.epic}' now has ${(completedEpic.children || []).length} child(ren) total.`);
console.error(`\nNext steps:`);
console.error(`  For each child, run: architect (pointing to the child's change ID)`);
console.error(`  To check epic progress: node change-status.mjs --id ${values.epic}`);

process.stdout.write(JSON.stringify({
  epic_id: values.epic,
  children: createdChildren,
}) + '\n');
