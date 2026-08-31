import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { repositoryRoot } from "./helpers.mjs";

test("repository exposes exactly the four public skills within budgets", async () => {
  const directory = path.join(repositoryRoot, "skills");
  const skills = (await readdir(directory)).sort();
  assert.deepEqual(skills, ["build", "design", "fix", "ideate"]);
  for (const name of skills) {
    const content = await readFile(path.join(directory, name, "SKILL.md"), "utf8");
    assert.match(content, new RegExp(`^---\\nname: ${name}\\n`, "m"));
    assert.match(content, /description: Use when /);
    assert.ok(content.split("\n").length <= 140, `${name} exceeds 140 lines`);
    assert.ok(Buffer.byteLength(content) <= 10 * 1024, `${name} exceeds 10 KiB`);
  }
  for (const name of ["build", "design", "fix"]) {
    const content = await readFile(path.join(directory, name, "SKILL.md"), "utf8");
    assert.match(content, /## Project Instructions\n\nBefore planning or editing, read every applicable `AGENTS\.md` in the project\. Treat its instructions as binding requirements for all subsequent work\. If this skill's general guidance conflicts with an `AGENTS\.md` requirement, the `AGENTS\.md` takes precedence; do not simplify, reinterpret, or override that requirement\./);
    assert.doesNotMatch(content, /(?i:domain-driven|\bDDD\b|ubiquitous language|bounded context|value object|domain service)/);
  }
  const design = await readFile(path.join(directory, "design", "SKILL.md"), "utf8");
  const build = await readFile(path.join(directory, "build", "SKILL.md"), "utf8");
  const fix = await readFile(path.join(directory, "fix", "SKILL.md"), "utf8");
  assert.match(design, /closest existing owner/);
  assert.match(design, /decompose the change into independently meaningful responsibility owners/);
  assert.match(design, /Architecture is decomposed by responsibility; implementation proceeds by vertical slices through the reviewed owners/);
  assert.match(design, /supported now, deferred, or a non-goal/);
  assert.match(design, /smallest viable implementation and a reviewed change budget/);
  assert.match(design, /Packet findings are blockers/);
  assert.match(build, /instead of copying behavior/);
  assert.match(build, /Treat them as implementation constraints, not prompts to re-derive architecture/);
  assert.match(build, /review restart --stage design/);
  assert.match(build, /Track production-code growth and the largest touched source files/);
  assert.match(build, /stay advisory and out of the packet/);
  assert.match(fix, /parallel code unless a concrete semantic or ownership distinction prevents reuse/);
  assert.match(fix, /runnable vertical slices/);
  assert.match(fix, /supported, deferred, or non-goal/);
  assert.match(fix, /production-code and source-file growth/);
});

test("ideate stays conversational, independent, and constructively challenging", async () => {
  const content = await readFile(path.join(repositoryRoot, "skills", "ideate", "SKILL.md"), "utf8");
  assert.match(content, /do not invoke `agent-toolkit`, use its templates, or read or write `\.agent\/` assets/);
  assert.match(content, /likely anti-pattern/);
  assert.match(content, /Offer one or more simpler or better-aligned alternatives with their tradeoffs/);
  assert.match(content, /Enter the design skill only when the engineer explicitly asks/);
});

test("design stops at the reviewed build handoff", async () => {
  const content = await readFile(path.join(repositoryRoot, "skills", "design", "SKILL.md"), "utf8");
  assert.match(content, /When arriving from ideation in the same conversation/);
  assert.match(content, /Do not ask the engineer to repeat resolved information/);
  assert.match(content, /fewest independently useful milestones/);
  assert.match(content, /never create milestones for layers, modules, setup, or small tasks/);
  assert.match(content, /Do not run `agent-toolkit advance` from `ready-to-build`; the build skill owns the transition to `implementing`\./);
});

test("templates stay compact and skills metadata names only public skills", async () => {
  for (const file of await readdir(path.join(repositoryRoot, "templates"))) {
    const content = await readFile(path.join(repositoryRoot, "templates", file), "utf8");
    assert.ok(content.split("\n").length <= 120, `${file} exceeds 120 lines`);
    if (["design.md.tmpl", "fix.md.tmpl"].includes(file)) {
      assert.match(content, /Owners` must be a JSON string array containing every reviewed responsibility owner exactly once/);
      assert.match(content, /After implementing each active slice, update this section before recording that slice as complete/);
      assert.match(content, /Before `agent-toolkit slice complete --number N`, add `#### Slice N: <exact reviewed title>`/);
      assert.match(content, /`SUPPORTED`, `DEFERRED`, or `NON-GOAL`/);
      assert.match(content, /## Simplicity and Change Budget/);
      assert.match(content, /### Complexity Reconciliation/);
      assert.doesNotMatch(content, /per completed slice/);
    }
  }
  const metadata = JSON.parse(await readFile(path.join(repositoryRoot, "skills.sh.json"), "utf8"));
  assert.deepEqual(metadata.groupings.flatMap(group => group.skills).sort(), ["build", "design", "fix", "ideate"]);
  const packageMetadata = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  assert(packageMetadata.files.includes("skills"));
  assert(packageMetadata.files.includes("skills.sh.json"));
});

test("installation docs do not reference the reserved npm package", async () => {
  const readme = await readFile(path.join(repositoryRoot, "README.md"), "utf8");
  assert.doesNotMatch(readme, /npm install --global agent-toolkit(?:\s|$)/);
  assert.doesNotMatch(readme, /npx agent-toolkit(?:\s|$)/);
  assert.match(readme, /npm install --global github:PrintPractical\/agent-toolkit#v2/);
});
