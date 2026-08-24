import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectFingerprint, projectSnapshot } from "./fingerprints.mjs";
import { conventionalMessage, run, runGit, statusPaths } from "./git.mjs";
import { hasRequiredCurrentEvidence, requireCurrentDesign, saveState } from "./state-machine.mjs";

export async function prepareCommit(root, state, config) {
  if (state.phase !== "ready-to-commit") throw new Error("Commit can only be prepared after quality verification");
  await requireCurrentDesign(root, state);
  if (!state.git || config.completion.commit.policy === "off") throw new Error("Commit integration is not active");
  const fingerprint = await projectFingerprint(root);
  const verified = state.reviews["quality-verifier"];
  if (!verified || verified.verdict !== "approved" || verified.fingerprint !== fingerprint) {
    throw new Error("Current change does not match an approved quality-verifier fingerprint");
  }
  if (!hasRequiredCurrentEvidence(state, fingerprint)) {
    throw new Error(state.kind === "fix"
      ? "Current passing regression evidence is required before commit preparation"
      : "Current passing test evidence is required before commit preparation");
  }
  if (state.findings.some(item => !item.resolved)) throw new Error("Resolve all findings before commit preparation");
  const candidate = await projectSnapshot(root);
  const dirtySubmodules = candidate.changes.filter(item => item.mode === "160000" && item.worktree);
  if (dirtySubmodules.length) {
    throw new Error("Dirty submodule contents cannot be represented by the parent commit; commit them in the submodule, then rerun tests and quality review");
  }
  await runGit(root, ["add", "-A"]);
  if (await projectFingerprint(root) !== fingerprint) {
    throw new Error("Commit candidate changed while staging; prepare it again");
  }
  const tree = (await runGit(root, ["write-tree"])).stdout;
  const currentHead = await runGit(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true });
  const baseHead = currentHead.code === 0 ? currentHead.stdout : null;
  if (candidate.head !== baseHead) throw new Error("Git HEAD changed while preparing the commit");
  const files = await statusPaths(root);
  if (!files.length) throw new Error("No changes to commit");
  const message = conventionalMessage(state, state.issue, config);
  state.commitPlan = {
    fingerprint,
    baseHead,
    tree,
    files,
    ...message,
    preparedAt: new Date().toISOString()
  };
  await saveState(root, state);
  return state.commitPlan;
}

async function runHook(root, name, args, env, allowFailure = false) {
  const configured = (await runGit(root, ["rev-parse", "--git-path", `hooks/${name}`])).stdout;
  const hook = path.isAbsolute(configured) ? configured : path.join(root, configured);
  try {
    await access(hook, constants.X_OK);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EACCES") return;
    throw error;
  }
  return run(hook, args, { cwd: env.GIT_WORK_TREE || root, env, allowFailure });
}

async function assertPreparedGitState(root, plan, env) {
  const head = await runGit(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true });
  const currentHead = head.code === 0 ? head.stdout : null;
  if (currentHead !== plan.baseHead) throw new Error("Git HEAD changed; prepare the commit again");
  const tree = (await runGit(root, ["write-tree"], { env })).stdout;
  if (tree !== plan.tree) throw new Error("A commit hook changed the reviewed tree; prepare and review it again");
  await runGit(root, ["update-index", "--refresh"], { env, allowFailure: true });
  const tracked = await runGit(root, ["diff-files", "--quiet"], { env, allowFailure: true });
  const untracked = await runGit(root, ["ls-files", "--others", "--exclude-standard"], { env });
  if (tracked.code !== 0 || untracked.stdout) throw new Error("A commit hook changed the reviewed worktree; prepare and review it again");
}

async function commitMatchesPlan(root, sha, plan, expectedMessage) {
  const tree = await runGit(root, ["rev-parse", `${sha}^{tree}`], { allowFailure: true });
  if (tree.code !== 0 || tree.stdout !== plan.tree) return false;
  const parents = (await runGit(root, ["rev-list", "--parents", "-n", "1", sha])).stdout.split(" ").slice(1);
  const expectedParents = plan.baseHead ? [plan.baseHead] : [];
  if (JSON.stringify(parents) !== JSON.stringify(expectedParents)) return false;
  return (await runGit(root, ["show", "-s", "--format=%B", sha])).stdout === expectedMessage;
}

export async function createCommit(root, state) {
  await requireCurrentDesign(root, state);
  if (!state.commitPlan) throw new Error("Prepare and inspect the commit before creating it");
  const expectedMessage = `${state.commitPlan.subject}\n\n${state.commitPlan.body}`;
  const existingHead = await runGit(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true });
  if (existingHead.code === 0 && await commitMatchesPlan(root, existingHead.stdout, state.commitPlan, expectedMessage)) {
    state.commitSha = existingHead.stdout;
    state.phase = "complete";
    await saveState(root, state);
    return existingHead.stdout;
  }
  const current = await projectFingerprint(root);
  if (current !== state.commitPlan.fingerprint) throw new Error("Commit candidate changed; prepare it again");
  const head = await runGit(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true });
  const baseHead = head.code === 0 ? head.stdout : null;
  if (baseHead !== state.commitPlan.baseHead) throw new Error("Git HEAD changed; prepare the commit again");
  const stagedTree = (await runGit(root, ["write-tree"])).stdout;
  if (stagedTree !== state.commitPlan.tree) throw new Error("Git index changed; prepare the commit again");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "agent-toolkit-commit-"));
  const worktree = path.join(temporary, "worktree");
  await mkdir(worktree);
  const gitDirectory = (await runGit(root, ["rev-parse", "--absolute-git-dir"])).stdout;
  const env = { ...process.env, GIT_DIR: gitDirectory, GIT_WORK_TREE: worktree, GIT_INDEX_FILE: path.join(temporary, "index") };
  const messageFile = path.join(temporary, "message");
  let sha;
  try {
    await runGit(root, ["read-tree", state.commitPlan.tree], { env });
    await runGit(root, ["checkout-index", "--all", "--force", `--prefix=${worktree}${path.sep}`], { env });
    await writeFile(messageFile, `${expectedMessage}\n`);
    await runHook(root, "pre-commit", [], env);
    await assertPreparedGitState(root, state.commitPlan, env);
    await runHook(root, "prepare-commit-msg", [messageFile, "message"], env);
    await runHook(root, "commit-msg", [messageFile], env);
    const hookMessage = (await readFile(messageFile, "utf8")).trim();
    if (hookMessage !== expectedMessage) throw new Error("A commit hook changed the inspected message; prepare it again");
    await assertPreparedGitState(root, state.commitPlan, env);
    if (await projectFingerprint(root) !== state.commitPlan.fingerprint) {
      throw new Error("A commit hook changed the reviewed candidate; prepare and review it again");
    }
    const arguments_ = ["commit-tree", state.commitPlan.tree];
    if (state.commitPlan.baseHead) arguments_.push("-p", state.commitPlan.baseHead);
    sha = (await runGit(root, arguments_, { input: `${expectedMessage}\n` })).stdout;
    if (!await commitMatchesPlan(root, sha, state.commitPlan, expectedMessage)) {
      throw new Error(`Created commit object ${sha} does not match the reviewed tree, parent, and message`);
    }
    const old = state.commitPlan.baseHead || "0000000000000000000000000000000000000000";
    await runGit(root, ["update-ref", "-m", `commit: ${state.commitPlan.subject}`, "HEAD", sha, old]);
    try { await runHook(root, "post-commit", [], env, true); } catch {}
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  state.commitSha = sha;
  state.phase = "complete";
  await saveState(root, state);
  return sha;
}
