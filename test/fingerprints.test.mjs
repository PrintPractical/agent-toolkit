import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderChange, renderSystem } from "../src/artifacts.mjs";
import { prepareCommit } from "../src/commit.mjs";
import { DEFAULT_CONFIG } from "../src/config.mjs";
import { candidateSnapshot, designContractFingerprint, executableFingerprint, projectFingerprint, projectSnapshot } from "../src/fingerprints.mjs";
import { statusPaths } from "../src/git.mjs";
import { execute, initializeGit, temporaryDirectory } from "./helpers.mjs";

test("file and module placement remains part of the reviewed design contract", async () => {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind: "feature", title: "Place Modules", slug: "place-modules" });
  await renderSystem(root);
  const state = { type: "change", designPath: ".agent/changes/place-modules.md" };
  const initial = await designContractFingerprint(root, state);
  const content = await readFile(design, "utf8");
  await writeFile(design, content.replace(
    /(## File and Module Placement Plan\n)[\s\S]*?(?=\n## )/,
    "$1- `src/results.js`: own result rules.\n"
  ));
  const placementChanged = await designContractFingerprint(root, state);
  assert.notEqual(placementChanged, initial);
  await writeFile(design, (await readFile(design, "utf8")).replace(
    /(## Implementation Conformance\n)[\s\S]*?(?=\n## )/,
    "$1Placement differed only by filename.\n"
  ));
  assert.equal(await designContractFingerprint(root, state), placementChanged);
});

test("Git candidates include their base commit and untracked content", async () => {
  const root = await temporaryDirectory();
  await initializeGit(root);
  const first = await projectFingerprint(root);
  await execute("git", ["commit", "--allow-empty", "-q", "-m", "chore: move base"], root);
  const second = await projectFingerprint(root);
  assert.notEqual(second, first);

  await writeFile(path.join(root, "new.txt"), "review me\n");
  await writeFile(path.join(root, "README.md"), "# Changed\n");
  const snapshot = await projectSnapshot(root);
  assert.equal(snapshot.repository, "git");
  assert(snapshot.head);
  assert.deepEqual(snapshot.changes.find(item => item.path === "new.txt"), {
    path: "new.txt",
    status: "added",
    before: null,
    mode: "100644",
    encoding: "utf8",
    content: "review me\n"
  });
  assert.equal(snapshot.changes.find(item => item.path === "README.md").before.content, "# Test project\n");
});

test("Git candidates preserve paths that require quoted display output", async () => {
  const root = await temporaryDirectory();
  await initializeGit(root);
  const names = ["tab\tname.txt", "line\nname.txt", "caf\u00e9.txt"];
  for (const name of names) await writeFile(path.join(root, name), `${name}\n`);
  const before = await projectSnapshot(root);
  for (const name of names) assert(before.changes.some(item => item.path === name));
  assert.deepEqual(new Set(await statusPaths(root)), new Set(names));
  const fingerprint = await projectFingerprint(root);
  await execute("git", ["add", "-A"], root);
  assert.equal(await projectFingerprint(root), fingerprint);
});

test("Git candidates include changed submodule revisions", async () => {
  const root = await temporaryDirectory();
  const child = await temporaryDirectory();
  await initializeGit(root);
  await initializeGit(child);
  await execute("git", ["-c", "protocol.file.allow=always", "submodule", "add", "-q", child, "vendor/child"], root);
  await execute("git", ["commit", "-q", "-am", "chore: add child"], root);
  const before = await projectFingerprint(root);
  await writeFile(path.join(child, "change.txt"), "next\n");
  await execute("git", ["add", "change.txt"], child);
  await execute("git", ["commit", "-q", "-m", "feat: change child"], child);
  await execute("git", ["-C", path.join(root, "vendor/child"), "fetch", "-q"], root);
  await execute("git", ["-C", path.join(root, "vendor/child"), "checkout", "-q", "FETCH_HEAD"], root);
  assert.notEqual(await projectFingerprint(root), before);
  const snapshot = await projectSnapshot(root);
  const change = snapshot.changes.find(item => item.path === "vendor/child");
  assert.equal(change.mode, "160000");
  assert.equal(change.type, "commit");
  assert.notEqual(change.oid, change.before.oid);
  const full = await candidateSnapshot(root, { type: "project" });
  const fullSubmodule = full.files.find(item => item.path === "vendor/child");
  assert.equal(fullSubmodule.status, "present");
  assert.equal(fullSubmodule.mode, "160000");
  assert.equal(fullSubmodule.oid, change.oid);
  await execute("git", ["submodule", "deinit", "-q", "-f", "--", "vendor/child"], root);
  const deinitialized = await candidateSnapshot(root, { type: "project" });
  const indexedSubmodule = deinitialized.files.find(item => item.path === "vendor/child");
  assert.equal(indexedSubmodule.status, "present");
  assert.equal(indexedSubmodule.mode, "160000");
  assert.match(indexedSubmodule.oid, /^[0-9a-f]{40}$/);
});

