import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { prepareCommit } from "../src/commit.mjs";
import { DEFAULT_CONFIG } from "../src/config.mjs";
import { projectFingerprint, projectSnapshot } from "../src/fingerprints.mjs";
import { statusPaths } from "../src/git.mjs";
import { execute, initializeGit, temporaryDirectory } from "./helpers.mjs";

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
});

test("commit preparation rejects dirty submodule contents", async () => {
  const root = await temporaryDirectory();
  const child = await temporaryDirectory();
  await initializeGit(root);
  await initializeGit(child);
  await execute("git", ["-c", "protocol.file.allow=always", "submodule", "add", "-q", child, "vendor/child"], root);
  await execute("git", ["commit", "-q", "-am", "chore: add child"], root);
  await writeFile(path.join(root, "vendor", "child", "README.md"), "# Dirty child\n");
  const fingerprint = await projectFingerprint(root);
  const state = {
    phase: "ready-to-commit",
    git: true,
    kind: "feature",
    title: "Inspect submodule",
    findings: [],
    evidence: [{ expectFail: false, code: 0, fingerprint }],
    reviews: { "quality-verifier": { verdict: "approved", fingerprint } }
  };
  await assert.rejects(prepareCommit(root, state, DEFAULT_CONFIG), /Dirty submodule contents/);
});
