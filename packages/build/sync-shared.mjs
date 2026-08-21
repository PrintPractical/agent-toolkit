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
import { fileURLToPath } from 'url';

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), '../..');

// ── Sync map ─────────────────────────────────────────────────────────────────
// Key: skill folder name
// Value: array of { src: relative to repoRoot, dest: relative to skill/references/ }

export const ALL_SHARED = [
  { src: '_shared/challenge-protocol.md',      dest: 'challenge-protocol.md' },
  { src: '_shared/context-schema.md',           dest: 'context-schema.md' },
  { src: '_shared/manifest-schema.md',          dest: 'manifest-schema.md' },
  { src: '_shared/seam-and-test-taxonomy.md',   dest: 'seam-and-test-taxonomy.md' },
  { src: '_shared/implementation-review.md',    dest: 'implementation-review.md' },
  { src: '_shared/change-lifecycle.md',         dest: 'change-lifecycle.md' },
  { src: '_shared/drift-control.md',            dest: 'drift-control.md' },
  { src: '_shared/firm-change-protocol.md',     dest: 'firm-change-protocol.md' },
  { src: '_shared/adversarial-review.md',       dest: 'adversarial-review.md' },
  { src: '_shared/engineering-fundamentals.md', dest: 'engineering-fundamentals.md' },
];

export const ALL_TEMPLATES = [
  { src: '_templates/CONTEXT.md.tmpl',          dest: 'templates/CONTEXT.md.tmpl' },
  { src: '_templates/architecture.md.tmpl',     dest: 'templates/architecture.md.tmpl' },
  { src: '_templates/decisions.md.tmpl',        dest: 'templates/decisions.md.tmpl' },
  { src: '_templates/plan.md.tmpl',             dest: 'templates/plan.md.tmpl' },
  { src: '_templates/refactor.md.tmpl',         dest: 'templates/refactor.md.tmpl' },
  { src: '_templates/reforge-seed.md.tmpl',     dest: 'templates/reforge-seed.md.tmpl' },
  { src: '_templates/architect-seed.md.tmpl',   dest: 'templates/architect-seed.md.tmpl' },
  { src: '_templates/implementation.md.tmpl',   dest: 'templates/implementation.md.tmpl' },
  { src: '_templates/epic-docs.md.tmpl',        dest: 'templates/epic-docs.md.tmpl' },
];

const idiomFiles = fs.readdirSync(path.join(repoRoot, '_idioms'))
  .filter(name => name.endsWith('.md'))
  .sort();

for (const name of idiomFiles) {
  if (!/^[a-z][a-z0-9-]*\.md$/.test(name)) {
    throw new Error(`Invalid idiom pack filename: ${name}. Use lowercase kebab-case.`);
  }
}

export const ALL_IDIOMS = idiomFiles.map(name => ({
  src: `_idioms/${name}`,
  dest: `idioms/${name}`,
}));

