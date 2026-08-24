import assert from "node:assert/strict";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { designContractFingerprint, projectFingerprint } from "../src/fingerprints.mjs";
import { execute, initializeGit, runCli, temporaryDirectory } from "./helpers.mjs";

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
  const stateFile = path.join(root, ".agent", ".state", "repair-search.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  state.phase = "design-critic";
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
  const stateFile = path.join(root, ".agent", ".state", "repair-search.json");
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  const fingerprint = await projectFingerprint(root);
  state.phase = "quality-critic";
  state.reviews["design-verifier"] = { contractFingerprint: await designContractFingerprint(root, state) };
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
  const tests = JSON.parse(prepared.stdout).tests;
  assert.equal(tests.length, 8);
  assert(tests.some(item => item.kind === "regression" && item.expectFail));
  assert(tests.some(item => item.kind === "regression" && !item.expectFail));
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
