/**
 * Unit tests for packages/build/sync-shared.mjs
 * Run with: node --test packages/build/__tests__/sync-shared.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const SYNC_SCRIPT = path.join(REPO_ROOT, 'packages/build/sync-shared.mjs');
const IDIOMS_DIR = path.join(REPO_ROOT, '_idioms');
const IDIOM_CONSUMERS = ['architect', 'specify', 'implement', 'triage', 'reforge'];

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

  it('syncs every canonical idiom pack to every consuming skill', () => {
    execSync(`node "${SYNC_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' });
    const packNames = fs.readdirSync(IDIOMS_DIR).filter(name => name.endsWith('.md')).sort();

    for (const skill of IDIOM_CONSUMERS) {
      for (const name of packNames) {
        const src = path.join(IDIOMS_DIR, name);
        const dest = path.join(REPO_ROOT, 'skills', skill, 'references', 'idioms', name);
        assert.ok(fs.existsSync(dest), `Expected ${skill} to receive idioms/${name}`);
        assert.ok(fs.readFileSync(src).equals(fs.readFileSync(dest)), `${skill}/idioms/${name} must match canonical source`);
      }
    }
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

  it('all 10 skills have a references/ directory after sync', () => {
    execSync(`node "${SYNC_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' });

    const skills = ['brainstorm', 'architect', 'specify', 'plan', 'implement', 'triage', 'map', 'reforge', 'verify', 'what-now'];
    for (const skill of skills) {
      const refDir = path.join(REPO_ROOT, 'skills', skill, 'references');
      assert.ok(fs.existsSync(refDir), `Expected references/ dir for skill: ${skill}`);
    }
  });

  it('every skill bundles its helper scripts + lib (self-contained)', () => {
    execSync(`node "${SYNC_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' });

    const skills = ['brainstorm', 'architect', 'specify', 'plan', 'implement', 'triage', 'map', 'reforge', 'verify', 'what-now'];
    const expectedScripts = [
      'lib/index.mjs', 'change-new.mjs', 'change-status.mjs', 'change-archive.mjs',
      'manifest-gate.mjs', 'context-scaffold.mjs', 'context-discover.mjs',
      'context-verify.mjs', 'kickback-log.mjs', 'epic-split.mjs',
    ];
    for (const skill of skills) {
      for (const script of expectedScripts) {
        const p = path.join(REPO_ROOT, 'skills', skill, 'scripts', script);
        assert.ok(fs.existsSync(p), `Expected ${skill}/scripts/${script} to be bundled`);
      }
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
