#!/usr/bin/env node

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { projectMilestones, renderChange, renderProject, renderSystem, slugify, sourceRecords, validateArtifacts } from "../src/artifacts.mjs";
import { createCommit, prepareCommit } from "../src/commit.mjs";
import { readConfig, writeDefaultConfig } from "../src/config.mjs";
import { recordTest } from "../src/evidence.mjs";
import { recordDeveloperFeedback } from "../src/feedback.mjs";
import { executableFingerprint } from "../src/fingerprints.mjs";
import { checkGitHub, ensureIssue, linkIssue } from "../src/github.mjs";
import { currentHead, isGitRepository, requireCleanWorktree, statusPaths } from "../src/git.mjs";
import { helpText } from "../src/help.mjs";
import { dispositionFinding, prepareReview, recordEscalation, recordReview, resolveFinding, restartDesignReview, restartQualityReview } from "../src/reviews.mjs";
import { installSkills, parseInstallOptions } from "../src/skills-installer.mjs";
import { advance, completeSlice, createState, finalizeProject, findingBlocksCompletion, findingStatus, listStates, loadRegistry, loadState, milestoneDeliveryComplete, nextAction, reconcileMilestone, registerMilestone, requireCurrentDesign, selectState, withStateLock } from "../src/state-machine.mjs";

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
  await mkdir(path.join(root, ".agent", "projects"), { recursive: true });
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
  const projectSlug = option("--project");
  const milestoneRaw = option("--milestone");
  if (Boolean(projectSlug) !== Boolean(milestoneRaw)) throw new Error("--project and --milestone must be used together");
  const milestoneNumber = milestoneRaw && Number(milestoneRaw);
  if (milestoneRaw && (!Number.isInteger(milestoneNumber) || milestoneNumber < 1)) throw new Error("--milestone must be a positive integer");
  const registry = await loadRegistry(root);
  const slug = slugify(title);
  if (registry.workflows.includes(slug)) throw new Error(`Workflow already exists: ${slug}`);
  const project = projectSlug ? await loadState(root, projectSlug) : null;
  if (project) {
    if (project.type !== "project" || project.phase !== "active") throw new Error("--project must identify an active reviewed project");
    const problems = await validateArtifacts(root, project, { requireSystem: true });
    if (problems.length) throw new Error(problems.join("\n"));
    await requireCurrentDesign(root, project);
    const content = await readFile(path.join(root, project.projectPath), "utf8");
    const milestone = projectMilestones(content).find(item => item.number === milestoneNumber);
    if (!milestone) throw new Error(`Unknown project milestone: ${milestoneNumber}`);
    if (milestone.kind !== kind) throw new Error(`Milestone ${milestoneNumber} requires kind ${milestone.kind}`);
    if (milestone.status !== "active") throw new Error(`Mark Milestone ${milestoneNumber} active in ${project.projectPath} before starting it`);
    const incomplete = [];
    for (const number of milestone.dependencies) if (!await milestoneDeliveryComplete(root, project, number)) incomplete.push(number);
    if (incomplete.length) throw new Error(`Milestone ${milestoneNumber} is blocked by incomplete milestones: ${incomplete.join(", ")}`);
    const existing = project.milestones?.[milestoneNumber];
    if (existing) throw new Error(`Milestone ${milestoneNumber} is already linked to ${existing.workflow}`);
  }
  const git = await isGitRepository(root);
  if (git) {
    if (project && config.completion.commit.policy === "off") {
      throw new Error("Git project milestones require completion.commit.policy to be if-git so each delivered milestone has an inspected commit");
    }
    if (project && await currentHead(root) !== project.baseHead) {
      throw new Error(`Restore the project checkout at ${project.baseHead || "an unborn HEAD"} before starting Milestone ${milestoneNumber}`);
    }
    const allow = [".agent/config.json", ".gitignore"];
    if (project) allow.push(project.projectPath, ".agent/SYSTEM.md", ...(project.sources || []).map(source => source.path));
    await requireCleanWorktree(root, { allow, operation: "Change startup" });
  } else if (registry.current && registry.current !== project?.slug) {
    const current = await loadState(root, registry.current);
    const candidate = await executableFingerprint(root);
    if (current.phase !== "complete" && candidate !== current.baseExecutableFingerprint) {
      throw new Error(`Finish or restore the executable candidate for ${current.slug} before starting another workflow`);
    }
  }
  if (config.github.issues.policy !== "off") {
    if (!git) throw new Error("GitHub issue integration requires a Git repository");
    await checkGitHub(root, config);
  }
  const design = await renderChange(root, { kind, title, slug });
  await renderSystem(root);
  const state = await createState(root, {
    slug,
    kind,
    title,
    designPath: path.relative(root, design),
    git,
    baseHead: git ? await currentHead(root) : null,
    baseExecutableFingerprint: await executableFingerprint(root)
  });
  if (project) await registerMilestone(root, project, state, milestoneNumber);
  if (issue) await linkIssue(root, state, config, Number(issue));
  console.log(`Started ${kind} change ${slug}${project ? ` for ${project.slug} Milestone ${milestoneNumber}` : ""}\nDesign: ${state.designPath}\nNext: ${nextAction(state, config)}`);
}