export const SYNC_MAP = {
  brainstorm: [
    { src: '_shared/challenge-protocol.md',     dest: 'challenge-protocol.md' },
    { src: '_shared/change-lifecycle.md',       dest: 'change-lifecycle.md' },
    { src: '_templates/architect-seed.md.tmpl', dest: 'templates/architect-seed.md.tmpl' },
  ],
  architect: [
    { src: '_shared/challenge-protocol.md',      dest: 'challenge-protocol.md' },
    { src: '_shared/context-schema.md',          dest: 'context-schema.md' },
    { src: '_shared/manifest-schema.md',         dest: 'manifest-schema.md' },
    { src: '_shared/seam-and-test-taxonomy.md',  dest: 'seam-and-test-taxonomy.md' },
    { src: '_shared/change-lifecycle.md',        dest: 'change-lifecycle.md' },
    { src: '_shared/firm-change-protocol.md',    dest: 'firm-change-protocol.md' },
    { src: '_shared/adversarial-review.md',      dest: 'adversarial-review.md' },
    { src: '_shared/engineering-fundamentals.md', dest: 'engineering-fundamentals.md' },
    { src: '_templates/architecture.md.tmpl',    dest: 'templates/architecture.md.tmpl' },
    { src: '_templates/change-brief.md.tmpl',    dest: 'templates/change-brief.md.tmpl' },
  ],
  specify: [
    { src: '_shared/challenge-protocol.md',      dest: 'challenge-protocol.md' },
    { src: '_shared/manifest-schema.md',         dest: 'manifest-schema.md' },
    { src: '_shared/seam-and-test-taxonomy.md',  dest: 'seam-and-test-taxonomy.md' },
    { src: '_shared/firm-change-protocol.md',    dest: 'firm-change-protocol.md' },
    { src: '_shared/adversarial-review.md',      dest: 'adversarial-review.md' },
    { src: '_shared/engineering-fundamentals.md', dest: 'engineering-fundamentals.md' },
    { src: '_templates/decisions.md.tmpl',       dest: 'templates/decisions.md.tmpl' },
  ],
  plan: [
    { src: '_shared/manifest-schema.md',         dest: 'manifest-schema.md' },
    { src: '_shared/seam-and-test-taxonomy.md',  dest: 'seam-and-test-taxonomy.md' },
    { src: '_shared/change-lifecycle.md',        dest: 'change-lifecycle.md' },
    { src: '_shared/adversarial-review.md',      dest: 'adversarial-review.md' },
    { src: '_shared/engineering-fundamentals.md', dest: 'engineering-fundamentals.md' },
    { src: '_templates/plan.md.tmpl',            dest: 'templates/plan.md.tmpl' },
  ],
  implement: [
    { src: '_shared/manifest-schema.md',         dest: 'manifest-schema.md' },
    { src: '_shared/seam-and-test-taxonomy.md',  dest: 'seam-and-test-taxonomy.md' },
    { src: '_shared/implementation-review.md',   dest: 'implementation-review.md' },
    { src: '_shared/change-lifecycle.md',        dest: 'change-lifecycle.md' },
    { src: '_shared/drift-control.md',           dest: 'drift-control.md' },
    { src: '_shared/firm-change-protocol.md',    dest: 'firm-change-protocol.md' },
    { src: '_shared/adversarial-review.md',      dest: 'adversarial-review.md' },
    { src: '_shared/engineering-fundamentals.md', dest: 'engineering-fundamentals.md' },
    { src: '_templates/implementation.md.tmpl',  dest: 'templates/implementation.md.tmpl' },
  ],
  refactor: [
    { src: '_shared/challenge-protocol.md',     dest: 'challenge-protocol.md' },
    { src: '_shared/context-schema.md',         dest: 'context-schema.md' },
    { src: '_shared/seam-and-test-taxonomy.md', dest: 'seam-and-test-taxonomy.md' },
    { src: '_shared/implementation-review.md',  dest: 'implementation-review.md' },
    { src: '_shared/drift-control.md',          dest: 'drift-control.md' },
    { src: '_shared/firm-change-protocol.md',   dest: 'firm-change-protocol.md' },
    { src: '_shared/adversarial-review.md',     dest: 'adversarial-review.md' },
    { src: '_shared/engineering-fundamentals.md', dest: 'engineering-fundamentals.md' },
    { src: '_templates/refactor.md.tmpl',     dest: 'templates/refactor.md.tmpl' },
    { src: '_templates/change-brief.md.tmpl', dest: 'templates/change-brief.md.tmpl' },
  ],
  triage: [
    { src: '_shared/challenge-protocol.md',     dest: 'challenge-protocol.md' },
    { src: '_shared/context-schema.md',         dest: 'context-schema.md' },
    { src: '_shared/seam-and-test-taxonomy.md', dest: 'seam-and-test-taxonomy.md' },
    { src: '_shared/firm-change-protocol.md',   dest: 'firm-change-protocol.md' },
    { src: '_templates/change-brief.md.tmpl',   dest: 'templates/change-brief.md.tmpl' },
    { src: '_templates/implementation.md.tmpl', dest: 'templates/implementation.md.tmpl' },
  ],
  epic: [
    { src: '_shared/context-schema.md',         dest: 'context-schema.md' },
    { src: '_shared/drift-control.md',          dest: 'drift-control.md' },
    { src: '_shared/manifest-schema.md',        dest: 'manifest-schema.md' },
    { src: '_templates/epic-docs.md.tmpl',      dest: 'templates/epic-docs.md.tmpl' },
  ],
  map: [
    { src: '_shared/context-schema.md',         dest: 'context-schema.md' },
    { src: '_shared/drift-control.md',          dest: 'drift-control.md' },
    { src: '_shared/seam-and-test-taxonomy.md', dest: 'seam-and-test-taxonomy.md' },
    { src: '_templates/CONTEXT.md.tmpl',      dest: 'templates/CONTEXT.md.tmpl' },
  ],
  reforge: [
    { src: '_shared/challenge-protocol.md',      dest: 'challenge-protocol.md' },
    { src: '_templates/reforge-seed.md.tmpl', dest: 'templates/reforge-seed.md.tmpl' },
    { src: '_templates/CONTEXT.md.tmpl',      dest: 'templates/CONTEXT.md.tmpl' },
  ],
  verify: [
    { src: '_shared/context-schema.md',         dest: 'context-schema.md' },
    { src: '_shared/seam-and-test-taxonomy.md', dest: 'seam-and-test-taxonomy.md' },
    { src: '_shared/drift-control.md',          dest: 'drift-control.md' },
    { src: '_shared/firm-change-protocol.md',   dest: 'firm-change-protocol.md' },
    { src: '_templates/CONTEXT.md.tmpl',      dest: 'templates/CONTEXT.md.tmpl' },
  ],
  'what-now': [
    { src: '_shared/manifest-schema.md',      dest: 'manifest-schema.md' },
    { src: '_shared/change-lifecycle.md',     dest: 'change-lifecycle.md' },
  ],
  idioms: ALL_IDIOMS,
};

