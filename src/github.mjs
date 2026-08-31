import { readFile } from "node:fs/promises";
import path from "node:path";
import { run } from "./git.mjs";
import { saveState } from "./state-machine.mjs";
import { withDirectoryLock } from "./locks.mjs";

async function gh(root, args, allowFailure = false) {
  return run("gh", args, { cwd: root, allowFailure });
}

export async function resolveRepository(root, config) {
  if (config.github.issues.repository !== "auto") return config.github.issues.repository;
  const result = await gh(root, ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  return result.stdout;
}

export async function checkGitHub(root, config) {
  const auth = await gh(root, ["auth", "status"], true);
  if (auth.code !== 0) throw new Error("GitHub issue support is configured but gh is not authenticated");
  return resolveRepository(root, config);
}

function selectedDesignSections(design) {
  const allowed = new Set([
    "Outcome", "Non-goals", "Actors and Use Cases", "Failure and Impact", "Reproduction",
    "Root Cause", "Concrete Examples", "Key Concepts and Rules", "Rules and Invariants",
    "Responsibility Decomposition", "Responsibility and Architecture Map",
    "Public Interfaces and Errors", "Abstraction and Extension Pressure",
    "Correction and Extension Pressure", "Test Traceability", "Implementation Plan", "Thin Vertical Slices"
  ]);
  const sections = design.split(/(?=^## )/m);
  return sections.filter(section => allowed.has(section.match(/^## (.+)$/m)?.[1])).join("\n").trim();
}

function issueBody(state, design) {
  const marker = `<!-- agent-toolkit-change: ${state.id} -->`;
  return `${marker}\n\n${selectedDesignSections(design)}`.slice(0, 60000);
}

export async function ensureIssue(root, state, config) {
  if (config.github.issues.policy !== "create") throw new Error("GitHub issue creation is not enabled");
  if (state.issue) return state.issue;
  const lock = path.join(root, ".agent", ".state", "issue.lock");
  return withDirectoryLock(lock, "Another issue creation is in progress; retry after it completes", async () => {
    const repository = await checkGitHub(root, config);
    const listed = await gh(root, ["issue", "list", "--repo", repository, "--state", "all", "--limit", "1000", "--json", "number,url,body"]);
    const existing = JSON.parse(listed.stdout || "[]").find(item => item.body?.includes(`agent-toolkit-change: ${state.id}`));
    if (existing) {
      state.issue = { number: existing.number, url: existing.url, repository };
    } else {
      const design = await readFile(path.join(root, state.designPath), "utf8");
      const args = ["issue", "create", "--repo", repository, "--title", state.title, "--body", issueBody(state, design)];
      for (const label of config.github.issues.labels) args.push("--label", label);
      const created = await gh(root, args);
      const url = created.stdout.split("\n").at(-1);
      const number = Number(url.match(/\/(\d+)$/)?.[1]);
      if (!number) throw new Error(`Could not parse created issue URL: ${url}`);
      state.issue = { number, url, repository };
    }
    await saveState(root, state);
    return state.issue;
  });
}

export async function linkIssue(root, state, config, number) {
  if (config.github.issues.policy === "off") throw new Error("GitHub issue integration is disabled");
  const repository = await checkGitHub(root, config);
  const result = await gh(root, ["issue", "view", String(number), "--repo", repository, "--json", "number,url"]);
  const issue = JSON.parse(result.stdout);
  state.issue = { ...issue, repository };
  await saveState(root, state);
  return state.issue;
}
