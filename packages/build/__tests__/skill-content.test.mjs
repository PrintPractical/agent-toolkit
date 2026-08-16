import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const SPINE_SKILLS = ['architect', 'specify', 'plan', 'implement'];

describe('spine skill discovery policy', () => {
  it('bounds discovery to material concerns and avoids absolute gap claims', () => {
    for (const skill of SPINE_SKILLS) {
      const skillPath = path.join(REPO_ROOT, 'skills', skill, 'SKILL.md');
      const content = fs.readFileSync(skillPath, 'utf8');

      assert.match(content, /\bmaterial\b/i, `${skill} must bound discovery to material concerns`);
      assert.doesNotMatch(content, /\bfind (?:every|all)(?: possible)? gaps?\b/i, `${skill} must not promise unbounded gap discovery`);
      assert.doesNotMatch(content, /\beliminate (?:every|all)(?: possible)? ambiguit(?:y|ies)\b/i, `${skill} must not promise absolute ambiguity elimination`);
    }
  });

  it('loads engineering fundamentals and documents blocker-only verifier regressions', () => {
    for (const skill of SPINE_SKILLS) {
      const content = fs.readFileSync(path.join(REPO_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
      assert.match(content, /engineering-fundamentals\.md/, `${skill} must load or reference engineering fundamentals`);
    }
    for (const skill of ['architect', 'specify', 'implement']) {
      const content = fs.readFileSync(path.join(REPO_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
      assert.match(content, /blocker regression/i, `${skill} must document the verifier regression exception`);
    }
  });

  it('reads an explicitly supplied architect seed before intake questions', () => {
    const content = fs.readFileSync(path.join(REPO_ROOT, 'skills', 'architect', 'SKILL.md'), 'utf8');
    const seed = content.indexOf('**Explicit seed before intake.**');
    const intake = content.indexOf('**Record the resulting intake.**');

    assert.ok(seed >= 0, 'architect must define explicit seed handling');
    assert.ok(intake > seed, 'architect must handle an explicit seed before intake');
    assert.match(content, /ask only about fields that are missing or uncertain/i);
    assert.match(content, /change-brief\.md.*seed and intake context/i);
  });
});
