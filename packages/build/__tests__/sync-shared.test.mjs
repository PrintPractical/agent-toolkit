/**
 * Unit tests for packages/build/sync-shared.mjs
 * Run with: node --test packages/build/__tests__/sync-shared.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { ALL_IDIOMS, SCRIPT_MAP, SYNC_MAP } from '../sync-shared.mjs';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const SYNC_SCRIPT = path.join(REPO_ROOT, 'packages/build/sync-shared.mjs');
const IDIOMS_DIR = path.join(REPO_ROOT, '_idioms');

describe('sync-shared.mjs', () => {
  it('runs without error in check mode when generated assets are current', () => {
    execSync(`node "${SYNC_SCRIPT}" --check`, {
      cwd: REPO_ROOT,
      stdio: 'pipe',
    });
  });

  it('writes files into skills/*/references/', () => {
    execSync(`node "${SYNC_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' });

    // Check a sample: architect should have challenge-protocol.md
    const destPath = path.join(REPO_ROOT, 'skills/architect/references/challenge-protocol.md');
    assert.ok(fs.existsSync(destPath), `Expected ${destPath} to exist after sync`);
  });

  it('synced file content matches canonical source', () => {
    execSync(`node "${SYNC_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' });

    const src = path.join(REPO_ROOT, '_shared/challenge-protocol.md');
    const dest = path.join(REPO_ROOT, 'skills/architect/references/challenge-protocol.md');

    const srcContent = fs.readFileSync(src);
    const destContent = fs.readFileSync(dest);
    assert.ok(srcContent.equals(destContent), 'Synced file must match canonical source');
  });

  it('idiom packs follow the required structure', () => {
    const packNames = fs.readdirSync(IDIOMS_DIR).filter(name => name.endsWith('.md')).sort();
    const expectedPacks = [
      'c.md', 'cpp.md', 'go.md', 'javascript.md', 'python.md', 'rust.md', 'swift.md', 'typescript.md',
    ];

    for (const name of expectedPacks) {
      assert.ok(packNames.includes(name), `Expected canonical idiom pack: ${name}`);
    }

    for (const name of packNames) {
      assert.match(name, /^[a-z][a-z0-9-]*\.md$/, `Pack filename must be lowercase kebab-case: ${name}`);
      const content = fs.readFileSync(path.join(IDIOMS_DIR, name), 'utf8');
      assert.match(content, /^# .+ Idioms Pack$/m, `${name} must have an idioms-pack title`);
      assert.match(content, /^## Applicability$/m, `${name} must define applicability`);
      assert.match(content, /^## Core principle$/m, `${name} must define a core principle`);
      assert.match(content, /^## Power Checklist$/m, `${name} must define a power checklist`);
      assert.match(content, /^## Smell List$/m, `${name} must define a smell list`);
      assert.match(content, /^- \[ \] /m, `${name} must contain actionable checklist items`);

      const smellList = content.split(/^## Smell List$/m)[1] ?? '';
      assert.match(smellList, /^- /m, `${name} must contain concrete smell entries`);
    }
  });

  it('requires current dependency versions and version-matched Rust source evidence', () => {
    const protocol = fs.readFileSync(path.join(REPO_ROOT, '_shared/challenge-protocol.md'), 'utf8');
    assert.match(protocol, /Package versions and APIs are time-sensitive facts, not model knowledge/);
    assert.match(protocol, /select the newest stable release allowed by those constraints/);
    assert.match(protocol, /Preserve existing dependency requirements and resolved versions unless the task explicitly includes an upgrade/);

    const rust = fs.readFileSync(path.join(IDIOMS_DIR, 'rust.md'), 'utf8');
    assert.match(rust, /`cargo add <crate>` without a remembered version/);
    assert.match(rust, /Run `cargo fetch`/);
    assert.match(rust, /`cargo metadata --format-version 1`/);
    assert.match(rust, /metadata-reported manifest path rather than assuming `~\/\.cargo`/);
  });

  it('distributes every canonical idiom pack only to the idioms skill', () => {
    const packNames = fs.readdirSync(IDIOMS_DIR).filter(name => name.endsWith('.md')).sort();
    const expectedIdioms = packNames.map(name => ({
      src: `_idioms/${name}`,
      dest: `idioms/${name}`,
    }));
    assert.deepEqual(ALL_IDIOMS, expectedIdioms);
    assert.deepEqual(SYNC_MAP.idioms, expectedIdioms);
    for (const [skill, files] of Object.entries(SYNC_MAP)) {
      if (skill !== 'idioms') {
        assert.equal(files.some(({ src }) => src.startsWith('_idioms/')), false, `${skill} must not bundle idiom packs`);
      }
    }
  });

  it('uses explicit, minimal reference capabilities', () => {
    assert.ok(SYNC_MAP.architect.length < 12, 'architect must not receive the complete shared bundle');
    assert.ok(SYNC_MAP.plan.length < 8, 'plan must not receive the complete shared bundle');
    assert.equal(SYNC_MAP.reforge.some(({ src }) => src === '_shared/adversarial-review.md'), false);
    assert.equal(SYNC_MAP.implement.some(({ src }) => src.startsWith('_templates/')), false);
  });

  it('syncs the brainstorm architect seed template', () => {
    execSync(`node "${SYNC_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' });

    const src = path.join(REPO_ROOT, '_templates/architect-seed.md.tmpl');
    const dest = path.join(REPO_ROOT, 'skills/brainstorm/references/templates/architect-seed.md.tmpl');

    assert.ok(fs.readFileSync(src).equals(fs.readFileSync(dest)), 'Brainstorm seed template must match canonical source');
  });

  it('check mode exits with code 1 when drift exists', () => {
    // Introduce drift
    const driftPath = path.join(REPO_ROOT, 'skills/architect/references/challenge-protocol.md');
    const original = fs.readFileSync(driftPath);

    fs.writeFileSync(driftPath, original + '\n<!-- DRIFT -->\n');

    try {
      execSync(`node "${SYNC_SCRIPT}" --check`, { cwd: REPO_ROOT, stdio: 'pipe' });
      assert.fail('Expected process to exit with code 1');
    } catch (e) {
      assert.equal(e.status, 1, 'Expected exit code 1 for drift');
    } finally {
      // Restore
      fs.writeFileSync(driftPath, original);
    }
  });

  it('all configured skills have a references/ directory after sync', () => {
    execSync(`node "${SYNC_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' });

    const skills = Object.keys(SYNC_MAP);
    for (const skill of skills) {
      const refDir = path.join(REPO_ROOT, 'skills', skill, 'references');
      assert.ok(fs.existsSync(refDir), `Expected references/ dir for skill: ${skill}`);
    }
  });

  it('bundles only each skill capability scripts plus the shared lib', () => {
    execSync(`node "${SYNC_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' });

    for (const [skill, scripts] of Object.entries(SCRIPT_MAP)) {
      const expectedScripts = scripts.length > 0 ? ['lib/index.mjs', ...scripts] : [];
      const scriptsDir = path.join(REPO_ROOT, 'skills', skill, 'scripts');
      const actualScripts = fs.existsSync(scriptsDir)
        ? fs.readdirSync(scriptsDir, { recursive: true }).filter(file => !fs.statSync(path.join(scriptsDir, file)).isDirectory()).sort()
        : [];
      assert.deepEqual(actualScripts, [...expectedScripts].sort(), `${skill} should bundle exactly its declared scripts`);
      for (const script of expectedScripts) {
        const p = path.join(REPO_ROOT, 'skills', skill, 'scripts', script);
        assert.ok(fs.existsSync(p), `Expected ${skill}/scripts/${script} to be bundled`);
      }
    }
  });

  it('check mode detects stale generated files', () => {
    execSync(`node "${SYNC_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' });
    const stalePath = path.join(REPO_ROOT, 'skills/architect/references/stale.md');
    fs.writeFileSync(stalePath, 'stale\n');
    try {
      assert.throws(() => execSync(`node "${SYNC_SCRIPT}" --check`, { cwd: REPO_ROOT, stdio: 'pipe' }));
    } finally {
      fs.rmSync(stalePath, { force: true });
    }
  });

  it('bundled scripts import lib via ./lib (resolves in installed context)', () => {
    execSync(`node "${SYNC_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' });
    const bundled = fs.readFileSync(
      path.join(REPO_ROOT, 'skills/architect/scripts/change-new.mjs'), 'utf8'
    );
    assert.ok(bundled.includes("from './lib/index.mjs'"), 'bundled script must import ./lib/index.mjs');
    assert.ok(!bundled.includes("from '../lib/index.mjs'"), 'must not use repo-relative ../lib path');
  });
});
