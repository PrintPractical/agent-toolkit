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
    assert.match(content, /Where project instructions do not prescribe module layout,/);
  }
  const design = await readFile(path.join(directory, "design", "SKILL.md"), "utf8");
  const build = await readFile(path.join(directory, "build", "SKILL.md"), "utf8");
  const fix = await readFile(path.join(directory, "fix", "SKILL.md"), "utf8");
  assert.match(design, /closest existing owner/);
  assert.match(build, /instead of copying behavior/);
  assert.match(fix, /parallel code unless a concrete semantic or ownership distinction prevents reuse/);
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
  assert.match(content, /When the engineer arrives from ideation in the same conversation/);
  assert.match(content, /Do not ask them to repeat resolved information/);
  assert.match(content, /Do not run `agent-toolkit advance` from `ready-to-build`; the build skill owns the transition to `implementing`\./);
});

test("templates stay compact and skills metadata names only public skills", async () => {
  for (const file of await readdir(path.join(repositoryRoot, "templates"))) {
    const content = await readFile(path.join(repositoryRoot, "templates", file), "utf8");
    assert.ok(content.split("\n").length <= 120, `${file} exceeds 120 lines`);
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