// ── Scripts bundled into every skill ──────────────────────────────────────────
// Each installed skill must be self-contained: it carries the helper scripts it
// invokes plus the shared lib. Scripts import the lib via './lib/index.mjs', which
// resolves identically in packages/build/ (dev) and skills/<name>/scripts/ (installed).

export const SCRIPT_MAP = {
  brainstorm: [],
  architect: ['change-new.mjs', 'context-discover.mjs', 'manifest-approval.mjs', 'review-log.mjs'],
  specify: ['epic-split.mjs', 'manifest-approval.mjs', 'review-log.mjs'],
  plan: ['kickback-log.mjs', 'manifest-approval.mjs', 'traceability-sync.mjs'],
  implement: ['change-archive.mjs', 'change-recover.mjs', 'context-verify.mjs', 'kickback-log.mjs', 'manifest-approval.mjs', 'review-log.mjs'],
  epic: ['change-archive.mjs', 'context-verify.mjs', 'manifest-approval.mjs'],
  refactor: ['change-archive.mjs', 'change-recover.mjs', 'change-new.mjs', 'context-discover.mjs', 'context-verify.mjs', 'manifest-approval.mjs', 'review-log.mjs'],
  triage: ['change-archive.mjs', 'change-recover.mjs', 'change-new.mjs', 'change-status.mjs', 'context-verify.mjs', 'manifest-approval.mjs'],
  map: ['context-discover.mjs', 'context-scaffold.mjs'],
  reforge: [],
  verify: ['context-discover.mjs', 'context-verify.mjs'],
  'what-now': ['change-status.mjs'],
  idioms: [],
};

const ALL_SKILLS = Object.keys(SYNC_MAP);

// ── Sync execution ────────────────────────────────────────────────────────────

export function syncShared({ check = false } = {}) {
  let driftFound = false;
  let totalFiles = 0;
  let skipped = 0;

  /** Sync one file from src (repo-relative) to an absolute destination. */
  function syncOne(srcPath, destPath, relLabel) {
    if (!fs.existsSync(srcPath)) {
      console.error(`Warning: source not found, skipping: ${relLabel}`);
      skipped++;
      return;
    }
    const srcContent = fs.readFileSync(srcPath);

    if (check) {
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

  function unexpectedFiles(directory, expected) {
    if (!fs.existsSync(directory)) return [];
    const found = [];
    const visit = (current, relative = '') => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const next = path.join(relative, entry.name);
        if (entry.isDirectory()) visit(path.join(current, entry.name), next);
        else if (entry.isFile()) found.push(next);
      }
    };
    visit(directory);
    return found.filter(file => !expected.has(file));
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

    const expected = new Set(deduped.map(file => file.dest));
    if (check) {
      for (const extra of unexpectedFiles(skillRefDir, expected)) {
        console.error(`DRIFT: skills/${skill}/references/${extra} is not configured`);
        driftFound = true;
      }
    } else {
      fs.rmSync(skillRefDir, { recursive: true, force: true });
    }

    for (const { src, dest } of deduped) {
      syncOne(
        path.join(repoRoot, src),
        path.join(skillRefDir, dest),
        `skills/${skill}/references/${dest}`,
      );
    }
  }

  // 2. Sync only helpers invoked by each skill, plus their shared library.
  for (const skill of ALL_SKILLS) {
    const skillScriptsDir = path.join(repoRoot, 'skills', skill, 'scripts');
    const scripts = SCRIPT_MAP[skill];
    if (!scripts) throw new Error(`No script capability map for skill: ${skill}`);
    const expected = new Set(scripts.length > 0 ? ['lib/index.mjs', ...scripts] : []);
    if (check) {
      for (const extra of unexpectedFiles(skillScriptsDir, expected)) {
        console.error(`DRIFT: skills/${skill}/scripts/${extra} is not configured`);
        driftFound = true;
      }
    } else {
      fs.rmSync(skillScriptsDir, { recursive: true, force: true });
    }
    for (const scriptRel of expected) {
      syncOne(
        path.join(repoRoot, 'packages/build', scriptRel),
        path.join(skillScriptsDir, scriptRel),
        `skills/${skill}/scripts/${scriptRel}`,
      );
    }
  }

  if (check) {
    if (driftFound) {
      console.error('\nDrift detected. Run `npm run build` to sync.');
    } else {
      console.error('No drift detected. All skill references and scripts are in sync.');
    }
  } else {
    console.error(`\nSync complete: ${totalFiles} file(s) written.`);
    if (skipped > 0) console.error(`  Skipped: ${skipped} source(s) not found.`);
  }

  return { driftFound, totalFiles, skipped };
}

function main(args) {
  const { values } = parseArgs({
    args,
    options: {
      help:  { type: 'boolean', short: 'h', default: false },
      check: { type: 'boolean', default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log('Usage: sync-shared.mjs [--check]');
    return;
  }

  const result = syncShared({ check: values.check });
  if (values.check && result.driftFound) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main(process.argv.slice(2));
}
