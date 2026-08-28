import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { artifactFingerprint, designContractFingerprint, executableFingerprint, projectFingerprint } from "../src/fingerprints.mjs";
import { execute, initializeGit, runCli, temporaryDirectory } from "./helpers.mjs";

async function completePlan(root, slug) {
  const file = path.join(root, ".agent", "changes", `${slug}.md`);
  const content = await readFile(file, "utf8");
  await writeFile(file, content
    .replace(/(## Requirements Traceability\n)[\s\S]*?(?=\n## )/, "$11. Search behavior -> use case, interface, and tests.\n")
    .replace(/(## Boundaries and Dependencies\n)[\s\S]*?(?=\n## )/, "$11. Application owns a SearchIndex port; the storage adapter implements it outward and composition occurs at startup.\n")
    .replace(/(## (?:Abstraction and Extension Pressure|Correction and Extension Pressure)\n)[\s\S]*?(?=\n## )/, "$11. SearchIndex has a query contract owned by its application consumer and a real storage implementation.\n")
    .replace(/(## Existing Capabilities and Reuse\n)[\s\S]*?(?=\n## )/, "$11. Inspected SearchIndex; extend it because it owns search query behavior.\n")
    .replace(/(## File and Module Placement Plan\n)[\s\S]*?(?=\n## )/, "$1| Path or module | Action | Responsibility | Constraint | Slice |\n| --- | --- | --- | --- | --- |\n| src/search.js | Modify | Search application behavior | Preserve the SearchIndex boundary | 1 |\n")
    .replace(/(## Implementation Plan\n)[\s\S]*?(?=\n## )/, `$1### Slice 1: Search results are returned\n- Outcome: A query returns ranked results.\n- Entry point: Search command.\n- Core behavior: Apply ranking rules.\n- Boundary integration: Query the SearchIndex port through its storage adapter.\n- Tests: Ranking unit test and storage integration test.\n- Acceptance command: ${JSON.stringify([process.execPath, "-e", "process.exit(0)"])}\n- Complete when: The command builds and both tests pass.\n`)
    .replace(/(## Implementation Conformance\n)[\s\S]*?(?=\n## )/, "$1### Architecture Decisions\n- Decision: SearchIndex is application-owned.\n- Implementation: The storage adapter implements SearchIndex outward.\n- Verification: Ranking unit tests and storage integration tests.\n\n### Slice Completion\n#### Slice 1: Search results are returned\n- Slice: Slice 1 returns search results.\n- Implementation: Command, ranking, and storage are integrated.\n- Verification: The command builds and tests pass.\n"));
}

async function completeProject(root, slug, { complete = false } = {}) {
  const file = path.join(root, ".agent", "projects", `${slug}.md`);
  const content = await readFile(file, "utf8");
  await writeFile(file, content
    .replace(/(## Outcome\n)[\s\S]*?(?=\n## )/, "$1Teams deliver reviewed milestones with visible project completion.\n")
    .replace(/(## Non-goals\n)[\s\S]*?(?=\n## )/, "$1Automatic Git and worktree manipulation are excluded.\n")
    .replace(/(## Required Outcomes\n)[\s\S]*?(?=\n## )/, "$1### Requirement REQ-1: Deliver search\n- Outcome: Search ships as an independently reviewed milestone.\n- Acceptance: The search workflow completes its lifecycle.\n")
    .replace(/(## Known Constraints\n)[\s\S]*?(?=\n## )/, "$1Non-Git operation remains supported and no command pushes.\n")
    .replace(/(## Quality Attributes\n)[\s\S]*?(?=\n## )/, "$1Review and evidence records are candidate-fingerprinted.\n")
    .replace(/(## Decisions and Hypotheses\n)[\s\S]*?(?=\n## )/, "$1- [committed] Search is delivered through one normal feature milestone.\n")
    .replace(/(## Roadmap\n)[\s\S]*?(?=\n## )/, `$1### Milestone 1: Deliver search\n- Kind: feature\n- Outcome: Users receive search results.\n- Requirements: ["REQ-1"]\n- Dependencies: []\n- Status: ${complete ? "complete" : "active"}\n`)
    .replace(/(## Requirement Coverage\n)[\s\S]*?(?=\n## )/, `$1- REQ-1: Milestone 1 ${complete ? "complete" : "planned"}.\n`)
    .replace(/(## Completion Criteria\n)[\s\S]*?(?=\n## )/, "$1Search is reconciled and final integration passes.\n")
    .replace("- Assessment: Complete before final project review.", complete ? "- Assessment: Search and final integration satisfy completion criteria." : "- Assessment: Complete before final project review."));
}

async function markDesignApproved(root, state) {
  state.developerApproval = { fingerprint: await artifactFingerprint(root, state) };
  state.reviews["design-verifier"] = { contractFingerprint: await designContractFingerprint(root, state) };
}

test("CLI initializes and starts in a non-Git brownfield directory", async () => {
  const root = await temporaryDirectory();
  assert.equal((await runCli(root, ["init"])).code, 0);
  const started = await runCli(root, ["start", "--kind", "feature", "--title", "Add Search"]);
  assert.equal(started.code, 0, started.stderr);
  assert.match(started.stdout, /add-search/);
  assert.match(await readFile(path.join(root, ".agent", "SYSTEM.md"), "utf8"), /Use-Case Catalog/);
  const status = await runCli(root, ["status", "--json"]);
  assert.equal(JSON.parse(status.stdout).phase, "shaping");
});

test("CLI registers projects and linked milestones with project-aware review packets", async () => {
  const root = await temporaryDirectory();
  await runCli(root, ["init"]);
  await writeFile(path.join(root, "requirements.md"), "Search must be independently deliverable.\n");
  const started = await runCli(root, ["project", "start", "--title", "Search Platform", "--source", "requirements.md"]);
  assert.equal(started.code, 0, started.stderr);
  await completeProject(root, "search-platform");
  const projectStateFile = path.join(root, ".agent", ".state", "search-platform.json");
  const projectState = JSON.parse(await readFile(projectStateFile, "utf8"));
  projectState.phase = "active";
  await markDesignApproved(root, projectState);
  await writeFile(projectStateFile, `${JSON.stringify(projectState, null, 2)}\n`);

  const milestone = await runCli(root, ["start", "--kind", "feature", "--title", "Add Search", "--project", "search-platform", "--milestone", "1"]);
  assert.equal(milestone.code, 0, milestone.stderr);
  const status = JSON.parse((await runCli(root, ["status", "--json"])).stdout);
  assert.equal(status.project, "search-platform");
  assert.equal(status.milestone.number, 1);
  const listed = JSON.parse((await runCli(root, ["workflow", "list", "--json"])).stdout);
  assert.deepEqual(listed.workflows.map(item => item.slug), ["search-platform", "add-search"]);
  assert.equal(listed.workflows.filter(item => item.current).length, 1);

  await completePlan(root, "add-search");
  await runCli(root, ["advance"]);
  await runCli(root, ["feedback", "record", "--verdict", "approved"]);
  const packet = JSON.parse((await runCli(root, ["review", "prepare", "--stage", "design", "--role", "critic"])).stdout);
  assert.match(packet.project, /# Search Platform/);
  assert.match(packet.design, /# Add Search/);
  assert.match(packet.instructions, /project framing/i);
});

test("linked milestone startup rejects source drift", async () => {
  const root = await temporaryDirectory();
  await runCli(root, ["init"]);
  const source = path.join(root, "requirements.md");
  await writeFile(source, "Search must be independently deliverable.\n");
  await runCli(root, ["project", "start", "--title", "Search Platform", "--source", "requirements.md"]);
  await completeProject(root, "search-platform");
  const stateFile = path.join(root, ".agent", ".state", "search-platform.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  state.phase = "active";
  await markDesignApproved(root, state);
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  await writeFile(source, "Search requirements changed after review.\n");
  const result = await runCli(root, ["start", "--kind", "feature", "--title", "Add Search", "--project", "search-platform", "--milestone", "1"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /source changed since ingestion/);
  await assert.rejects(readFile(path.join(root, ".agent", "changes", "add-search.md")));
});

test("Git projects can start a milestone with their reviewed untracked source", async () => {
  const root = await temporaryDirectory();
  await initializeGit(root);
  await runCli(root, ["init"]);
  await writeFile(path.join(root, "requirements.md"), "Search must be independently deliverable.\n");
  const project = await runCli(root, ["project", "start", "--title", "Search Platform", "--source", "requirements.md"]);
  assert.equal(project.code, 0, project.stderr);
  await completeProject(root, "search-platform");
  const stateFile = path.join(root, ".agent", ".state", "search-platform.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  state.phase = "active";
  await markDesignApproved(root, state);
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const milestone = await runCli(root, ["start", "--kind", "feature", "--title", "Add Search", "--project", "search-platform", "--milestone", "1"]);
  assert.equal(milestone.code, 0, milestone.stderr);
});

test("project startup validates initialization before creating artifacts", async () => {
  const root = await temporaryDirectory();
  await initializeGit(root);
  const result = await runCli(root, ["project", "start", "--title", "Uninitialized Project"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Toolkit is not initialized/);
  await assert.rejects(readFile(path.join(root, ".agent", "projects", "uninitialized-project.md")));
  await assert.rejects(readFile(path.join(root, ".agent", ".state", "registry.json")));
});

test("Git rolling projects reject disabled milestone commits", async () => {
  const root = await temporaryDirectory();
  await initializeGit(root);
  await runCli(root, ["init"]);
  const configFile = path.join(root, ".agent", "config.json");
  const config = JSON.parse(await readFile(configFile, "utf8"));
  config.completion.commit.policy = "off";
  await writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`);
  const result = await runCli(root, ["project", "start", "--title", "Uncommitted Project"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /require completion\.commit\.policy to be if-git/);
  await assert.rejects(readFile(path.join(root, ".agent", "projects", "uncommitted-project.md")));
});

test("non-Git workflow selection validates every target candidate and same-current selection is a no-op", async () => {
  const root = await temporaryDirectory();
  await runCli(root, ["init"]);
  await runCli(root, ["start", "--kind", "feature", "--title", "First Change"]);
  await runCli(root, ["start", "--kind", "feature", "--title", "Second Change"]);
  assert.equal((await runCli(root, ["workflow", "select", "first-change"])).code, 0);
  await writeFile(path.join(root, "candidate.js"), "export const candidate = true;\n");
  assert.equal((await runCli(root, ["workflow", "select", "first-change"])).code, 0);
  const blocked = await runCli(root, ["workflow", "select", "second-change"]);
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr, /Restore the executable candidate for second-change/);
  const startBlocked = await runCli(root, ["start", "--kind", "fix", "--title", "Third Change"]);
  assert.equal(startBlocked.code, 1);
  assert.match(startBlocked.stderr, /Finish or restore the executable candidate for first-change/);
});

test("CLI provides top-level and command-specific help without project state", async () => {
  const root = await temporaryDirectory();
  const top = await runCli(root, []);
  assert.equal(top.code, 0, top.stderr);
  assert.match(top.stdout, /Commands:/);
  assert.match(top.stdout, /feedback\s+Record developer approval/);
  const start = await runCli(root, ["start", "--help"]);
  assert.equal(start.code, 0, start.stderr);
  assert.match(start.stdout, /--kind feature\|fix/);
  const feedback = await runCli(root, ["help", "feedback"]);
  assert.equal(feedback.code, 0, feedback.stderr);
  assert.match(feedback.stdout, /--note/);
  const help = await runCli(root, ["help", "--help"]);
  assert.equal(help.code, 0, help.stderr);
  assert.match(help.stdout, /help \[command\]/);
});

test("CLI pauses for developer feedback and supports requested revisions", async () => {
  const root = await temporaryDirectory();
  await runCli(root, ["init"]);
  await runCli(root, ["start", "--kind", "feature", "--title", "Add Search"]);
  await completePlan(root, "add-search");
  const advanced = await runCli(root, ["advance"]);
  assert.equal(advanced.code, 0, advanced.stderr);
  assert.match(advanced.stdout, /developer-review/);
  const requested = await runCli(root, ["feedback", "record", "--verdict", "changes-requested", "--note", "Clarify ranking", "--note", "Split indexing"]);
  assert.equal(requested.code, 0, requested.stderr);
  assert.match(requested.stdout, /Phase: shaping/);
  await runCli(root, ["advance"]);
  const approved = await runCli(root, ["feedback", "record", "--verdict", "approved"]);
  assert.equal(approved.code, 0, approved.stderr);
  assert.match(approved.stdout, /Phase: design-critic/);
  const status = JSON.parse((await runCli(root, ["status", "--json"])).stdout);
  assert.equal(status.developerFeedback.verdict, "approved");
});

test("status excludes findings retired by an abandoned review cycle", async () => {
  const root = await temporaryDirectory();
  await runCli(root, ["init"]);
  await runCli(root, ["start", "--kind", "feature", "--title", "Retire Review"]);
  const stateFile = path.join(root, ".agent", ".state", "retire-review.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  state.findings.push({ id: "retired", stage: "design", resolved: false, retired: true });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const result = await runCli(root, ["status", "--json"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).unresolvedFindings, 0);
});

test("status keeps pending dispositions unresolved until verifier approval", async () => {
  const root = await temporaryDirectory();
  await runCli(root, ["init"]);
  await runCli(root, ["start", "--kind", "feature", "--title", "Pending Disposition"]);
  const stateFile = path.join(root, ".agent", ".state", "pending-disposition.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  state.findings.push({ id: "pending", stage: "design", status: "disposition-pending", resolved: false });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const status = JSON.parse((await runCli(root, ["status", "--json"])).stdout);
  assert.equal(status.unresolvedFindings, 1);
  assert.equal(status.findings["disposition-pending"], 1);
});

test("review packets distinguish critic discovery from verifier closure", async () => {
  const root = await temporaryDirectory();
  await runCli(root, ["init"]);
  await runCli(root, ["start", "--kind", "feature", "--title", "Add Search"]);
  await completePlan(root, "add-search");
  await runCli(root, ["advance"]);
  await runCli(root, ["feedback", "record", "--verdict", "approved"]);

  const criticResult = await runCli(root, ["review", "prepare", "--stage", "design", "--role", "critic"]);
  assert.equal(criticResult.code, 0, criticResult.stderr);
  const critic = JSON.parse(criticResult.stdout);
  assert.equal(critic.protocol, 3);
  assert.match(critic.instructions, /one comprehensive discovery pass/i);
  assert.match(critic.instructions, /file\/module placement plan/);
  assert.equal(critic.outputSchema.type, "object");
  assert.deepEqual(critic.outputSchema.properties.findings.items.required, ["severity", "description", "contractReference", "evidence", "observableImpact"]);
  assert.deepEqual(critic.outputSchema.properties.findings.items.properties.severity.enum, ["high", "medium"]);
  const criticFindings = path.join(root, critic.findingsPath);
  await writeFile(criticFindings, JSON.stringify({ findings: [] }));
  const recorded = await runCli(root, ["review", "record", "--packet", critic.id, "--verdict", "approved", "--reviewer", "critic-session", "--findings", criticFindings]);
  assert.equal(recorded.code, 0, recorded.stderr);

  const verifierResult = await runCli(root, ["review", "prepare", "--stage", "design", "--role", "verifier"]);
  assert.equal(verifierResult.code, 0, verifierResult.stderr);
  const verifier = JSON.parse(verifierResult.stdout);
  assert.match(verifier.instructions, /closure review, not a second critic pass/i);
  assert.deepEqual(verifier.findings, []);
  assert.equal(verifier.outputSchema.properties.findings.items, false);
});

test("CLI blocks startup around unrelated dirty Git changes", async () => {
  const root = await temporaryDirectory();
  await initializeGit(root);
  assert.equal((await runCli(root, ["init"])).code, 0);
  await writeFile(path.join(root, "unrelated.txt"), "user work\n");
  const result = await runCli(root, ["start", "--kind", "feature", "--title", "Add Search"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /unexpected changes/);
});

test("disabled start issue fails before creating change state", async () => {
  const root = await temporaryDirectory();
  await runCli(root, ["init"]);
  const result = await runCli(root, ["start", "--kind", "feature", "--title", "Add Search", "--issue", "42"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /requires github\.issues\.policy/);
  const status = await runCli(root, ["status"]);
  assert.equal(status.code, 0);
  assert.match(status.stdout, /No current workflow/);
});

test("review packets include bounded test output", async () => {
  const root = await temporaryDirectory();
  await runCli(root, ["init"]);
  await runCli(root, ["start", "--kind", "fix", "--title", "Repair Search"]);
  await completePlan(root, "repair-search");
  const stateFile = path.join(root, ".agent", ".state", "repair-search.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  state.phase = "design-critic";
  await markDesignApproved(root, state);
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const evidence = await runCli(root, ["test", "--kind", "regression", "--expect-fail", "--", process.execPath, "-e", "console.error('x'.repeat(2000) + 'diagnostic-marker'); process.exit(1)"]);
  assert.equal(evidence.code, 0, evidence.stderr);
  const prepared = await runCli(root, ["review", "prepare", "--stage", "design", "--role", "critic"]);
  assert.equal(prepared.code, 0, prepared.stderr);
  const output = JSON.parse(prepared.stdout).tests[0].output;
  assert.match(output, /diagnostic-marker/);
  assert(output.length <= 1000);
});

test("fix packets retain distinct evidence summaries and bound detailed output", async () => {
  const root = await temporaryDirectory();
  await runCli(root, ["init"]);
  await runCli(root, ["start", "--kind", "fix", "--title", "Repair Search"]);
  await completePlan(root, "repair-search");
  const stateFile = path.join(root, ".agent", ".state", "repair-search.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const fingerprint = await projectFingerprint(root);
  const evidenceFingerprint = await executableFingerprint(root);
  state.phase = "quality-critic";
  await markDesignApproved(root, state);
  state.baseline = { fingerprint };
  state.evidence = [{ id: "failure", kind: "regression", expectFail: true, command: ["test", "regression"], code: 1, output: "observed failure", fingerprint: "before" }];
  state.regression = { evidenceId: "failure", command: ["test", "regression"] };
  state.evidence.push({ kind: "regression", expectFail: false, command: ["test", "regression"], code: 0, output: "regression passed", fingerprint: evidenceFingerprint });
  for (let index = 0; index < 8; index += 1) {
    state.evidence.push({ kind: "unit", expectFail: false, command: ["test", String(index)], code: 0, output: "passed", fingerprint: evidenceFingerprint });
  }
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const prepared = await runCli(root, ["review", "prepare", "--stage", "quality", "--role", "critic"]);
  assert.equal(prepared.code, 0, prepared.stderr);
  const packet = JSON.parse(prepared.stdout);
  assert.match(packet.instructions, /concrete infrastructure leaking into inward policy/);
  assert.match(packet.instructions, /AGENTS\.md module constraint/);
  const tests = packet.tests;
  assert.equal(tests.length, 10);
  assert.equal(tests.filter(item => !item.outputOmitted).length, 8);
  assert(tests.some(item => item.kind === "regression" && item.expectFail));
  assert(tests.some(item => item.kind === "regression" && !item.expectFail));
  const findingsPath = path.join(root, packet.findingsPath);
  await writeFile(findingsPath, JSON.stringify({ findings: [{
    severity: "medium",
    description: "Concrete storage leaked into application policy",
    contractReference: "Reviewed dependency direction",
    evidence: "The candidate imports the storage adapter from application policy",
    observableImpact: "Application policy is coupled to concrete storage"
  }] }));
  const recorded = await runCli(root, ["review", "record", "--packet", packet.id, "--verdict", "changes-requested", "--reviewer", "quality-critic", "--findings", findingsPath]);
  assert.equal(recorded.code, 0, recorded.stderr);
});

test("sealed commit creation produces one conventional commit and never pushes", async () => {
  const root = await temporaryDirectory();
  await initializeGit(root);
  await runCli(root, ["init"]);
  await runCli(root, ["start", "--kind", "feature", "--title", "Add Search"]);
  const stateFile = path.join(root, ".agent", ".state", "add-search.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  await writeFile(path.join(root, "search.js"), "export const search = value => value;\n");
  const fingerprint = await projectFingerprint(root);
  const evidenceFingerprint = await executableFingerprint(root);
  state.phase = "ready-to-commit";
  await markDesignApproved(root, state);
  state.reviews["quality-verifier"] = { verdict: "approved", fingerprint };
  state.evidence.push({ kind: "unit", expectFail: false, code: 0, fingerprint: evidenceFingerprint });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const prepared = await runCli(root, ["commit", "prepare"]);
  assert.equal(prepared.code, 0, prepared.stderr);
  assert.match(prepared.stdout, /feat: add search/);
  const committed = await runCli(root, ["commit", "create"]);
  assert.equal(committed.code, 0, committed.stderr);
  const log = await execute("git", ["log", "-1", "--pretty=%s"], root);
  assert.equal(log.stdout.trim(), "feat: add search");
  const gitStatus = await execute("git", ["status", "--porcelain"], root);
  assert.equal(gitStatus.stdout, "");
  const remotes = await execute("git", ["remote"], root);
  assert.equal(remotes.stdout, "");
});

test("commit hooks cannot alter the reviewed tree", async () => {
  const root = await temporaryDirectory();
  await initializeGit(root);
  await runCli(root, ["init"]);
  await runCli(root, ["start", "--kind", "feature", "--title", "Add Search"]);
  const stateFile = path.join(root, ".agent", ".state", "add-search.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  await writeFile(path.join(root, "search.js"), "export const search = value => value;\n");
  const fingerprint = await projectFingerprint(root);
  const evidenceFingerprint = await executableFingerprint(root);
  state.phase = "ready-to-commit";
  await markDesignApproved(root, state);
  state.reviews["quality-verifier"] = { verdict: "approved", fingerprint };
  state.evidence.push({ kind: "unit", expectFail: false, code: 0, fingerprint: evidenceFingerprint });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  assert.equal((await runCli(root, ["commit", "prepare"])).code, 0);
  const hook = path.join(root, ".git", "hooks", "pre-commit");
  await writeFile(hook, "#!/bin/sh\nprintf 'unreviewed\\n' > injected.js\ngit add injected.js\n");
  await chmod(hook, 0o755);
  const result = await runCli(root, ["commit", "create"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /hook changed the reviewed tree/);
  const count = await execute("git", ["rev-list", "--count", "HEAD"], root);
  assert.equal(count.stdout.trim(), "1");
});

test("commit hooks cannot alter unstaged candidate files", async () => {
  const root = await temporaryDirectory();
  await initializeGit(root);
  await runCli(root, ["init"]);
  await runCli(root, ["start", "--kind", "feature", "--title", "Add Search"]);
  const stateFile = path.join(root, ".agent", ".state", "add-search.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  await writeFile(path.join(root, "search.js"), "export const search = value => value;\n");
  const fingerprint = await projectFingerprint(root);
  const evidenceFingerprint = await executableFingerprint(root);
  state.phase = "ready-to-commit";
  await markDesignApproved(root, state);
  state.reviews["quality-verifier"] = { verdict: "approved", fingerprint };
  state.evidence.push({ kind: "unit", expectFail: false, code: 0, fingerprint: evidenceFingerprint });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  assert.equal((await runCli(root, ["commit", "prepare"])).code, 0);
  const hook = path.join(root, ".git", "hooks", "pre-commit");
  await writeFile(hook, "#!/bin/sh\nprintf 'changed\\n' > search.js\n");
  await chmod(hook, 0o755);
  const result = await runCli(root, ["commit", "create"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /hook changed the reviewed worktree/);
  assert.equal(await readFile(path.join(root, "search.js"), "utf8"), "export const search = value => value;\n");
  const count = await execute("git", ["rev-list", "--count", "HEAD"], root);
  assert.equal(count.stdout.trim(), "1");
});

test("post-commit hook failures do not invalidate a reviewed commit", async () => {
  const root = await temporaryDirectory();
  await initializeGit(root);
  await runCli(root, ["init"]);
  await runCli(root, ["start", "--kind", "feature", "--title", "Add Search"]);
  const stateFile = path.join(root, ".agent", ".state", "add-search.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  await writeFile(path.join(root, "search.js"), "export const search = value => value;\n");
  const fingerprint = await projectFingerprint(root);
  const evidenceFingerprint = await executableFingerprint(root);
  state.phase = "ready-to-commit";
  await markDesignApproved(root, state);
  state.reviews["quality-verifier"] = { verdict: "approved", fingerprint };
  state.evidence.push({ kind: "unit", expectFail: false, code: 0, fingerprint: evidenceFingerprint });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  assert.equal((await runCli(root, ["commit", "prepare"])).code, 0);
  const hook = path.join(root, ".git", "hooks", "post-commit");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  const result = await runCli(root, ["commit", "create"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(stateFile, "utf8")).phase, "complete");
});

test("commit creation recovers when state was not persisted after HEAD advanced", async () => {
  const root = await temporaryDirectory();
  await initializeGit(root);
  await runCli(root, ["init"]);
  await runCli(root, ["start", "--kind", "feature", "--title", "Add Search"]);
  const stateFile = path.join(root, ".agent", ".state", "add-search.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  await writeFile(path.join(root, "search.js"), "export const search = value => value;\n");
  const fingerprint = await projectFingerprint(root);
  const evidenceFingerprint = await executableFingerprint(root);
  state.phase = "ready-to-commit";
  await markDesignApproved(root, state);
  state.reviews["quality-verifier"] = { verdict: "approved", fingerprint };
  state.evidence.push({ kind: "unit", expectFail: false, code: 0, fingerprint: evidenceFingerprint });
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  assert.equal((await runCli(root, ["commit", "prepare"])).code, 0);
  const preparedState = await readFile(stateFile, "utf8");
  assert.equal((await runCli(root, ["commit", "create"])).code, 0);
  const plan = JSON.parse(preparedState).commitPlan;
  assert.equal((await execute("git", ["rev-parse", "HEAD^{tree}"], root)).stdout.trim(), plan.tree);
  assert.equal((await execute("git", ["rev-parse", "HEAD^"], root)).stdout.trim(), plan.baseHead);
  assert.equal((await execute("git", ["show", "-s", "--format=%B", "HEAD"], root)).stdout.trim(), `${plan.subject}\n\n${plan.body}`);
  await writeFile(stateFile, preparedState);
  const recovered = await runCli(root, ["commit", "create"]);
  assert.equal(recovered.code, 0, recovered.stderr);
  assert.equal(JSON.parse(await readFile(stateFile, "utf8")).phase, "complete");
});
