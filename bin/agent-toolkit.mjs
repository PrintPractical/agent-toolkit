#!/usr/bin/env node

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { renderChange, renderSystem, slugify, validateArtifacts } from "../src/artifacts.mjs";
import { createCommit, prepareCommit } from "../src/commit.mjs";
import { readConfig, writeDefaultConfig } from "../src/config.mjs";
import { recordTest } from "../src/evidence.mjs";
import { recordDeveloperFeedback } from "../src/feedback.mjs";
import { checkGitHub, ensureIssue, linkIssue } from "../src/github.mjs";
import { isGitRepository, statusPaths } from "../src/git.mjs";
import { helpText } from "../src/help.mjs";
import { dispositionFinding, prepareReview, recordEscalation, recordReview, resolveFinding, restartDesignReview, restartQualityReview } from "../src/reviews.mjs";
import { installSkills, parseInstallOptions } from "../src/skills-installer.mjs";
import { advance, completeSlice, createState, findingBlocksCompletion, findingStatus, loadState, nextAction, withStateLock } from "../src/state-machine.mjs";

const root = process.cwd();
const args = process.argv.slice(2);

function option(name, { required = false } = {}) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (required && (!value || value.startsWith("--"))) throw new Error(`Missing ${name}`);
  return value;
}

function optionValues(name) {
  return args.flatMap((value, index) => value === name && args[index + 1] && !args[index + 1].startsWith("--") ? [args[index + 1]] : []);
}

function has(name) {
  return args.includes(name);
}

function isHelpRequested() {
  if (!args.length || ["help", "--help", "-h"].includes(args[0])) return true;
  const separator = args.indexOf("--");
  const toolkitArgs = separator < 0 ? args : args.slice(0, separator);
  return toolkitArgs.includes("--help") || toolkitArgs.includes("-h");
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
    findings: Object.fromEntries(["open", "resolved", "disposition-pending", "disposition-verified", "retired"]
      .map(status => [status, state.findings.filter(item => findingStatus(item) === status).length])),
    unresolvedFindings: state.findings.filter(findingBlocksCompletion).length,
    reviewEscalation: state.reviewEscalation || null,
    developerFeedback: state.developerFeedback?.at(-1) || null,
    slices: state.implementation?.slices?.map(slice => ({
      number: slice.number,
      title: slice.title,
      complete: Boolean(slice.completedAt)
    })) || null,
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

async function feedback() {
  if (args[1] !== "record") throw new Error("Usage: agent-toolkit feedback record --verdict approved|changes-requested [--note \"...\"] [--notes <file>]");
  const state = await loadState(root);
  const record = await recordDeveloperFeedback(root, state, {
    verdict: option("--verdict", { required: true }),
    notesFile: option("--notes"),
    notes: optionValues("--note")
  });
  const config = await readConfig(root);
  console.log(`Developer feedback: ${record.verdict}\nPhase: ${state.phase}\nNext: ${nextAction(state, config)}`);
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
  }, await readConfig(root));
  console.log(`Recorded ${evidence.kind} evidence (${evidence.expectFail ? "expected failure" : "passed"})`);
}

async function slice() {
  if (args[1] !== "complete") throw new Error("Usage: agent-toolkit slice complete --number <n>");
  const raw = option("--number", { required: true });
  const number = Number(raw);
  if (!Number.isInteger(number) || number < 1) throw new Error("--number must be a positive integer");
  const state = await loadState(root);
  const completed = await completeSlice(root, state, number);
  const config = await readConfig(root);
  console.log(`Completed Slice ${completed.number}: ${completed.title}\nNext: ${nextAction(state, config)}`);
}

