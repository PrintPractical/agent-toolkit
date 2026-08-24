#!/usr/bin/env node

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { renderChange, renderSystem, slugify, validateArtifacts } from "../src/artifacts.mjs";
import { createCommit, prepareCommit } from "../src/commit.mjs";
import { readConfig, writeDefaultConfig } from "../src/config.mjs";
import { recordTest } from "../src/evidence.mjs";
import { checkGitHub, ensureIssue, linkIssue } from "../src/github.mjs";
import { isGitRepository, statusPaths } from "../src/git.mjs";
import { prepareReview, recordReview, resolveFinding, restartDesignReview, restartQualityReview } from "../src/reviews.mjs";
import { installSkills, parseInstallOptions } from "../src/skills-installer.mjs";
import { advance, createState, loadState, nextAction, withStateLock } from "../src/state-machine.mjs";

const root = process.cwd();
const args = process.argv.slice(2);

function option(name, { required = false } = {}) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (required && (!value || value.startsWith("--"))) throw new Error(`Missing ${name}`);
  return value;
}

function has(name) {
  return args.includes(name);
}

async function install() {
  await installSkills(parseInstallOptions(args.slice(1)));
}

async function ensureGitignore() {
  const file = path.join(root, ".gitignore");
  let content = "";
  try { content = await readFile(file, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!content.split("\n").includes(".agent/.state/")) {
    await appendFile(file, `${content && !content.endsWith("\n") ? "\n" : ""}.agent/.state/\n`);
  }
}

async function initialize() {
  try {
    await readConfig(root);
    await ensureGitignore();
    console.log("Toolkit already initialized");
    return;
  } catch (error) {
    if (!error.message.startsWith("Toolkit is not initialized")) throw error;
  }
  const git = await isGitRepository(root);
  if (git && (await statusPaths(root)).length) {
    throw new Error("Initialization requires a clean Git worktree; commit or remove existing changes first");
  }
  const created = await writeDefaultConfig(root);
  await mkdir(path.join(root, ".agent", "changes"), { recursive: true });
  await mkdir(path.join(root, ".agent", ".state"), { recursive: true });
  await ensureGitignore();
  console.log(created ? "Initialized .agent/config.json" : "Toolkit already initialized");
}

async function start() {
  const kind = option("--kind", { required: true });
  const title = option("--title", { required: true });
  if (!["feature", "fix"].includes(kind)) throw new Error("--kind must be feature or fix");
  const config = await readConfig(root);
  const issue = option("--issue");
  if (issue && config.github.issues.policy === "off") {
    throw new Error("--issue requires github.issues.policy to be create or existing");
  }
  try {
    const active = await loadState(root);
    if (active.phase !== "complete") throw new Error(`Active change ${active.slug} is not complete`);
  } catch (error) {
    if (!error.message.startsWith("No active change")) throw error;
  }
  const git = await isGitRepository(root);
  if (git && config.completion.commit.policy === "if-git") {
    const allowed = new Set([".agent/config.json", ".gitignore"]);
    const unexpected = (await statusPaths(root)).filter(file => !allowed.has(file));
    if (unexpected.length) throw new Error(`Change startup requires a clean worktree; unexpected changes:\n${unexpected.join("\n")}`);
  }
  if (config.github.issues.policy !== "off") {
    if (!git) throw new Error("GitHub issue integration requires a Git repository");
    await checkGitHub(root, config);
  }
  const slug = slugify(title);
  const design = await renderChange(root, { kind, title, slug });
  await renderSystem(root);
  const state = await createState(root, {
    slug,
    kind,
    title,
    designPath: path.relative(root, design),
    git
  });
  if (issue) await linkIssue(root, state, config, Number(issue));
  console.log(`Started ${kind} change ${slug}\nDesign: ${state.designPath}\nNext: ${nextAction(state, config)}`);
}

async function status() {
  const config = await readConfig(root);
  const state = await loadState(root);
  const summary = {
    change: state.slug,
    kind: state.kind,
    phase: state.phase,
    design: state.designPath,
    issue: state.issue || null,
    commit: state.commitSha || null,
    unresolvedFindings: state.findings.filter(item => !item.resolved).length,
    next: nextAction(state, config)
  };
  console.log(has("--json") ? JSON.stringify(summary, null, 2) : Object.entries(summary).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`).join("\n"));
}

async function check() {
  const state = await loadState(root);
  const problems = await validateArtifacts(root, state, { requireSystem: true });
  if (problems.length) throw new Error(problems.join("\n"));
  console.log("Artifacts are valid");
}

async function runAdvance() {
  const config = await readConfig(root);
  const state = await advance(root, await loadState(root), config);
  console.log(`Phase: ${state.phase}\nNext: ${nextAction(state, config)}`);
}

async function test() {
  const separator = args.indexOf("--");
  if (separator < 0) throw new Error("Test command required after --");
  const command = args[separator + 1];
  const commandArgs = args.slice(separator + 2);
  const evidence = await recordTest(root, await loadState(root), {
    kind: option("--kind", { required: true }),
    expectFail: has("--expect-fail"),
    command,
    args: commandArgs
  });
  console.log(`Recorded ${evidence.kind} evidence (${evidence.expectFail ? "expected failure" : "passed"})`);
}

async function review() {
  const action = args[1];
  const state = await loadState(root);
  if (action === "prepare") {
    const packet = await prepareReview(root, state, { stage: option("--stage", { required: true }), role: option("--role", { required: true }) });
    const design = await readFile(path.join(root, state.designPath), "utf8");
    let system = "";
    try { system = await readFile(path.join(root, ".agent", "SYSTEM.md"), "utf8"); } catch {}
    const current = state.evidence.filter(item => item.fingerprint === packet.fingerprint);
    const regression = state.regression
      ? state.evidence.find(item => item.id === state.regression.evidenceId)
      : [...state.evidence].reverse().find(item => item.kind === "regression" && item.expectFail);
    const regressionPass = regression && [...current].reverse().find(item => item.kind === "regression" && !item.expectFail
      && JSON.stringify(item.command) === JSON.stringify(regression.command));
    const required = [regression, regressionPass].filter(Boolean);
    const remaining = current.filter(item => !required.includes(item));
    const selected = required.length ? [...required, ...remaining.slice(-(8 - required.length))] : current.slice(-8);
    const tests = selected.map(item => ({ kind: item.kind, expectFail: item.expectFail, command: item.command, code: item.code, output: item.output.slice(-1000), fingerprint: item.fingerprint, recordedAt: item.recordedAt }));
    console.log(JSON.stringify({
      ...packet,
      instructions: "Review only the supplied design, system map, canonical candidate, and test evidence in a fresh context. Report material correctness, domain, contract, risk, and test findings; omit preference-only comments.",
      design,
      system,
      candidate: packet.candidate,
      tests
    }, null, 2));
    return;
  }
  if (action === "record") {
    const updated = await recordReview(root, state, {
      packetId: option("--packet", { required: true }),
      verdict: option("--verdict", { required: true }),
      reviewer: option("--reviewer"),
      findingsFile: option("--findings")
    });
    const config = await readConfig(root);
    console.log(`Phase: ${updated.phase}\nNext: ${nextAction(updated, config)}`);
    return;
  }
  if (action === "restart") {
    const stage = option("--stage", { required: true });
    if (!["design", "quality"].includes(stage)) throw new Error("Review restart stage must be design or quality");
    const updated = stage === "design" ? await restartDesignReview(root, state) : await restartQualityReview(root, state);
    const config = await readConfig(root);
    console.log(`Phase: ${updated.phase}\nNext: ${nextAction(updated, config)}`);
    return;
  }
  throw new Error("Usage: agent-toolkit review prepare|record|restart ...");
}

async function findings() {
  if (args[1] !== "resolve" || !args[2]) throw new Error("Usage: agent-toolkit findings resolve <id>");
  const finding = await resolveFinding(root, await loadState(root), args[2]);
  console.log(`Resolved: ${finding.description}`);
}

async function issue() {
  const action = args[1];
  const config = await readConfig(root);
  const state = await loadState(root);
  const result = action === "ensure"
    ? await ensureIssue(root, state, config)
    : action === "link" && args[2]
      ? await linkIssue(root, state, config, Number(args[2]))
      : null;
  if (!result) throw new Error("Usage: agent-toolkit issue ensure|link <number>");
  console.log(`Issue #${result.number}: ${result.url}`);
}

async function commit() {
  const action = args[1];
  const state = await loadState(root);
  if (action === "prepare") {
    const plan = await prepareCommit(root, state, await readConfig(root));
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (action === "create") {
    const sha = await createCommit(root, state);
    console.log(`Committed ${sha}`);
    return;
  }
  throw new Error("Usage: agent-toolkit commit prepare|create");
}

async function main() {
  switch (args[0]) {
    case "install": return install();
    case "init": return initialize();
    case "start": return start();
    case "status": return status();
    case "check": return check();
    case "advance": return runAdvance();
    case "test": return test();
    case "review": return review();
    case "findings": return findings();
    case "issue": return issue();
    case "commit": return commit();
    default:
      throw new Error("Usage: agent-toolkit <install|init|start|status|check|advance|test|review|findings|issue|commit>");
  }
}

const execution = ["install", "init", "status", "check"].includes(args[0]) ? main() : withStateLock(root, main);
execution.catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
