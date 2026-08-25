import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderChange, renderSystem, slugify, validateArtifacts } from "../src/artifacts.mjs";
import { temporaryDirectory } from "./helpers.mjs";

function completeArtifact(content) {
  return content
    .replace(/(## Requirements Traceability\n)[\s\S]*?(?=\n## )/, "$11. Payment requirement -> reproduction, rule, and tests.\n")
    .replace(/(## Boundaries and Dependencies\n)[\s\S]*?(?=\n## )/, "$11. Application owns PaymentStore; the database adapter is composed at startup.\n")
    .replace(/(## (?:Abstraction and Extension Pressure|Correction and Extension Pressure)\n)[\s\S]*?(?=\n## )/, "$11. PaymentStore owns the persistence contract and transaction behavior.\n")
    .replace(/(## File and Module Placement Plan\n)[\s\S]*?(?=\n## )/, "$1| Path or module | Action | Responsibility | Constraint | Slice |\n| --- | --- | --- | --- | --- |\n| src/payment.js | Modify | Apply payment rules | Keep policy separate from storage | 1 |\n")
    .replace(/(## Implementation Plan\n)[\s\S]*?(?=\n## )/, "$1### Slice 1: Payment behavior is restored\n- Outcome: A payment succeeds.\n- Entry point: Payment command.\n- Core behavior: Enforce payment rules.\n- Boundary integration: Persist atomically through PaymentStore.\n- Tests: Regression and database integration tests.\n- Acceptance command: [\"node\", \"--test\"]\n- Complete when: The command builds and tests pass.\n")
    .replace(/(## Implementation Conformance\n)[\s\S]*?(?=\n## )/, "$1### Architecture Decisions\n- Decision: PaymentStore is application-owned.\n- Implementation: The database adapter implements PaymentStore outward.\n- Verification: Unit dependency test and database integration test.\n\n### Slice Completion\n#### Slice 1: Payment behavior is restored\n- Slice: Slice 1 restores payment behavior.\n- Implementation: Command, rules, and adapter are integrated.\n- Verification: The command builds and regression tests pass.\n");
}

test("brownfield start can bootstrap compact change and system artifacts", async () => {
  const root = await temporaryDirectory();
  const slug = slugify("Restore Invoice Payment");
  const design = await renderChange(root, { kind: "fix", title: "Restore Invoice Payment", slug });
  assert.equal(await renderSystem(root), true);
  assert.equal(await renderSystem(root), false);
  assert.match(await readFile(design, "utf8"), /^# Restore Invoice Payment/m);
  const state = { designPath: `.agent/changes/${slug}.md`, artifactFormat: 2 };
  assert.match((await validateArtifacts(root, state, { requireSystem: true })).join("\n"), /Implementation Plan/);
  const content = await readFile(design, "utf8");
  await writeFile(design, completeArtifact(content));
  assert.deepEqual(await validateArtifacts(root, state, { requireSystem: true }), []);
});

test("format 3 artifacts require a completed file and module placement plan", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const state = { designPath: ".agent/changes/export-data.md", artifactFormat: 3 };
  const initialProblems = await validateArtifacts(root, state, { requireSystem: true });
  assert.match(initialProblems.join("\n"), /File and Module Placement Plan/);
  const completed = completeArtifact(await readFile(design, "utf8"));
  await writeFile(design, completed);
  assert.deepEqual(await validateArtifacts(root, state, { requireSystem: true }), []);
  await writeFile(design, completed.replace(/## File and Module Placement Plan\n[\s\S]*?(?=\n## )/, ""));
  assert.deepEqual(await validateArtifacts(root, { ...state, artifactFormat: 2 }, { requireSystem: true }), []);
});

test("material open questions block artifact validation", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const content = (await readFile(design, "utf8")).replace("- None.", "- Which format is public?");
  await writeFile(design, content);
  assert.match((await validateArtifacts(root, { designPath: ".agent/changes/export-data.md" }, { requireSystem: true })).join("\n"), /open questions/);
});

test("artifact validation requires architecture evidence and real vertical slices", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const content = completeArtifact(await readFile(design, "utf8"))
    .replace(/(## Implementation Plan\n)[\s\S]*?(?=\n## )/, "$1### Slice 1: Export request is accepted\n- Outcome: A request starts an export.\n- Entry point: Export command.\n- Core behavior: Validate export rules.\n- Boundary integration: Save through ExportStore.\n- Tests: Rule and adapter tests.\n- Acceptance command: [\"node\", \"--test\"]\n- Complete when: The command builds and tests pass.\n\n### Phase 2: Persistence\nAdd storage details.\n\n### Slice 3: Export downloads\n- Outcome: The export downloads.\n- Entry point: Download command.\n- Core behavior: Select export data.\n- Boundary integration: Read through ExportStore.\n- Tests: Download integration test.\n- Acceptance command: [\"node\", \"--test\"]\n- Complete when: Download passes.\n");
  await writeFile(design, content);
  const problems = await validateArtifacts(root, { designPath: ".agent/changes/export-data.md", phase: "shaping" }, { requireSystem: true });
  assert.match(problems.join("\n"), /non-slice headings: Phase 2: Persistence/);
  assert.match(problems.join("\n"), /slice numbers must start at 1 and be sequential/);
});

test("quality review requires completed architecture conformance", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const completed = completeArtifact(await readFile(design, "utf8"));
  await writeFile(design, completed.replace(/(## Implementation Conformance\n)[\s\S]*?(?=\n## )/, "$1Implemented.\n"));
  const problems = await validateArtifacts(root, { designPath: ".agent/changes/export-data.md", phase: "quality-critic" }, { requireSystem: true });
  assert.match(problems.join("\n"), /Complete Implementation Conformance/);
});

test("new artifacts reject aggregate slice claims and non-executable acceptance", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const content = completeArtifact(await readFile(design, "utf8"))
    .replace('["node", "--test"]', "cargo test")
    .replace("#### Slice 1: Payment behavior is restored", "#### Slice 1-3: Baseline");
  await writeFile(design, content);
  const problems = await validateArtifacts(root, {
    designPath: ".agent/changes/export-data.md",
    artifactFormat: 2,
    phase: "quality-critic"
  }, { requireSystem: true });
  assert.match(problems.join("\n"), /Acceptance command as a non-empty JSON string array/);
  assert.match(problems.join("\n"), /invalid headings: Slice 1-3: Baseline/);
  assert.match(problems.join("\n"), /Complete Implementation Conformance for Slice 1/);
});

test("legacy artifacts without a format retain conformance validation", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const content = completeArtifact(await readFile(design, "utf8")).replace("- Slice: Slice 1 restores payment behavior.\n", "");
  await writeFile(design, content);
  const problems = await validateArtifacts(root, {
    designPath: ".agent/changes/export-data.md",
    phase: "quality-critic"
  }, { requireSystem: true });
  assert.match(problems.join("\n"), /Complete Implementation Conformance/);
});

test("artifact validation does not impose arbitrary document size limits", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Model Complex Domain", slug: "model-complex-domain" });
  await renderSystem(root);
  const content = completeArtifact(await readFile(design, "utf8"));
  await writeFile(design, `${content}\n${"Detailed design evidence.\n".repeat(800)}`);
  const system = path.join(root, ".agent", "SYSTEM.md");
  await writeFile(system, `${await readFile(system, "utf8")}\n${"Durable system evidence.\n".repeat(800)}`);
  assert.deepEqual(await validateArtifacts(root, { designPath: ".agent/changes/model-complex-domain.md" }, { requireSystem: true }), []);
});