async function review() {
  const action = args[1];
  const state = await loadState(root);
  const config = await readConfig(root);
  if (action === "prepare") {
    const packet = await prepareReview(root, state, { stage: option("--stage", { required: true }), role: option("--role", { required: true }) }, config);
    const design = await readFile(path.join(root, state.designPath), "utf8");
    let system = "";
    try { system = await readFile(path.join(root, ".agent", "SYSTEM.md"), "utf8"); } catch {}
    const current = state.evidence.filter(item => [packet.evidenceFingerprint, packet.fingerprint].includes(item.fingerprint));
    const regression = state.regression
      ? state.evidence.find(item => item.id === state.regression.evidenceId)
      : [...state.evidence].reverse().find(item => item.kind === "regression" && item.expectFail);
    const regressionPass = regression && [...current].reverse().find(item => item.kind === "regression" && !item.expectFail
      && JSON.stringify(item.command) === JSON.stringify(regression.command));
    const latestByCommand = new Map();
    for (const item of current) latestByCommand.set(JSON.stringify([item.kind, item.expectFail, item.command]), item);
    for (const item of [regression, regressionPass].filter(Boolean)) latestByCommand.set(item.id, item);
    const selected = [...new Set(latestByCommand.values())];
    const outputRecords = new Set(selected.slice(-8));
    const tests = selected.map(item => ({
      kind: item.kind,
      expectFail: item.expectFail,
      command: item.command,
      code: item.code,
      timedOut: item.timedOut || false,
      candidateChanged: item.candidateChanged || false,
      output: outputRecords.has(item) ? item.output.slice(-1000) : "",
      outputOmitted: !outputRecords.has(item),
      fingerprint: item.fingerprint,
      recordedAt: item.recordedAt
    }));
    const criticInstructions = packet.stage === "design"
      ? "Perform the cycle's one comprehensive discovery pass. Check every explicit requirement, example, applicable project instruction, support-envelope decision, boundary, abstraction, dependency direction, composition point, file/module placement plan, and planned observable slice. Catch omitted requirements, abstractions that are reviewed but not planned through implementation and tests, and unsupported claims. Report all demonstrated material defects now. Zero findings is valid: do not optimize for finding count, speculative hardening, or exhaustive reversible detail."
      : "Perform the cycle's one comprehensive discovery pass. Compare the canonical candidate and Implementation Conformance to every explicit reviewed requirement, support-envelope decision, boundary, abstraction, dependency direction, composition point, transaction rule, project module constraint, placement responsibility, and vertical slice. Specifically catch omitted requirements, declared abstractions or implementations that remain scaffolding or unused, concrete infrastructure leaking into inward policy, violated AGENTS.md module constraints, regressions, and slices that do not build and run. Report all demonstrated material defects now. Zero findings is valid; do not optimize for findings or request production changes for hypothetical behavior outside the reviewed contract.";
    const verifierInstructions = "Perform closure review, not a second critic pass, in the same verifier context used for this cycle. Check supplied findings and developer dispositions against the remediated candidate and reviewed contract. Reopen a supplied finding when it remains unresolved, a disposition is inaccurate, or a disposition would waive an explicit reviewed requirement or required acceptance. You may report only a demonstrable high-severity regression introduced by remediation. Do not add pre-existing omissions, broaden scope, or demand adjacent hardening. Zero findings is a successful closure result.";
    const commonProperties = {
      severity: { enum: ["high", "medium"] },
      description: { type: "string", minLength: 1, pattern: "\\S" },
      contractReference: { type: "string", minLength: 1, pattern: "\\S" },
      evidence: { type: "string", minLength: 1, pattern: "\\S" },
      observableImpact: { type: "string", minLength: 1, pattern: "\\S" }
    };
    const criticFinding = {
      type: "object",
      additionalProperties: false,
      required: ["severity", "description", "contractReference", "evidence", "observableImpact"],
      properties: commonProperties
    };
    const verifierFindingForms = [];
    if (packet.findingIds.length) verifierFindingForms.push({
      type: "object",
      additionalProperties: false,
      required: ["severity", "description", "contractReference", "evidence", "observableImpact", "sourceFindingId"],
      properties: { ...commonProperties, sourceFindingId: { type: "string", enum: packet.findingIds } }
    });
    if (state.reviews[`${packet.stage}-critic`]?.verdict === "changes-requested") verifierFindingForms.push({
      type: "object",
      additionalProperties: false,
      required: ["severity", "description", "contractReference", "evidence", "observableImpact", "introducedByRemediation"],
      properties: {
        ...commonProperties,
        severity: { const: "high" },
        introducedByRemediation: { const: true },
      }
    });
    const verifierFinding = verifierFindingForms.length ? { oneOf: verifierFindingForms } : false;
    console.log(JSON.stringify({
      ...packet,
      instructions: `Review only the supplied design, system map, canonical candidate, test evidence, and findings. Use one fresh critic context and one distinct verifier context per cycle; reuse that verifier context for closure retries. ${packet.role === "critic" ? criticInstructions : verifierInstructions} Every finding needs a concrete reviewed contract reference, candidate evidence, and observable impact. Write JSON matching the supplied schema directly to findingsPath, including {"findings":[]} for approval. Do not create review output anywhere else in the project.`,
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["findings"],
        properties: { findings: { type: "array", items: packet.role === "critic" ? criticFinding : verifierFinding } }
      },
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
    }, config);
    console.log(`Phase: ${updated.phase}\nNext: ${nextAction(updated, config)}`);
    return;
  }
  if (action === "restart") {
    const stage = option("--stage", { required: true });
    if (!["design", "quality"].includes(stage)) throw new Error("Review restart stage must be design or quality");
    const updated = stage === "design" ? await restartDesignReview(root, state) : await restartQualityReview(root, state);
    console.log(`Phase: ${updated.phase}\nNext: ${nextAction(updated, config)}`);
    return;
  }
  throw new Error("Usage: agent-toolkit review prepare|record|restart ...");
}

