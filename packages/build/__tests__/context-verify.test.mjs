import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'context-verify.mjs');
const scaffoldScript = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'context-scaffold.mjs');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function head(cwd) { return git(cwd, ['rev-parse', 'HEAD']); }

function verify(cwd, args = []) {
  return spawnSync(process.execPath, [script, '--root', cwd, ...args], { encoding: 'utf8' });
}
function scaffold(cwd, args = []) {
  return spawnSync(process.execPath, [scaffoldScript, ...args], { cwd, encoding: 'utf8' });
}

describe('context-verify.mjs', () => {
  let cwd;

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-context-'));
    git(cwd, ['init']);
    git(cwd, ['config', 'user.email', 'tests@example.com']);
    git(cwd, ['config', 'user.name', 'Tests']);
    fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'seed\n');
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-m', 'seed']);
  });

  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('fails when provenance is missing', () => {
    fs.writeFileSync(path.join(cwd, 'CONTEXT.md'), '# Context\n');

    const result = verify(cwd);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout)[0].provenanceValid, false);
  });

  it('reports staleness after relevant files change', () => {
    const head = git(cwd, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(cwd, 'CONTEXT.md'), `# Context\n\nProvenance: validated-at: ${head}\n`);
    fs.writeFileSync(path.join(cwd, 'tracked.txt'), 'changed\n');
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-m', 'change tracked file']);

    const result = verify(cwd);
    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout)[0].changedFiles, ['CONTEXT.md', 'tracked.txt']);
  });

  it('runs the configured test command for cited firm seams', () => {
    const head = git(cwd, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(cwd, 'firm.test'), 'test\n');
    fs.writeFileSync(path.join(cwd, 'CONTEXT.md'), [
      '# Context',
      '',
      '[SEAM-example-01] -> enforced-by: firm.test',
      '',
      `Provenance: validated-at: ${head}`,
      '',
    ].join('\n'));

    const result = verify(cwd, ['--run-tests', '--test-command', 'false']);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout)[0].firmSeamResults[0].passed, false);
  });

  it('resolves firm test paths from the repository root, with component-relative fallback', () => {
    const component = path.join(cwd, 'src', 'component');
    fs.mkdirSync(path.join(cwd, 'tests'), { recursive: true });
    fs.mkdirSync(component, { recursive: true });
    fs.writeFileSync(path.join(cwd, 'tests', 'component.test'), 'test\n');
    fs.writeFileSync(path.join(component, 'firm.test'), 'test\n');
    fs.writeFileSync(path.join(component, 'CONTEXT.md'), [
      '[SEAM-root-01] -> enforced-by: tests/component.test',
      '[SEAM-legacy-01] -> enforced-by: firm.test',
      `Provenance: validated-at: ${head(cwd)}`,
    ].join('\n'));
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-m', 'add component context']);
    fs.writeFileSync(path.join(component, 'CONTEXT.md'), [
      '[SEAM-root-01] -> enforced-by: tests/component.test',
      '[SEAM-legacy-01] -> enforced-by: firm.test',
      `Provenance: validated-at: ${head(cwd)}`,
    ].join('\n'));

    const result = verify(cwd, ['--path', 'src/component/CONTEXT.md']);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.deepEqual(JSON.parse(result.stdout)[0].firmSeamResults.map(item => item.exists), [true, true]);
  });
});

describe('context-scaffold.mjs untracked provenance', () => {
  let cwd;

  beforeEach(() => { cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-toolkit-untracked-context-')); });
  afterEach(() => fs.rmSync(cwd, { recursive: true, force: true }));

  it('creates a valid untracked context and marks it stale after Git initialization', () => {
    const created = scaffold(cwd, ['--path', '.', '--root']);
    assert.equal(created.status, 0, created.stderr);
    assert.match(fs.readFileSync(path.join(cwd, 'CONTEXT.md'), 'utf8'), /Provenance: validated-at: <not-in-git-repo>/);

    let result = verify(cwd);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(JSON.parse(result.stdout)[0].provenance, 'untracked');

    git(cwd, ['init']);
    git(cwd, ['config', 'user.email', 'tests@example.com']);
    git(cwd, ['config', 'user.name', 'Tests']);
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-m', 'initialize repository']);

    result = verify(cwd);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stdout)[0].isStale, true);
  });
});
