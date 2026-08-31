import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { projectMilestones, projectRequirements, renderChange, renderProject, renderSystem, responsibilityArchitectureMap, responsibilityDecomposition, slugify, sourceRecords, validateArtifacts } from "../src/artifacts.mjs";
import { temporaryDirectory } from "./helpers.mjs";

function completeArtifact(content) {
  return content
    .replace(/(## Requirements Traceability\n)[\s\S]*?(?=\n## )/, "$11. SUPPORTED: Payment requirement -> reproduction, rule, and tests.\n")
    .replace(/(## Responsibility Decomposition\n)[\s\S]*?(?=\n## )/, "$1| Owner | Responsibility | Rules / Decisions | Architectural Role | Depends On | Used By | Existing/New | Reuse Decision |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| PaymentPolicy | Payment validity rules | Reject invalid payment state | Policy owner required by project instructions | None | Payment command | New | NEW: repository search found no authoritative payment policy; a cohesive owner is required |\n| PaymentStore | Durable payment access | Preserve transaction failure behavior | Storage integration boundary | Database | Payment command | Existing | EXTEND: inspected PaymentStore, which owns payment persistence; extend the authoritative owner instead of copying it |\n")
    .replace(/(## (?:Abstraction and Extension Pressure|Correction and Extension Pressure)\n)[\s\S]*?(?=\n## )/, "$11. PaymentStore provides the persistence behavior needed by payments.\n")
    .replace(/(## Simplicity and Change Budget\n)[\s\S]*?(?=\n## )/, "$1- Smallest viable approach: Extend PaymentStore and add one focused policy owner.\n- Expected production code change: About 80 lines; tests and generated files excluded.\n- Expected files and owners affected: Two source files for PaymentPolicy and PaymentStore.\n- Largest source file impact: PaymentStore grows by about 40 lines and remains cohesive.\n- New dependencies or abstractions: PaymentPolicy only; no dependency.\n- Reassessment trigger: Stop if production growth exceeds 120 lines or another owner is needed.\n")
    .replace(/(## Responsibility and Architecture Map\n)[\s\S]*?(?=\n## )/, "$1| Owner | Expected Placement | Placement Constraints | Slices |\n| --- | --- | --- | --- |\n| PaymentPolicy | src/payment-policy.js | Keep policy independent of storage details | [1] |\n| PaymentStore | src/payment-store.js | Existing storage boundary remains authoritative | [1] |\n")
    .replace(/(## Implementation Plan\n)[\s\S]*?(?=\n## )/, "$1### Slice 1: Payment behavior is restored\n- Outcome: A payment succeeds.\n- Owners: [\"PaymentPolicy\", \"PaymentStore\"]\n- Entry point: Payment command.\n- Core behavior: Enforce payment rules.\n- Boundary integration: Persist atomically through PaymentStore.\n- Tests: Regression and database integration tests.\n- Acceptance command: [\"node\", \"--test\"]\n- Complete when: The command builds and tests pass.\n")
    .replace(/(## Implementation Conformance\n)[\s\S]*?(?=\n## )/, "$1### Architecture Decisions\n- Decision: Payments use PaymentStore for persistence.\n- Owners: [\"PaymentPolicy\", \"PaymentStore\"]\n- Implementation: The payment command uses the existing store.\n- Verification: Unit and database integration tests.\n\n### Complexity Reconciliation\n- Production code changed: 76 lines across two source files.\n- Largest source file: PaymentStore is 240 lines after growing by 38.\n- Dependencies or abstractions added: PaymentPolicy only; no dependency.\n- Budget outcome: Within the reviewed budget.\n\n### Slice Completion\n#### Slice 1: Payment behavior is restored\n- Slice: Slice 1 restores payment behavior.\n- Implementation: Command, rules, and persistence are integrated.\n- Verification: The command builds and regression tests pass.\n");
}

function completeProject(content, { complete = false } = {}) {
  return content
    .replace(/(## Outcome\n)[\s\S]*?(?=\n## )/, "$1Teams can safely deliver reviewed milestones and recognize completion from recorded integration evidence.\n")
    .replace(/(## Non-goals\n)[\s\S]*?(?=\n## )/, "$1Automated worktree management and predictive architecture are excluded.\n")
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
  const state = { designPath: `.agent/changes/${slug}.md`, artifactFormat: 5 };
  assert.match((await validateArtifacts(root, state, { requireSystem: true })).join("\n"), /Implementation Plan/);
  const content = await readFile(design, "utf8");
  await writeFile(design, completeArtifact(content));
  assert.deepEqual(await validateArtifacts(root, state, { requireSystem: true }), []);
});

test("current artifacts require responsibility decomposition before architecture placement", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const state = { designPath: ".agent/changes/export-data.md", artifactFormat: 5 };
  const initialProblems = await validateArtifacts(root, state, { requireSystem: true });
  assert.match(initialProblems.join("\n"), /Responsibility Decomposition/);
  assert.match(initialProblems.join("\n"), /Responsibility and Architecture Map/);
  const completed = completeArtifact(await readFile(design, "utf8"));
  await writeFile(design, completed);
  assert.deepEqual(await validateArtifacts(root, state, { requireSystem: true }), []);
  assert.deepEqual(responsibilityDecomposition(completed).map(item => item.owner), ["PaymentPolicy", "PaymentStore"]);
  assert.deepEqual(responsibilityArchitectureMap(completed).map(item => item.owner), ["PaymentPolicy", "PaymentStore"]);
  const architectureSection = completed.match(/## Responsibility and Architecture Map\n[\s\S]*?(?=\n## )/)[0];
  const reordered = completed.replace(`${architectureSection}\n`, "").replace("## Responsibility Decomposition", `${architectureSection}\n\n## Responsibility Decomposition`);
  await writeFile(design, reordered);
  assert.match((await validateArtifacts(root, state, { requireSystem: true })).join("\n"), /must precede architecture placement/);
  const planSection = completed.match(/## Implementation Plan\n[\s\S]*?(?=\n## )/)[0];
  const planBeforeMap = completed.replace(`${planSection}\n`, "").replace("## Responsibility and Architecture Map", `${planSection}\n\n## Responsibility and Architecture Map`);
  await writeFile(design, planBeforeMap);
  assert.match((await validateArtifacts(root, state, { requireSystem: true })).join("\n"), /must precede implementation slices/);
  await writeFile(design, completed.replace(/## Responsibility and Architecture Map\n[\s\S]*?(?=\n## )/, ""));
  assert.match((await validateArtifacts(root, state, { requireSystem: true })).join("\n"), /Responsibility and Architecture Map/);
});

test("current artifacts require authoritative reuse decisions and owner coverage", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const state = { designPath: ".agent/changes/export-data.md", artifactFormat: 5 };
  const completed = completeArtifact(await readFile(design, "utf8"));
  await writeFile(design, completed
    .replace("EXTEND: inspected PaymentStore, which owns payment persistence; extend the authoritative owner instead of copying it", "COPY: add another payment store")
    .replace('| PaymentStore | src/payment-store.js | Existing storage boundary remains authoritative | [1] |\n', ""));
  const problems = (await validateArtifacts(root, state, { requireSystem: true })).join("\n");
  assert.match(problems, /Reuse Decision must be REUSE, EXTEND, REFACTOR, or NEW/);
  assert.match(problems, /architecture map is missing owner: PaymentStore/i);
});

test("responsibility tables require complete rows and evidence with rationale", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const completed = completeArtifact(await readFile(design, "utf8"));
  await writeFile(design, completed
    .replace("NEW: repository search found no authoritative payment policy; a cohesive owner is required", "NEW: unchecked")
    .replace("| PaymentStore | Durable payment access |", "| PaymentStore | Durable | payment access |")
    .replace("| PaymentStore | src/payment-store.js | Existing storage boundary remains authoritative | [1] |", "| PaymentStore | src/payment-store.js | Existing storage boundary remains authoritative | [1]"));
  const problems = (await validateArtifacts(root, { designPath: ".agent/changes/export-data.md" }, { requireSystem: true })).join("\n");
  assert.match(problems, /malformed table row/);
  assert.match(problems, /Architecture Map contains a malformed table row/);
  assert.match(problems, /inspected evidence and rationale/);
});

test("one cohesive responsibility owner and one slice are valid", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Validate Payment", slug: "validate-payment" });
  await renderSystem(root);
  const completed = completeArtifact(await readFile(design, "utf8"))
    .replace(/^\| PaymentStore \|.*\n/gm, "")
    .replaceAll('["PaymentPolicy", "PaymentStore"]', '["PaymentPolicy"]');
  await writeFile(design, completed);
  assert.deepEqual(await validateArtifacts(root, { designPath: ".agent/changes/validate-payment.md", phase: "quality-critic" }, { requireSystem: true }), []);
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
    .replace(/(## Implementation Plan\n)[\s\S]*?(?=\n## )/, "$1### Slice 1: Export request is accepted\n- Outcome: A request starts an export.\n- Owners: [\"PaymentPolicy\"]\n- Entry point: Export command.\n- Core behavior: Validate export rules.\n- Boundary integration: Save through ExportStore.\n- Tests: Rule and integration tests.\n- Acceptance command: [\"node\", \"--test\"]\n- Complete when: The command builds and tests pass.\n\n### Phase 2: Persistence\nAdd storage details.\n\n### Slice 3: Export downloads\n- Outcome: The export downloads.\n- Owners: [\"PaymentStore\"]\n- Entry point: Download command.\n- Core behavior: Select export data.\n- Boundary integration: Read through ExportStore.\n- Tests: Download integration test.\n- Acceptance command: [\"node\", \"--test\"]\n- Complete when: Download passes.\n");
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

test("current artifacts require a concrete simplicity and change budget", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const completed = completeArtifact(await readFile(design, "utf8"));
  await writeFile(design, completed.replace("- Reassessment trigger: Stop if production growth exceeds 120 lines or another owner is needed.", "- Reassessment trigger:"));
  const problems = await validateArtifacts(root, { designPath: ".agent/changes/export-data.md" }, { requireSystem: true });
  assert.match(problems.join("\n"), /Complete the Simplicity and Change Budget/);
});

test("quality review requires actual complexity reconciliation", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const completed = completeArtifact(await readFile(design, "utf8"));
  await writeFile(design, completed.replace("- Budget outcome: Within the reviewed budget.", "- Budget outcome:"));
  const problems = await validateArtifacts(root, { designPath: ".agent/changes/export-data.md", phase: "quality-critic" }, { requireSystem: true });
  assert.match(problems.join("\n"), /Complexity Reconciliation/);
});

test("quality conformance covers every reviewed responsibility owner", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const completed = completeArtifact(await readFile(design, "utf8")).replace('["PaymentPolicy", "PaymentStore"]\n- Implementation:', '["PaymentPolicy"]\n- Implementation:');
  await writeFile(design, completed);
  const problems = await validateArtifacts(root, { designPath: ".agent/changes/export-data.md", phase: "quality-critic" }, { requireSystem: true });
  assert.match(problems.join("\n"), /covering every reviewed responsibility owner exactly once/);
});

test("new artifacts reject combined slice claims and non-executable acceptance", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Export Data", slug: "export-data" });
  await renderSystem(root);
  const content = completeArtifact(await readFile(design, "utf8"))
    .replace('["node", "--test"]', "cargo test")
    .replace("#### Slice 1: Payment behavior is restored", "#### Slice 1-3: Baseline");
  await writeFile(design, content);
  const problems = await validateArtifacts(root, {
    designPath: ".agent/changes/export-data.md",
    artifactFormat: 5,
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
  const design = await renderChange(root, { kind: "feature", title: "Model Complex Behavior", slug: "model-complex-behavior" });
  await renderSystem(root);
  const content = completeArtifact(await readFile(design, "utf8"));
  await writeFile(design, `${content}\n${"Detailed design evidence.\n".repeat(800)}`);
  const system = path.join(root, ".agent", "SYSTEM.md");
  await writeFile(system, `${await readFile(system, "utf8")}\n${"Durable system evidence.\n".repeat(800)}`);
  assert.deepEqual(await validateArtifacts(root, { designPath: ".agent/changes/model-complex-behavior.md" }, { requireSystem: true }), []);
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