async function project() {
  const action = args[1];
  if (action === "start") {
    const config = await readConfig(root);
    const title = option("--title", { required: true });
    const slug = slugify(title);
    const registry = await loadRegistry(root);
    if (registry.workflows.includes(slug)) throw new Error(`Workflow already exists: ${slug}`);
    const sources = await sourceRecords(root, optionValues("--source"));
    const git = await isGitRepository(root);
    if (git && config.completion.commit.policy === "off") {
      throw new Error("Git rolling projects require completion.commit.policy to be if-git so each delivered milestone has an inspected commit");
    }
    if (git) await requireCleanWorktree(root, { allow: [".agent/config.json", ".gitignore", ...sources.map(source => source.path)], operation: "Project startup" });
    else if (registry.current) {
      const current = await loadState(root, registry.current);
      const candidate = await executableFingerprint(root);
      if (current.phase !== "complete" && candidate !== current.baseExecutableFingerprint) {
        throw new Error(`Finish or restore the executable candidate for ${current.slug} before starting another workflow`);
      }
    }
    const artifact = await renderProject(root, { title, slug, sources });
    await renderSystem(root);
    const state = await createState(root, {
      type: "project",
      kind: "project",
      slug,
      title,
      projectPath: path.relative(root, artifact),
      designPath: path.relative(root, artifact),
      sources,
      milestones: {},
      git,
      baseHead: git ? await currentHead(root) : null,
      baseExecutableFingerprint: await executableFingerprint(root)
    });
    console.log(`Started project ${slug}\nProject: ${state.projectPath}\nNext: ${nextAction(state, config)}`);
    return;
  }
  if (action === "reconcile") {
    const state = await loadState(root);
    const updated = await reconcileMilestone(root, state);
    console.log(`Reconciled Milestone ${state.milestone.number} into ${updated.slug}`);
    return;
  }
  if (action === "finalize") {
    const state = await finalizeProject(root, await loadState(root));
    console.log(`Phase: ${state.phase}\nNext: ${nextAction(state, await readConfig(root))}`);
    return;
  }
  throw new Error("Usage: agent-toolkit project start --title \"...\" [--source <path>...] | project reconcile | project finalize");
}

