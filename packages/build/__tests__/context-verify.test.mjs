import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'context-verify.mjs');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function verify(cwd, args = []) {
  return spawnSync(process.execPath, [script, '--root', cwd, ...args], { encoding: 'utf8' });
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
});
