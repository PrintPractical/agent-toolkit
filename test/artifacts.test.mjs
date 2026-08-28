import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { projectMilestones, projectRequirements, renderChange, renderProject, renderSystem, slugify, sourceRecords, validateArtifacts } from "../src/artifacts.mjs";
import { temporaryDirectory } from "./helpers.mjs";

function completeArtifact(content) {
  return content
    .replace(/(## Requirements Traceability\n)[\s\S]*?(?=\n## )/, "$11. Payment requirement -> reproduction, rule, and tests.\n")
    .replace(/(## Boundaries and Dependencies\n)[\s\S]*?(?=\n## )/, "$11. Application owns PaymentStore; the database adapter is composed at startup.\n")
    .replace(/(## (?:Abstraction and Extension Pressure|Correction and Extension Pressure)\n)[\s\S]*?(?=\n## )/, "$11. PaymentStore owns the persistence contract and transaction behavior.\n")
    .replace(/(## Existing Capabilities and Reuse\n)[\s\S]*?(?=\n## )/, "$11. Inspected PaymentStore; extend it because it already owns payment persistence behavior.\n")
    .replace(/(## File and Module Placement Plan\n)[\s\S]*?(?=\n## )/, "$1| Path or module | Action | Responsibility | Constraint | Slice |\n| --- | --- | --- | --- | --- |\n| src/payment.js | Modify | Apply payment rules | Keep policy separate from storage | 1 |\n")
    .replace(/(## Implementation Plan\n)[\s\S]*?(?=\n## )/, "$1### Slice 1: Payment behavior is restored\n- Outcome: A payment succeeds.\n- Entry point: Payment command.\n- Core behavior: Enforce payment rules.\n- Boundary integration: Persist atomically through PaymentStore.\n- Tests: Regression and database integration tests.\n- Acceptance command: [\"node\", \"--test\"]\n- Complete when: The command builds and tests pass.\n")
    .replace(/(## Implementation Conformance\n)[\s\S]*?(?=\n## )/, "$1### Architecture Decisions\n- Decision: PaymentStore is application-owned.\n- Implementation: The database adapter implements PaymentStore outward.\n- Verification: Unit dependency test and database integration test.\n\n### Slice Completion\n#### Slice 1: Payment behavior is restored\n- Slice: Slice 1 restores payment behavior.\n- Implementation: Command, rules, and adapter are integrated.\n- Verification: The command builds and regression tests pass.\n");
}

function completeProject(content, { complete = false } = {}) {
  return content
    .replace(/(## Outcome\n)[\s\S]*?(?=\n## )/, "$1Teams can safely deliver reviewed milestones and recognize completion from recorded integration evidence.\n")
    .replace(/(## Non-goals\n)[\s\S]*?(?=\n## )/, "$1Automated worktree management and predictive application architecture are excluded.\n")
    .replace(/(## Required Outcomes\n)[\s\S]*?(?=\n## )/, "$1### Requirement REQ-1: Milestones remain independently deliverable\n- Outcome: Each milestone uses the complete change lifecycle.\n- Acceptance: The linked workflow reaches completion with its own review and commit.\n")
    .replace(/(## Known Constraints\n)[\s\S]*?(?=\n## )/, "$1The CLI remains deterministic, non-Git operation works, and no command pushes.\n")
    .replace(/(## Quality Attributes\n)[\s\S]*?(?=\n## )/, "$1State updates are atomic and every independent review is candidate-fingerprinted.\n")
    .replace(/(## Decisions and Hypotheses\n)[\s\S]*?(?=\n## )/, "$1- [committed] Milestones use normal feature or fix workflows so existing gates remain mandatory.\n")
    .replace(/(## Roadmap\n)[\s\S]*?(?=\n## )/, `$1### Milestone 1: Deliver a reviewed workflow\n- Kind: feature\n- Outcome: One milestone is independently delivered.\n- Requirements: ["REQ-1"]\n- Dependencies: []\n- Status: ${complete ? "complete" : "active"}\n`)
    .replace(/(## Requirement Coverage\n)[\s\S]*?(?=\n## )/, `$1- REQ-1: Milestone 1 ${complete ? "complete with integration evidence" : "planned"}.\n`)
    .replace(/(## Completion Criteria\n)[\s\S]*?(?=\n## )/, "$1Every required outcome is covered by a reconciled milestone and final integration passes.\n")
    .replace("- Assessment: Complete before final project review.", complete ? "- Assessment: The reconciled milestone and project-wide integration command satisfy completion criteria." : "- Assessment: Complete before final project review.");
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

test("current artifacts require a completed file and module placement plan", async () => {
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
  assert.match((await validateArtifacts(root, state, { requireSystem: true })).join("\n"), /File and Module Placement Plan/);
});

test("current artifacts require an explicit reuse decision", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const state = { designPath: ".agent/changes/export-data.md", artifactFormat: 4 };
  const completed = completeArtifact(await readFile(design, "utf8"));
  await writeFile(design, completed.replace(/## Existing Capabilities and Reuse\n[\s\S]*?(?=\n## )/, ""));
  assert.match((await validateArtifacts(root, state, { requireSystem: true })).join("\n"), /Existing Capabilities and Reuse/);
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

test("current artifacts require exact slice conformance", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const content = completeArtifact(await readFile(design, "utf8")).replace("- Verification: The command builds and regression tests pass.\n", "");
  await writeFile(design, content);
  const problems = await validateArtifacts(root, {
    designPath: ".agent/changes/export-data.md",
    phase: "quality-critic"
  }, { requireSystem: true });
  assert.match(problems.join("\n"), /conformance requires Implementation and Verification evidence/);
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

test("project artifacts require completed framing and objective roadmap records", async () => {
  const root = await temporaryDirectory();
  const artifact = await renderProject(root, { title: "Delivery Platform", slug: "delivery-platform" });
  await renderSystem(root);
  const state = { type: "project", projectPath: ".agent/projects/delivery-platform.md", designPath: ".agent/projects/delivery-platform.md", sources: [] };
  const untouched = await validateArtifacts(root, state, { requireSystem: true });
  assert.match(untouched.join("\n"), /Complete the Outcome section/);
  assert.match(untouched.join("\n"), /Required Outcomes must use/);
  await writeFile(artifact, completeProject(await readFile(artifact, "utf8")));
  assert.deepEqual(await validateArtifacts(root, state, { requireSystem: true }), []);
  assert.deepEqual(projectRequirements(await readFile(artifact, "utf8")).map(item => item.id), ["REQ-1"]);
  assert.deepEqual(projectMilestones(await readFile(artifact, "utf8")).map(item => item.number), [1]);
  assert.match((await validateArtifacts(root, state, { requireSystem: true, requireProjectCompletion: true })).join("\n"), /Complete or remove every roadmap milestone/);
  await writeFile(artifact, completeProject(await readFile(artifact, "utf8"), { complete: true }));
  assert.deepEqual(await validateArtifacts(root, state, { requireSystem: true, requireProjectCompletion: true }), []);
  await writeFile(artifact, (await readFile(artifact, "utf8")).replace("- Status: complete", "- Status: removed"));
  const removed = await validateArtifacts(root, state, { requireSystem: true, requireProjectCompletion: true });
  assert.match(removed.join("\n"), /REQ-1 is not covered by a roadmap milestone/);
  assert.match(removed.join("\n"), /REQ-1 is not delivered by a completed milestone/);
});

test("project source records reject external symlinks and detect source drift", async () => {
  const root = await temporaryDirectory();
  const source = path.join(root, "requirements.md");
  await writeFile(source, "Required delivery outcome.\n");
  const sources = await sourceRecords(root, ["requirements.md"]);
  const artifact = await renderProject(root, { title: "Delivery Platform", slug: "delivery-platform", sources });
  await renderSystem(root);
  await writeFile(artifact, completeProject(await readFile(artifact, "utf8")));
  const state = { type: "project", projectPath: ".agent/projects/delivery-platform.md", designPath: ".agent/projects/delivery-platform.md", sources };
  assert.deepEqual(await validateArtifacts(root, state, { requireSystem: true }), []);
  await writeFile(source, "Changed delivery outcome.\n");
  assert.match((await validateArtifacts(root, state, { requireSystem: true })).join("\n"), /source changed since ingestion/);
});
