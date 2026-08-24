import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { repositoryRoot } from "./helpers.mjs";

test("repository exposes exactly the three public skills within budgets", async () => {
  const directory = path.join(repositoryRoot, "skills");
  const skills = (await readdir(directory)).sort();
  assert.deepEqual(skills, ["build", "design", "fix"]);
  for (const name of skills) {
    const content = await readFile(path.join(directory, name, "SKILL.md"), "utf8");
    assert.match(content, new RegExp(`^---\\nname: ${name}\\n`, "m"));
    assert.match(content, /description: Use when /);
    assert.ok(content.split("\n").length <= 140, `${name} exceeds 140 lines`);
    assert.ok(Buffer.byteLength(content) <= 10 * 1024, `${name} exceeds 10 KiB`);
  }
});

test("templates stay compact and skills metadata names only public skills", async () => {
  for (const file of await readdir(path.join(repositoryRoot, "templates"))) {
    const content = await readFile(path.join(repositoryRoot, "templates", file), "utf8");
    assert.ok(content.split("\n").length <= 120, `${file} exceeds 120 lines`);
  }
  const metadata = JSON.parse(await readFile(path.join(repositoryRoot, "skills.sh.json"), "utf8"));
  assert.deepEqual(metadata.groupings.flatMap(group => group.skills).sort(), ["build", "design", "fix"]);
  const packageMetadata = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  assert(packageMetadata.files.includes("skills"));
  assert(packageMetadata.files.includes("skills.sh.json"));
});
