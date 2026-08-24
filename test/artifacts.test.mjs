import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderChange, renderSystem, slugify, validateArtifacts } from "../src/artifacts.mjs";
import { temporaryDirectory } from "./helpers.mjs";

test("brownfield start can bootstrap compact change and system artifacts", async () => {
  const root = await temporaryDirectory();
  const slug = slugify("Restore Invoice Payment");
  const design = await renderChange(root, { kind: "fix", title: "Restore Invoice Payment", slug });
  assert.equal(await renderSystem(root), true);
  assert.equal(await renderSystem(root), false);
  assert.match(await readFile(design, "utf8"), /^# Restore Invoice Payment/m);
  const state = { designPath: `.agent/changes/${slug}.md` };
  assert.deepEqual(await validateArtifacts(root, state, { requireSystem: true }), []);
});

test("material open questions block artifact validation", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const content = (await readFile(design, "utf8")).replace("- None.", "- Which format is public?");
  await writeFile(design, content);
  assert.match((await validateArtifacts(root, { designPath: ".agent/changes/export-data.md" }, { requireSystem: true })).join("\n"), /open questions/);
});