async function findings() {
  const action = args[1];
  if (!args[2]) throw new Error("Usage: agent-toolkit findings resolve|disposition <id> ...");
  const finding = action === "resolve"
    ? await resolveFinding(root, await loadState(root), args[2])
    : action === "disposition"
      ? await dispositionFinding(root, await loadState(root), args[2], {
        outcome: option("--outcome", { required: true }),
        reason: option("--reason", { required: true }),
        duplicateOf: option("--duplicate-of"),
        followUp: option("--follow-up")
      })
      : null;
  if (!finding) throw new Error("Usage: agent-toolkit findings resolve|disposition <id> ...");
  console.log(`${action === "resolve" ? "Resolved" : "Disposition pending verification"}: ${finding.description}`);
}

async function escalation() {
  if (args[1] !== "record") throw new Error("Usage: agent-toolkit escalation record --decision <decision> [--reason <text>]");
  const updated = await recordEscalation(root, await loadState(root), option("--decision", { required: true }), option("--reason"));
  const config = await readConfig(root);
  console.log(`Phase: ${updated.phase}\nNext: ${nextAction(updated, config)}`);
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
  if (isHelpRequested()) {
    const topic = args[0] === "help"
      ? (args[1]?.startsWith("-") ? "help" : args[1])
      : (!args.length || args[0].startsWith("-") ? undefined : args[0]);
    console.log(helpText(topic));
    return;
  }
  switch (args[0]) {
    case "install": return install();
    case "init": return initialize();
    case "start": return start();
    case "status": return status();
    case "check": return check();
    case "advance": return runAdvance();
    case "feedback": return feedback();
    case "test": return test();
    case "slice": return slice();
    case "review": return review();
    case "findings": return findings();
    case "escalation": return escalation();
    case "issue": return issue();
    case "commit": return commit();
    default:
      throw new Error(`Unknown command: ${args[0]}. Run: agent-toolkit help`);
  }
}

const helpRequested = isHelpRequested();
const execution = helpRequested || ["install", "init", "status", "check"].includes(args[0]) ? main() : withStateLock(root, main);
execution.catch(error => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
