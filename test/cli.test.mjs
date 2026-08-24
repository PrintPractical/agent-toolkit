import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { artifactFingerprint, designContractFingerprint, projectFingerprint } from "../src/fingerprints.mjs";
import { execute, initializeGit, runCli, temporaryDirectory } from "./helpers.mjs";

async function completePlan(root, slug) {
  const file = path.join(root, ".agent", "changes", `${slug}.md`);
  const content = await readFile(file, "utf8");
  await writeFile(file, content
    .replace(/(## Requirements Traceability\n)[\s\S]*?(?=\n## )/, "$11. Search behavior -> use case, interface, and tests.\n")
    .replace(/(## Boundaries and Dependencies\n)[\s\S]*?(?=\n## )/, "$11. Application owns a SearchIndex port; the storage adapter implements it outward and composition occurs at startup.\n")
    .replace(/(## (?:Abstraction and Extension Pressure|Correction and Extension Pressure)\n)[\s\S]*?(?=\n## )/, "$11. SearchIndex has a query contract owned by its application consumer and a real storage implementation.\n")
    .replace(/(## Implementation Plan\n)[\s\S]*?(?=\n## )/, "$1### Slice 1: Search results are returned\n- Outcome: A query returns ranked results.\n- Entry point: Search command.\n- Core behavior: Apply ranking rules.\n- Boundary integration: Query the SearchIndex port through its storage adapter.\n- Tests: Ranking unit test and storage integration test.\n- Complete when: The command builds and both tests pass.\n")
    .replace(/(## Implementation Conformance\n)[\s\S]*?(?=\n## )/, "$1### Architecture Decisions\n- Decision: SearchIndex is application-owned.\n- Implementation: The storage adapter implements SearchIndex outward.\n- Verification: Ranking unit tests and storage integration tests.\n\n### Slice Completion\n- Slice: Slice 1 returns search results.\n- Implementation: Command, ranking, and storage are integrated.\n- Verification: The command builds and tests pass.\n"));
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
  assert.equal(critic.protocol, 2);
  assert.match(critic.instructions, /one comprehensive discovery pass/i);
  assert.equal(critic.outputSchema.type, "object");
  assert.deepEqual(critic.outputSchema.properties.findings.items.required, ["severity", "description"]);
  assert.deepEqual(critic.outputSchema.properties.findings.items.properties.severity.enum, ["high", "medium"]);
  await runCli(root, ["review", "record", "--packet", critic.id, "--verdict", "approved", "--reviewer", "critic-session"]);

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
  assert.equal(status.code, 1);
  assert.match(status.stderr, /No active change/);
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

test("bounded fix packets retain the historical regression failure", async () => {
  const root = await temporaryDirectory();
  await runCli(root, ["init"]);
  await runCli(root, ["start", "--kind", "fix", "--title", "Repair Search"]);
  await completePlan(root, "repair-search");
  const stateFile = path.join(root, ".agent", ".state", "repair-search.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const fingerprint = await projectFingerprint(root);
  state.phase = "quality-critic";
  await markDesignApproved(root, state);
  state.baseline = { fingerprint };
  state.evidence = [{ id: "failure", kind: "regression", expectFail: true, command: ["test", "regression"], code: 1, output: "observed failure", fingerprint: "before" }];
  state.regression = { evidenceId: "failure", command: ["test", "regression"] };
  state.evidence.push({ kind: "regression", expectFail: false, command: ["test", "regression"], code: 0, output: "regression passed", fingerprint });
  for (let index = 0; index < 8; index += 1) {
    state.evidence.push({ kind: "unit", expectFail: false, command: ["test", String(index)], code: 0, output: "passed", fingerprint });
  }
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  const prepared = await runCli(root, ["review", "prepare", "--stage", "quality", "--role", "critic"]);
  assert.equal(prepared.code, 0, prepared.stderr);
  const packet = JSON.parse(prepared.stdout);
  assert.match(packet.instructions, /Concrete infrastructure leaking into inward policy/);
  const tests = packet.tests;
  assert.equal(tests.length, 8);
  assert(tests.some(item => item.kind === "regression" && item.expectFail));
  assert(tests.some(item => item.kind === "regression" && !item.expectFail));
  const findingsPath = path.join(root, packet.findingsPath);
  await writeFile(findingsPath, JSON.stringify({ findings: [{ severity: "medium", description: "Concrete storage leaked into application policy" }] }));
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
  state.phase = "ready-to-commit";
  await markDesignApproved(root, state);
  state.reviews["quality-verifier"] = { verdict: "approved", fingerprint };
  state.evidence.push({ kind: "unit", expectFail: false, code: 0, fingerprint });
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
  state.phase = "ready-to-commit";
  await markDesignApproved(root, state);
  state.reviews["quality-verifier"] = { verdict: "approved", fingerprint };
  state.evidence.push({ kind: "unit", expectFail: false, code: 0, fingerprint });
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
  state.phase = "ready-to-commit";
  await markDesignApproved(root, state);
  state.reviews["quality-verifier"] = { verdict: "approved", fingerprint };
  state.evidence.push({ kind: "unit", expectFail: false, code: 0, fingerprint });
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
  state.phase = "ready-to-commit";
  await markDesignApproved(root, state);
  state.reviews["quality-verifier"] = { verdict: "approved", fingerprint };
  state.evidence.push({ kind: "unit", expectFail: false, code: 0, fingerprint });
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
  state.phase = "ready-to-commit";
  await markDesignApproved(root, state);
  state.reviews["quality-verifier"] = { verdict: "approved", fingerprint };
  state.evidence.push({ kind: "unit", expectFail: false, code: 0, fingerprint });
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