test("Git candidates include dirty submodule worktrees", async () => {
  const root = await temporaryDirectory();
  const child = await temporaryDirectory();
  await initializeGit(root);
  await initializeGit(child);
  await execute("git", ["-c", "protocol.file.allow=always", "submodule", "add", "-q", child, "vendor/child"], root);
  await execute("git", ["commit", "-q", "-am", "chore: add child"], root);
  const before = await projectFingerprint(root);
  await writeFile(path.join(root, "vendor", "child", "README.md"), "# Dirty child\n");
  const snapshot = await projectSnapshot(root);
  assert.notEqual(await projectFingerprint(root), before);
  const change = snapshot.changes.find(item => item.path === "vendor/child");
  assert(change.worktree.changes.some(item => item.path === "README.md"));
  const full = await candidateSnapshot(root, { type: "project" });
  assert(full.files.find(item => item.path === "vendor/child").worktree.changes.some(item => item.path === "README.md"));
});

test("commit preparation rejects dirty submodule contents", async () => {
  const root = await temporaryDirectory();
  const child = await temporaryDirectory();
  await initializeGit(root);
  await initializeGit(child);
  await execute("git", ["-c", "protocol.file.allow=always", "submodule", "add", "-q", child, "vendor/child"], root);
  await execute("git", ["commit", "-q", "-am", "chore: add child"], root);
  await writeFile(path.join(root, "vendor", "child", "README.md"), "# Dirty child\n");
  await renderChange(root, { kind: "feature", title: "Inspect Submodule", slug: "inspect-submodule" });
  await renderSystem(root);
  const state = {
    version: 2,
    type: "change",
    slug: "inspect-submodule",
    phase: "ready-to-commit",
    git: true,
    kind: "feature",
    title: "Inspect submodule",
    designPath: ".agent/changes/inspect-submodule.md",
    findings: [],
    evidence: [],
    reviews: {}
  };
  state.baseHead = (await execute("git", ["rev-parse", "HEAD"], root)).stdout.trim();
  state.developerApproval = {};
  state.reviews["design-verifier"] = { contractFingerprint: await designContractFingerprint(root, state) };
  const fingerprint = await projectFingerprint(root);
  state.evidence.push({ expectFail: false, code: 0, fingerprint: await executableFingerprint(root) });
  state.reviews["quality-verifier"] = { verdict: "approved", fingerprint };
  await assert.rejects(prepareCommit(root, state, DEFAULT_CONFIG), /Dirty submodule contents/);
});

test("commit preparation clears a deleted embedded repository from the index", async () => {
  const root = await temporaryDirectory();
  await initializeGit(root);
  await renderChange(root, { kind: "feature", title: "Prepare Candidate", slug: "prepare-candidate" });
  await renderSystem(root);
  await writeFile(path.join(root, "app.js"), "export const value = 1;\n");
  const state = {
    version: 2,
    type: "change",
    slug: "prepare-candidate",
    phase: "ready-to-commit",
    git: true,
    kind: "feature",
    title: "Prepare candidate",
    designPath: ".agent/changes/prepare-candidate.md",
    findings: [],
    evidence: [],
    reviews: {}
  };
  state.baseHead = (await execute("git", ["rev-parse", "HEAD"], root)).stdout.trim();
  state.developerApproval = {};
  state.reviews["design-verifier"] = { contractFingerprint: await designContractFingerprint(root, state) };
  const fingerprint = await projectFingerprint(root);
  state.evidence.push({ expectFail: false, code: 0, fingerprint: await executableFingerprint(root) });
  state.reviews["quality-verifier"] = { verdict: "approved", fingerprint };

  const embedded = path.join(root, "generated");
  await mkdir(embedded);
  await initializeGit(embedded);
  await assert.rejects(prepareCommit(root, state, DEFAULT_CONFIG), /approved quality-verifier fingerprint/);

  await rm(embedded, { recursive: true, force: true });
  const plan = await prepareCommit(root, state, DEFAULT_CONFIG);
  assert.equal(plan.fingerprint, fingerprint);
});
