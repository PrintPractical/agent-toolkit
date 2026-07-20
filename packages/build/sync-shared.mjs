#!/usr/bin/env node
/**
 * sync-shared.mjs — Copy canonical shared assets into each skill's references/ directory.
 *
 * Canonical sources:
 *   _shared/     → shared reference docs
 *   _templates/  → asset templates
 *   _idioms/     → language idioms packs
 *
 * Each skill declares which files it receives in the SYNC_MAP below.
 * Run with: node packages/build/sync-shared.mjs [--check]
 *   --check: verify no drift without writing (exit 1 if drift found, for CI)
 *
 * Output (stderr): status for each file copied or verified
 * Exit: 0 = success/no-drift, 1 = drift detected (check mode)
 */

import fs from 'fs';
import path from 'path';
import { parseArgs } from 'util';

const { values } = parseArgs({
  options: {
    help:  { type: 'boolean', short: 'h', default: false },
    check: { type: 'boolean', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: sync-shared.mjs [--check]');
  process.exit(0);
}

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

// ── Sync map ─────────────────────────────────────────────────────────────────
// Key: skill folder name
// Value: array of { src: relative to repoRoot, dest: relative to skill/references/ }

const ALL_SHARED = [
  { src: '_shared/challenge-protocol.md',      dest: 'challenge-protocol.md' },
  { src: '_shared/context-schema.md',           dest: 'context-schema.md' },
  { src: '_shared/manifest-schema.md',          dest: 'manifest-schema.md' },
  { src: '_shared/seam-and-test-taxonomy.md',   dest: 'seam-and-test-taxonomy.md' },
  { src: '_shared/change-lifecycle.md',         dest: 'change-lifecycle.md' },
  { src: '_shared/drift-control.md',            dest: 'drift-control.md' },
  { src: '_shared/firm-change-protocol.md',     dest: 'firm-change-protocol.md' },
];

const ALL_TEMPLATES = [
  { src: '_templates/CONTEXT.md.tmpl',          dest: 'templates/CONTEXT.md.tmpl' },
  { src: '_templates/manifest.yaml.tmpl',       dest: 'templates/manifest.yaml.tmpl' },
  { src: '_templates/architecture.md.tmpl',     dest: 'templates/architecture.md.tmpl' },
  { src: '_templates/decisions.md.tmpl',        dest: 'templates/decisions.md.tmpl' },
  { src: '_templates/plan.md.tmpl',             dest: 'templates/plan.md.tmpl' },
  { src: '_templates/reforge-seed.md.tmpl',     dest: 'templates/reforge-seed.md.tmpl' },
  { src: '_templates/architect-seed.md.tmpl',   dest: 'templates/architect-seed.md.tmpl' },
];

const idiomFiles = fs.readdirSync(path.join(repoRoot, '_idioms'))
  .filter(name => name.endsWith('.md'))
  .sort();

for (const name of idiomFiles) {
  if (!/^[a-z][a-z0-9-]*\.md$/.test(name)) {
    throw new Error(`Invalid idiom pack filename: ${name}. Use lowercase kebab-case.`);
  }
}

const ALL_IDIOMS = idiomFiles.map(name => ({
  src: `_idioms/${name}`,
  dest: `idioms/${name}`,
}));

const SYNC_MAP = {
  brainstorm: [
    { src: '_shared/challenge-protocol.md',     dest: 'challenge-protocol.md' },
    { src: '_shared/change-lifecycle.md',       dest: 'change-lifecycle.md' },
    { src: '_templates/architect-seed.md.tmpl', dest: 'templates/architect-seed.md.tmpl' },
  ],
  architect: [
    ...ALL_SHARED,
    ...ALL_TEMPLATES,
    ...ALL_IDIOMS,
  ],
  specify: [
    ...ALL_SHARED,
    { src: '_templates/decisions.md.tmpl',   dest: 'templates/decisions.md.tmpl' },
    { src: '_templates/architecture.md.tmpl', dest: 'templates/architecture.md.tmpl' },
    ...ALL_IDIOMS,
  ],
  plan: [
    ...ALL_SHARED,
    { src: '_templates/plan.md.tmpl',         dest: 'templates/plan.md.tmpl' },
    { src: '_templates/decisions.md.tmpl',    dest: 'templates/decisions.md.tmpl' },
    { src: '_templates/architecture.md.tmpl', dest: 'templates/architecture.md.tmpl' },
  ],
  implement: [
    ...ALL_SHARED,
    { src: '_templates/plan.md.tmpl',         dest: 'templates/plan.md.tmpl' },
    ...ALL_IDIOMS,
  ],
  triage: [
    ...ALL_SHARED,
    { src: '_templates/manifest.yaml.tmpl',   dest: 'templates/manifest.yaml.tmpl' },
    { src: '_templates/plan.md.tmpl',         dest: 'templates/plan.md.tmpl' },
    ...ALL_IDIOMS,
  ],
  map: [
    ...ALL_SHARED,
    { src: '_templates/CONTEXT.md.tmpl',      dest: 'templates/CONTEXT.md.tmpl' },
    { src: '_templates/manifest.yaml.tmpl',   dest: 'templates/manifest.yaml.tmpl' },
  ],
  reforge: [
    ...ALL_SHARED,
    { src: '_templates/reforge-seed.md.tmpl', dest: 'templates/reforge-seed.md.tmpl' },
    { src: '_templates/CONTEXT.md.tmpl',      dest: 'templates/CONTEXT.md.tmpl' },
    ...ALL_IDIOMS,
  ],
  verify: [
    ...ALL_SHARED,
    { src: '_templates/CONTEXT.md.tmpl',      dest: 'templates/CONTEXT.md.tmpl' },
  ],
  'what-now': [
    { src: '_shared/manifest-schema.md',      dest: 'manifest-schema.md' },
    { src: '_shared/change-lifecycle.md',     dest: 'change-lifecycle.md' },
  ],
};

// ── Scripts bundled into every skill ──────────────────────────────────────────
// Each installed skill must be self-contained: it carries the helper scripts it
// invokes plus the shared lib. Scripts import the lib via './lib/index.mjs', which
// resolves identically in packages/build/ (dev) and skills/<name>/scripts/ (installed).

const SCRIPT_FILES = [
  'lib/index.mjs',
  'change-new.mjs',
  'change-status.mjs',
  'change-archive.mjs',
  'manifest-gate.mjs',
  'context-scaffold.mjs',
  'context-discover.mjs',
  'context-verify.mjs',
  'kickback-log.mjs',
  'epic-split.mjs',
];

const ALL_SKILLS = Object.keys(SYNC_MAP);

// ── Sync execution ────────────────────────────────────────────────────────────

let driftFound = false;
let totalFiles = 0;
let skipped = 0;

/**
 * Sync one file from src (repo-relative) to an absolute dest path.
 * In --check mode, reports drift instead of writing.
 */
function syncOne(srcPath, destPath, relLabel) {
  if (!fs.existsSync(srcPath)) {
    console.error(`Warning: source not found, skipping: ${relLabel}`);
    skipped++;
    return;
  }
  const srcContent = fs.readFileSync(srcPath);

  if (values.check) {
    if (!fs.existsSync(destPath)) {
      console.error(`DRIFT: ${relLabel} is missing`);
      driftFound = true;
    } else if (!srcContent.equals(fs.readFileSync(destPath))) {
      console.error(`DRIFT: ${relLabel} differs from canonical source`);
      driftFound = true;
    }
  } else {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(destPath, srcContent);
    console.error(`  → ${relLabel}`);
    totalFiles++;
  }
}

// 1. Sync shared references / templates / idioms into each skill's references/
for (const [skill, files] of Object.entries(SYNC_MAP)) {
  const skillRefDir = path.join(repoRoot, 'skills', skill, 'references');

  const seen = new Set();
  const deduped = files.filter(f => {
    if (seen.has(f.dest)) return false;
    seen.add(f.dest);
    return true;
  });

  for (const { src, dest } of deduped) {
    syncOne(
      path.join(repoRoot, src),
      path.join(skillRefDir, dest),
      `skills/${skill}/references/${dest}`,
    );
  }
}

// 2. Sync helper scripts + lib into every skill's scripts/
for (const skill of ALL_SKILLS) {
  const skillScriptsDir = path.join(repoRoot, 'skills', skill, 'scripts');
  for (const scriptRel of SCRIPT_FILES) {
    syncOne(
      path.join(repoRoot, 'packages/build', scriptRel),
      path.join(skillScriptsDir, scriptRel),
      `skills/${skill}/scripts/${scriptRel}`,
    );
  }
}

if (values.check) {
  if (driftFound) {
    console.error('\nDrift detected. Run `npm run build` to sync.');
    process.exit(1);
  } else {
    console.error('No drift detected. All skill references and scripts are in sync.');
    process.exit(0);
  }
} else {
  console.error(`\nSync complete: ${totalFiles} file(s) written.`);
  if (skipped > 0) console.error(`  Skipped: ${skipped} source(s) not found.`);
}
