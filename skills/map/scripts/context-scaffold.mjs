#!/usr/bin/env node
/**
 * context-scaffold.mjs — Create a CONTEXT.md file from the template.
 *
 * Usage:
 *   node context-scaffold.mjs --path <dir> [--name "Component Name"] [--root]
 *
 * Creates <dir>/CONTEXT.md from the template with placeholders filled.
 * Output (stdout): JSON { path }
 * Progress (stderr): human-readable
 */

import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';
import { getHeadSha } from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    path:    { type: 'string' },
    name:    { type: 'string', default: '' },
    root:    { type: 'boolean', default: false },
  },
  strict: true,
});

if (!values.path) {
  console.error('Usage: context-scaffold.mjs --path <directory> [--name "Name"] [--root]');
  process.exit(1);
}

const repoRoot = process.cwd();
const targetDir = path.resolve(values.path);
const targetFile = path.join(targetDir, 'CONTEXT.md');

if (fs.existsSync(targetFile)) {
  console.error(`CONTEXT.md already exists at ${targetFile}`);
  console.error('Delete it first if you want to re-scaffold.');
  process.exit(1);
}

// Find the template. Works in two contexts:
//   - installed skill:  <skill>/scripts/context-scaffold.mjs → <skill>/references/templates/
//   - repo dev:         packages/build/context-scaffold.mjs  → _templates/
const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const templateCandidates = [
  path.join(scriptDir, '../references/templates/CONTEXT.md.tmpl'), // installed skill
  path.join(scriptDir, '../../_templates/CONTEXT.md.tmpl'),        // repo dev
];
const templatePath = templateCandidates.find(p => fs.existsSync(p));

if (!templatePath) {
  console.error('Template not found. Looked in:');
  templateCandidates.forEach(p => console.error(`  - ${p}`));
  process.exit(1);
}

let template = fs.readFileSync(templatePath, 'utf8');

const componentName = values.name || path.basename(targetDir);
const sha = getHeadSha(repoRoot) || '<not-in-git-repo>';
const date = new Date().toISOString().slice(0, 10);
const scope = values.root ? 'root (system-level)' : 'component-level';

template = template
  .replace('{{COMPONENT_NAME}}', componentName)
  .replace('{{root (system-level) | component-level}}', scope)
  .replace('{{date}}', date)
  .replace('{{git-sha}}', sha);

// Remove the root-only children block if not root
if (!values.root) {
  template = template.replace(/\{\{#if root\}\}[\s\S]*?\{\{\/if\}\}/g, '');
} else {
  template = template
    .replace('{{#if root}}\n', '')
    .replace('\n{{/if}}', '');
}

fs.mkdirSync(targetDir, { recursive: true });
fs.writeFileSync(targetFile, template, 'utf8');

console.error(`Created: ${targetFile}`);
console.error(`  Component: ${componentName}`);
console.error(`  Scope:     ${scope}`);
console.error(`  SHA:       ${sha}`);

process.stdout.write(JSON.stringify({ path: targetFile }) + '\n');