async function status() {
  const config = await readConfig(root);
  const registry = await loadRegistry(root);
  if (!registry.current) {
    const empty = { current: null, workflows: [], next: "Start a project or change" };
    console.log(has("--json") ? JSON.stringify(empty, null, 2) : "No current workflow\nNext: Start a project or change");
    return;
  }
  const state = await loadState(root);
  const summary = {
    current: state.slug,
    type: state.type,
    change: state.slug,
    kind: state.kind,
    phase: state.phase,
    design: state.designPath,
    project: state.type === "project" ? state.slug : state.projectSlug || null,
    projectPath: state.projectPath || null,
    milestone: state.milestone || null,
    linkedMilestones: state.type === "project" ? state.milestones : null,
    issue: state.issue || null,
    commit: state.commitSha || null,
    findings: Object.fromEntries(["open", "resolved", "disposition-pending", "disposition-verified", "retired"]
      .map(status => [status, state.findings.filter(item => findingStatus(item) === status).length])),
    unresolvedFindings: state.findings.filter(findingBlocksCompletion).length,
    reviewEscalation: state.reviewEscalation || null,
    developerFeedback: state.developerFeedback?.at(-1) || null,
    responsibilities: state.implementation?.responsibilities || null,
    slices: state.implementation?.slices?.map(slice => ({
      number: slice.number,
      title: slice.title,
      owners: slice.owners,
      complete: Boolean(slice.completedAt)
    })) || null,
    next: nextAction(state, config)
  };
  console.log(has("--json") ? JSON.stringify(summary, null, 2) : Object.entries(summary).map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`).join("\n"));
}

async function workflow() {
  const action = args[1];
  if (action === "list") {
    const registry = await loadRegistry(root);
    const states = await listStates(root);
    const workflows = states.map(state => ({
      slug: state.slug,
      current: state.slug === registry.current,
      type: state.type,
      kind: state.kind,
      title: state.title,
      project: state.projectSlug || null,
      milestone: state.milestone || null,
      phase: state.phase,
      commit: state.commitSha || null,
      createdAt: state.createdAt
    }));
    if (has("--json")) console.log(JSON.stringify({ current: registry.current, workflows }, null, 2));
    else console.log(workflows.map(item => `${item.current ? "*" : " "} ${item.slug} ${item.type}/${item.kind} ${item.phase}`).join("\n") || "No workflows");
    return;
  }
  if (action === "select" && args[2]) {
    const registry = await loadRegistry(root);
    const target = await loadState(root, args[2]);
    if (registry.current === target.slug) {
      console.log(`Selected ${target.slug}`);
      return;
    }
    if (target.git) {
      await requireCleanWorktree(root, { operation: "Workflow selection" });
      const expected = target.type === "change" && target.phase === "complete" && target.commitSha
        ? target.commitSha
        : target.baseHead;
      if (await currentHead(root) !== expected) throw new Error(`Restore the checkout for ${target.slug} at ${expected || "an unborn HEAD"} before selecting it`);
    } else {
      const expected = [...target.evidence].reverse().find(item => !item.candidateChanged)?.fingerprint || target.baseExecutableFingerprint;
      if (expected && await executableFingerprint(root) !== expected) throw new Error(`Restore the executable candidate for ${target.slug} before selecting it`);
    }
    await selectState(root, target.slug);
    console.log(`Selected ${target.slug}\nPhase: ${target.phase}\nNext: ${nextAction(target, await readConfig(root))}`);
    return;
  }
  throw new Error("Usage: agent-toolkit workflow list [--json] | workflow select <slug>");
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
    const projectArtifact = state.projectPath && state.projectPath !== state.designPath
      ? await readFile(path.join(root, state.projectPath), "utf8")
      : state.type === "project" ? design : "";
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
    const criticInstructions = state.type === "project"
      ? packet.stage === "design"
        ? "Perform the cycle's one comprehensive project-framing pass. Check outcomes, users, non-goals, source traceability, constraints, quality attributes, requirement observability and coverage, risks, decisions, milestone coherence and dependencies, and binding completion criteria. Reject predictive architecture presented as fact and unsupported claims. Report all demonstrated material defects now. Zero findings is valid; do not optimize for finding count or exhaustive reversible detail."
        : "Perform the cycle's one comprehensive project-integration pass. Check every required outcome, completion criterion, reconciled milestone, project-wide interaction, final integration command and assessment against the complete repository candidate. Catch missing delivery, cross-milestone regressions, stale claims, and incomplete operational behavior. Report all demonstrated material defects now. Zero findings is valid; do not optimize for findings or request work outside the reviewed project contract."
      : packet.stage === "design"
        ? "Perform the cycle's one comprehensive discovery pass. Check every explicit requirement, example, applicable project instruction, support-envelope decision, responsibility owner, reuse decision, architectural role, dependency direction, approved abstraction, placement, and planned observable slice. Reject unclear or generic ownership, unrelated concepts collapsed together, semantic duplication across owners or slices, infrastructure leakage contrary to project rules, unjustified one-implementation abstractions, and placement too vague to build without re-deciding architecture. Ask whether the responsibilities and dependency direction would still make sense if infrastructure technology changed. Report all demonstrated material defects now. Zero findings is valid: do not optimize for finding count, speculative hardening, or exhaustive reversible detail."
        : "Perform the cycle's one comprehensive discovery pass. Compare the canonical candidate and Implementation Conformance to every explicit reviewed requirement, support-envelope decision, responsibility owner, reuse decision, architectural role, dependency direction, approved abstraction, expected placement, and vertical slice. Specifically catch behavior moved or collapsed into a different owner, duplicated authoritative behavior, new cross-boundary dependencies or major abstractions, violated AGENTS.md module constraints or other governing constraints, regressions, and slices that do not build and run. Report all demonstrated material defects now. Zero findings is valid; do not optimize for findings or request production changes for hypothetical behavior outside the reviewed contract.";
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
      instructions: `Review only the supplied project framing, change design when present, system map, canonical candidate, test evidence, and findings. Use one fresh critic context and one distinct verifier context per cycle; reuse that verifier context for closure retries. ${packet.role === "critic" ? criticInstructions : verifierInstructions} Every finding needs a concrete reviewed contract reference, candidate evidence, and observable impact. Write JSON matching the supplied schema directly to findingsPath, including {"findings":[]} for approval. Do not create review output anywhere else in the project.`,
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["findings"],
        properties: { findings: { type: "array", items: packet.role === "critic" ? criticFinding : verifierFinding } }
      },
      project: projectArtifact,
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
    case "project": return project();
    case "workflow": return workflow();
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
