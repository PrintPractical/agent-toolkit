import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { artifactFingerprint, candidateFingerprint, designContractFingerprint, executableFingerprint } from "./fingerprints.mjs";
import { implementationSlices, projectIntegrationCommands, projectMilestones, validateArtifacts } from "./artifacts.mjs";
import { currentHead } from "./git.mjs";
import { withDirectoryLock } from "./locks.mjs";

export const PHASES = [
  "shaping", "developer-review", "design-critic", "design-remediation", "design-verifier",
  "ready-to-build", "implementing", "baseline-sealed", "quality-critic",
  "quality-remediation", "quality-verifier", "review-escalation", "ready-to-commit", "active",
  "integration-testing", "complete"
];

const stateDirectory = root => path.join(root, ".agent", ".state");
const registryPath = root => path.join(stateDirectory(root), "registry.json");
const validSlug = slug => typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 64;

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, file);
}

export async function loadRegistry(root) {
  let registry;
  try { registry = JSON.parse(await readFile(registryPath(root), "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return { version: 1, current: null, workflows: [] };
    throw new Error(`Invalid workflow registry: ${error.message}`);
  }
  if (registry?.version !== 1 || !Array.isArray(registry.workflows)
    || new Set(registry.workflows).size !== registry.workflows.length
    || registry.workflows.some(slug => !validSlug(slug))
    || (registry.current !== null && !registry.workflows.includes(registry.current))) {
    throw new Error("Invalid workflow registry");
  }
  return registry;
}

async function saveRegistry(root, registry) {
  await mkdir(stateDirectory(root), { recursive: true });
  await writeJsonAtomic(registryPath(root), registry);
}

export async function createState(root, data) {
  await mkdir(stateDirectory(root), { recursive: true });
  const registry = await loadRegistry(root);
  if (!validSlug(data.slug)) throw new Error("Workflow slug is invalid");
  if (registry.workflows.includes(data.slug)) throw new Error(`Workflow already exists: ${data.slug}`);
  const state = {
    version: 2,
    artifactFormat: 4,
    type: "change",
    id: randomUUID(),
    phase: "shaping",
    createdAt: new Date().toISOString(),
    evidence: [],
    packets: [],
    findings: [],
    reviews: {},
    ...data
  };
  await saveState(root, state);
  registry.workflows.push(state.slug);
  registry.current = state.slug;
  await saveRegistry(root, registry);
  return state;
}

export async function loadState(root, requestedSlug) {
  const registry = await loadRegistry(root);
  const slug = requestedSlug || registry.current;
  if (!slug) throw new Error("No current workflow. Start a project or change, or run: agent-toolkit workflow select <slug>");
  if (!registry.workflows.includes(slug)) throw new Error(`Unknown workflow: ${slug}`);
  try {
    const state = JSON.parse(await readFile(path.join(stateDirectory(root), `${slug}.json`), "utf8"));
    if (state.version !== 2 || state.slug !== slug || !["project", "change"].includes(state.type)) throw new Error("unsupported state schema");
    return state;
  } catch (error) {
    throw new Error(`Invalid runtime state for ${slug}: ${error.message}`);
  }
}

export async function listStates(root) {
  const registry = await loadRegistry(root);
  return Promise.all(registry.workflows.map(slug => loadState(root, slug)));
}

export async function selectState(root, slug) {
  const registry = await loadRegistry(root);
  if (!registry.workflows.includes(slug)) throw new Error(`Unknown workflow: ${slug}`);
  registry.current = slug;
  await saveRegistry(root, registry);
  return loadState(root, slug);
}

export async function saveState(root, state) {
  if (state.version !== 2 || !validSlug(state.slug)) throw new Error("Cannot save unsupported runtime state");
  await mkdir(stateDirectory(root), { recursive: true });
  const target = path.join(stateDirectory(root), `${state.slug}.json`);
  await writeJsonAtomic(target, state);
}

export async function withStateLock(root, operation) {
  const directory = stateDirectory(root);
  const lock = path.join(directory, "command.lock");
  await mkdir(directory, { recursive: true });
  return withDirectoryLock(lock, "Another toolkit command is running; retry after it completes", operation);
}

function evidenceEligible(item) {
  return !item.candidateChanged && !item.timedOut && !item.error && !item.signal && Number.isInteger(item.code);
}

function latestEvidenceByCommand(state, predicate) {
  const latest = new Map();
  for (const item of state.evidence) {
    if (predicate(item)) latest.set(commandKey(item), item);
  }
  return [...latest.values()];
}

export function currentEvidence(state, fingerprint, predicate = () => true) {
  return latestEvidenceByCommand(state, item => item.fingerprint === fingerprint)
    .some(item => evidenceEligible(item) && predicate(item));
}

export function hasCurrentPassingEvidence(state, fingerprint) {
  return currentEvidence(state, fingerprint, item => !item.expectFail && item.code === 0);
}

export function findingStatus(finding) {
  if (finding.status) return finding.status;
  if (finding.retired) return "retired";
  return finding.resolved ? "resolved" : "open";
}

export function findingNeedsClosure(finding) {
  return !["resolved", "disposition-pending", "disposition-verified", "retired"].includes(findingStatus(finding));
}

export function findingBlocksCompletion(finding) {
  return !["resolved", "disposition-verified", "retired"].includes(findingStatus(finding));
}

function commandKey(item) {
  return JSON.stringify(item.command);
}

function missingSliceAcceptance(state, fingerprint) {
  const available = latestEvidenceByCommand(state, item => item.kind === "acceptance"
    && item.fingerprint === fingerprint);
  const requiredCommands = new Set();
  const missing = [];
  for (const slice of state.implementation?.slices || []) {
    const key = JSON.stringify(slice.acceptanceCommand);
    if (requiredCommands.has(key)) continue;
    requiredCommands.add(key);
    const evidence = available.find(item => commandKey(item) === key);
    if (!evidence || !evidenceEligible(evidence) || evidence.expectFail || evidence.code !== 0) missing.push(slice);
  }
  return missing;
}

function currentSliceAcceptance(state, fingerprint) {
  return missingSliceAcceptance(state, fingerprint).length === 0;
}

function missingIntegrationEvidence(state, fingerprint) {
  const latest = new Map();
  for (const item of state.evidence.slice(state.integration?.evidenceStartIndex || 0)) {
    if (item.kind === "integration" && item.fingerprint === fingerprint) latest.set(commandKey(item), item);
  }
  const available = [...latest.values()];
  return (state.integration?.commands || []).filter(command => {
    const evidence = available.find(item => commandKey(item) === JSON.stringify(command));
    return !evidence || !evidenceEligible(evidence) || evidence.expectFail || evidence.code !== 0;
  });
}

function remediationEvidenceError(state, fingerprint) {
  const missing = missingSliceAcceptance(state, fingerprint);
  if (missing.length) {
    const commands = missing.map(slice => `Slice ${slice.number}: agent-toolkit test --kind acceptance -- ${slice.acceptanceCommand.join(" ")}`);
    return `Rerun each reviewed slice acceptance command against the remediated candidate:\n${commands.join("\n")}`;
  }
  return "Run relevant tests for the remediated candidate";
}

function hasPassingRegression(state, fingerprint) {
  const failure = state.evidence.find(item => item.id === state.regression?.evidenceId
    && evidenceEligible(item) && item.kind === "regression" && item.expectFail && item.code !== 0);
  if (!failure || commandKey(failure) !== JSON.stringify(state.regression.command)) return false;
  const latest = latestEvidenceByCommand(state, item => item.kind === "regression"
    && item.fingerprint === fingerprint).find(item => commandKey(item) === commandKey(failure));
  return Boolean(latest && evidenceEligible(latest) && !latest.expectFail && latest.code === 0);
}

export function hasRequiredCurrentEvidence(state, fingerprint) {
  if (state.type === "project") return Boolean(state.integration?.commands?.length)
    && missingIntegrationEvidence(state, fingerprint).length === 0;
  return hasCurrentPassingEvidence(state, fingerprint)
    && (state.kind !== "fix" || hasPassingRegression(state, fingerprint))
    && (!state.implementation || currentSliceAcceptance(state, fingerprint));
}

export async function registerMilestone(root, project, change, number) {
  if (project.type !== "project" || project.phase !== "active") throw new Error("Milestones require an active reviewed project");
  await requireCurrentDesign(root, project);
  const content = await readFile(path.join(root, project.projectPath), "utf8");
  const milestone = projectMilestones(content).find(item => item.number === number);
  if (!milestone) throw new Error(`Unknown project milestone: ${number}`);
  if (milestone.kind !== change.kind) throw new Error(`Milestone ${number} requires kind ${milestone.kind}`);
  if (milestone.status !== "active") throw new Error(`Mark Milestone ${number} active before starting it`);
  const dependencies = milestone.dependencies || [];
  const incomplete = [];
  for (const dependency of dependencies) if (!await milestoneDeliveryComplete(root, project, dependency)) incomplete.push(dependency);
  if (incomplete.length) throw new Error(`Milestone ${number} is blocked by incomplete milestones: ${incomplete.join(", ")}`);
  const existing = project.milestones?.[number];
  if (existing && existing.workflow !== change.slug) throw new Error(`Milestone ${number} is already linked to ${existing.workflow}`);
  (project.milestones ||= {})[number] = { workflow: change.slug, linkedAt: new Date().toISOString() };
  change.projectSlug = project.slug;
  change.projectPath = project.projectPath;
  change.projectSources = project.sources || [];
  change.milestone = { number, title: milestone.title, requirements: milestone.requirements };
  await saveState(root, project);
  await saveState(root, change);
}

export async function milestoneDeliveryComplete(root, project, number) {
  const link = project.milestones?.[number];
  if (!link?.workflow || !link.deliveredAt) return false;
  let child;
  try { child = await loadState(root, link.workflow); } catch { return false; }
  return child.type === "change" && child.phase === "complete" && child.projectSlug === project.slug
    && child.milestone?.number === number && child.milestoneDeliveredAt === link.deliveredAt
    && (child.commitSha || null) === (link.commitSha || null);
}

export async function reconcileMilestone(root, change) {
  if (change.type !== "change" || !change.projectSlug || !change.milestone) throw new Error("Current change is not a project milestone");
  if (change.phase !== "implementing") throw new Error("Reconcile a milestone after implementation slices and before baseline sealing");
  const incomplete = change.implementation?.slices?.find(slice => !slice.completedAt);
  if (incomplete) throw new Error(`Complete Slice ${incomplete.number} before reconciling the milestone`);
  const project = await loadState(root, change.projectSlug);
  const content = await readFile(path.join(root, project.projectPath), "utf8");
  const milestone = projectMilestones(content).find(item => item.number === change.milestone.number);
  if (!milestone || milestone.status !== "complete") throw new Error(`Mark Milestone ${change.milestone.number} complete in ${project.projectPath}`);
  const coverage = content.match(/^## Requirement Coverage\s*\n([\s\S]*?)(?=\n## |(?![\s\S]))/m)?.[1] || "";
  const missing = change.milestone.requirements.filter(id => !new RegExp(`(^|\\n)[-*]\\s+${id}:.*Milestone ${change.milestone.number}.*complete`, "i").test(coverage));
  if (missing.length) throw new Error(`Record completed requirement coverage for Milestone ${change.milestone.number}: ${missing.join(", ")}`);
  const reconciledAt = new Date().toISOString();
  project.milestones[change.milestone.number] = { ...project.milestones[change.milestone.number], reconciledAt };
  change.milestoneReconciledAt = reconciledAt;
  await saveState(root, project);
  await saveState(root, change);
  return project;
}

export async function recordMilestoneDelivery(root, change, { commitSha } = {}) {
  if (!change.projectSlug || !change.milestone) return null;
  if (change.phase !== "complete") throw new Error("A project milestone is delivered only after its workflow completes");
  if (change.reviews?.["quality-verifier"]?.verdict !== "approved") throw new Error("A project milestone is delivered only after quality-verifier approval");
  const linkedCommit = commitSha || change.commitSha;
  if (change.commitSha && linkedCommit !== change.commitSha) throw new Error("Milestone delivery commit does not match the completed workflow");
  if (linkedCommit) {
    if (await currentHead(root) !== linkedCommit) throw new Error("Restore the completed milestone commit before recording project delivery");
  } else {
    const reviewFingerprint = await candidateFingerprint(root, change);
    const evidenceFingerprint = await executableFingerprint(root);
    if (change.reviews["quality-verifier"].fingerprint !== reviewFingerprint || !hasRequiredCurrentEvidence(change, evidenceFingerprint)) {
      throw new Error("Restore the quality-verified milestone candidate before recording project delivery");
    }
  }
  const project = await loadState(root, change.projectSlug);
  const link = project.milestones?.[change.milestone.number];
  if (link?.workflow !== change.slug || !link.reconciledAt) throw new Error("The completed milestone is not reconciled with its project");
  if (link.deliveredAt && change.milestoneDeliveredAt && link.deliveredAt !== change.milestoneDeliveredAt) {
    throw new Error("Project and milestone delivery records disagree");
  }
  const deliveredAt = change.milestoneDeliveredAt || link.deliveredAt || new Date().toISOString();
  change.milestoneDeliveredAt = deliveredAt;
  await saveState(root, change);
  link.deliveredAt = deliveredAt;
  if (linkedCommit) {
    link.commitSha = linkedCommit;
    project.baseHead = linkedCommit;
  }
  project.baseExecutableFingerprint = await executableFingerprint(root);
  await saveState(root, project);
  return project;
}

export async function finalizeProject(root, state) {
  if (state.type !== "project" || !["active", "integration-testing"].includes(state.phase)) throw new Error("Only an active reviewed project can enter final integration");
  await requireCurrentDesign(root, state);
  const problems = await validateArtifacts(root, state, { requireSystem: true, requireProjectCompletion: true });
  if (problems.length) throw new Error(problems.join("\n"));
  const content = await readFile(path.join(root, state.projectPath), "utf8");
  const milestones = projectMilestones(content).filter(item => item.status !== "removed");
  const incomplete = [];
  for (const milestone of milestones) {
    if (!await milestoneDeliveryComplete(root, state, milestone.number)) incomplete.push(milestone.number);
  }
  if (incomplete.length) throw new Error(`Deliver every completed milestone before final integration: ${incomplete.join(", ")}`);
  state.integration = {
    commands: projectIntegrationCommands(content),
    evidenceStartIndex: state.evidence.length,
    startedAt: new Date().toISOString()
  };
  state.phase = "integration-testing";
  await saveState(root, state);
  return state;
}

function requireVerifiedCandidate(state, fingerprint, evidenceFingerprint) {
  const verified = state.reviews["quality-verifier"];
  if (!verified || verified.verdict !== "approved" || verified.fingerprint !== fingerprint) {
    throw new Error("Current change does not match the approved quality-verifier candidate");
  }
  if (!hasRequiredCurrentEvidence(state, evidenceFingerprint)) {
    throw new Error(state.kind === "fix"
      ? "Current passing evidence for the recorded regression command is required for the verified fix"
      : "Current passing test evidence is required for the verified candidate");
  }
  if (state.findings.some(findingBlocksCompletion)) throw new Error("Resolve or verify a disposition for all findings before completion");
}

export async function requireCurrentDesign(root, state) {
  if (!state.developerApproval) {
    throw new Error("Developer approval is required; run: agent-toolkit review restart --stage design");
  }
  const current = await designContractFingerprint(root, state);
  if (state.reviews["design-verifier"]?.contractFingerprint !== current) {
    throw new Error("Material design sections changed; run: agent-toolkit review restart --stage design");
  }
}

export async function completeSlice(root, state, number) {
  if (state.phase !== "implementing") throw new Error("Slices can only be completed during implementation");
  await requireCurrentDesign(root, state);
  const slices = state.implementation?.slices;
  if (!slices?.length) throw new Error("The reviewed design has no objective implementation slices");
  const next = slices.find(slice => !slice.completedAt);
  if (!next) throw new Error("Every implementation slice is already complete; run: agent-toolkit advance");
  if (number !== next.number) throw new Error(`Complete slices in reviewed order; next is Slice ${next.number}`);
  const required = slices.filter(slice => slice.completedAt).map(slice => slice.number).concat(number);
  const problems = await validateArtifacts(root, state, {
    requireSystem: true,
    requireConformance: true,
    conformanceSliceNumbers: required
  });
  if (problems.length) throw new Error(problems.join("\n"));
  const fingerprint = await executableFingerprint(root);
  const priorEvidenceIds = new Set(slices.map(slice => slice.evidenceId).filter(Boolean));
  const previousEvidenceId = slices.filter(slice => slice.completedAt).at(-1)?.evidenceId;
  const previousEvidenceIndex = previousEvidenceId
    ? state.evidence.findIndex(item => item.id === previousEvidenceId)
    : state.implementation.evidenceStartIndex - 1;
  const evidence = [...state.evidence.slice(previousEvidenceIndex + 1)].reverse().find(item => item.kind === "acceptance"
    && item.fingerprint === fingerprint
    && commandKey(item) === JSON.stringify(next.acceptanceCommand) && !priorEvidenceIds.has(item.id));
  if (!evidence || !evidenceEligible(evidence) || evidence.expectFail || evidence.code !== 0) {
    throw new Error(`Run Slice ${number}'s reviewed acceptance command through: agent-toolkit test --kind acceptance -- ${next.acceptanceCommand.join(" ")}`);
  }
  next.completedAt = new Date().toISOString();
  next.fingerprint = fingerprint;
  next.evidenceId = evidence.id;
  await saveState(root, state);
  return next;
}

export async function advance(root, state, config) {
  const artifactHash = await artifactFingerprint(root, state);
  const reviewHash = await candidateFingerprint(root, state);
  const evidenceHash = await executableFingerprint(root);
  switch (state.phase) {
    case "shaping": {
      const problems = await validateArtifacts(root, state, { requireSystem: true });
      if (problems.length) throw new Error(problems.join("\n"));
      state.phase = "developer-review";
      break;
    }
    case "design-remediation":
      if (state.findings.some(item => item.stage === "design" && findingNeedsClosure(item))) {
        throw new Error("Resolve all design findings before verification");
      }
      if (state.developerApproval?.fingerprint !== artifactHash) {
        delete state.developerApproval;
        state.developerReviewTarget = "design-verifier";
        state.developerReviewFingerprint = artifactHash;
        state.phase = "developer-review";
      } else {
        state.phase = "design-verifier";
      }
      break;
    case "ready-to-build":
      if (state.type !== "change") throw new Error("Projects do not enter implementation slices");
      if (!state.developerApproval) {
        throw new Error("Developer approval is required; run: agent-toolkit review restart --stage design");
      }
      if (state.reviews["design-verifier"]?.fingerprint !== artifactHash) {
        throw new Error("Design artifacts changed after verification; review them again");
      }
      if (config.github.issues.policy === "create" && !state.issue) {
        throw new Error("GitHub issue required. Run: agent-toolkit issue ensure");
      }
      if (config.github.issues.policy === "existing" && !state.issue) {
        throw new Error("Existing GitHub issue required. Run: agent-toolkit issue link <number>");
      }
      if (state.kind === "fix" && !state.regression) {
        const failure = latestEvidenceByCommand(state, item => item.fingerprint === evidenceHash
          && item.kind === "regression").find(item => evidenceEligible(item) && item.expectFail && item.code !== 0);
        if (!failure) throw new Error("Record an expected-failing regression test before implementation");
        state.regression = { evidenceId: failure.id, command: failure.command };
      }
      const design = await readFile(path.join(root, state.designPath), "utf8");
      state.implementation = {
        startedAt: new Date().toISOString(),
        evidenceStartIndex: state.evidence.length,
        slices: implementationSlices(design).map(slice => ({
          number: slice.number,
          title: slice.title,
          acceptanceCommand: slice.acceptanceCommand
        }))
      };
      state.phase = "implementing";
      break;
    case "implementing": {
      await requireCurrentDesign(root, state);
      const incomplete = state.implementation?.slices?.find(slice => !slice.completedAt);
      if (incomplete) throw new Error(`Complete Slice ${incomplete.number} before sealing the implementation`);
      if (!currentSliceAcceptance(state, evidenceHash)) {
        throw new Error("Run each reviewed slice acceptance command against the final candidate before sealing the implementation");
      }
      const problems = await validateArtifacts(root, state, { requireSystem: true, requireConformance: true });
      if (problems.length) throw new Error(problems.join("\n"));
      const passing = hasCurrentPassingEvidence(state, evidenceHash);
      if (!passing) throw new Error("Current passing test evidence required before sealing the implementation");
      if (state.kind === "fix") {
        if (!hasPassingRegression(state, evidenceHash)) {
          throw new Error("Run the recorded regression command successfully before sealing the fix");
        }
      }
      if (state.projectSlug && !state.milestoneReconciledAt) {
        throw new Error("Reconcile the completed milestone into its project before sealing the implementation");
      }
      state.baseline = { fingerprint: reviewHash, evidenceFingerprint: evidenceHash, designFingerprint: artifactHash, sealedAt: new Date().toISOString() };
      state.phase = "baseline-sealed";
      break;
    }
    case "integration-testing": {
      await requireCurrentDesign(root, state);
      const problems = await validateArtifacts(root, state, { requireSystem: true, requireProjectCompletion: true });
      if (problems.length) throw new Error(problems.join("\n"));
      const content = await readFile(path.join(root, state.projectPath), "utf8");
      if (JSON.stringify(projectIntegrationCommands(content)) !== JSON.stringify(state.integration.commands)) {
        throw new Error("Final Integration commands changed after finalization; run: agent-toolkit project finalize");
      }
      const missing = missingIntegrationEvidence(state, evidenceHash);
      if (missing.length) throw new Error(`Run every reviewed final integration command:\n${missing.map(command => `agent-toolkit test --kind integration -- ${command.join(" ")}`).join("\n")}`);
      state.baseline = { fingerprint: reviewHash, evidenceFingerprint: evidenceHash, designFingerprint: artifactHash, sealedAt: new Date().toISOString() };
      state.phase = "baseline-sealed";
      break;
    }
    case "baseline-sealed":
      if (reviewHash !== state.baseline.fingerprint) {
        throw new Error("Candidate changed after baseline sealing; run: agent-toolkit review restart --stage quality");
      }
      if (!hasRequiredCurrentEvidence(state, evidenceHash)) {
        throw new Error("Current required test evidence no longer matches the sealed baseline");
      }
      state.phase = "quality-critic";
      break;
    case "quality-remediation":
      if (state.findings.some(item => item.stage === "quality" && findingNeedsClosure(item))) {
        throw new Error("Resolve all quality findings before verification");
      }
      if (!hasRequiredCurrentEvidence(state, evidenceHash)) {
        throw new Error(state.kind === "fix"
          ? "Run the recorded regression command successfully for the remediated fix"
          : remediationEvidenceError(state, evidenceHash));
      }
      state.phase = "quality-verifier";
      break;
    case "ready-to-commit":
      if (state.type !== "change") throw new Error("Projects complete after final integration verification");
      await requireCurrentDesign(root, state);
      requireVerifiedCandidate(state, reviewHash, evidenceHash);
      if (config.completion.commit.policy === "off" || !state.git) state.phase = "complete";
      else throw new Error("Commit required. Run: agent-toolkit commit prepare");
      break;
    case "design-critic":
    case "design-verifier":
    case "quality-critic":
    case "quality-verifier":
      throw new Error(`Review required. Run: agent-toolkit review prepare --stage ${state.phase.startsWith("design") ? "design" : "quality"} --role ${state.phase.endsWith("critic") ? "critic" : "verifier"}`);
    case "developer-review":
      throw new Error("Developer feedback required. Run: agent-toolkit feedback record --verdict approved|changes-requested");
    case "review-escalation":
      throw new Error("Developer decision required. Run: agent-toolkit escalation record --decision <decision>");
    case "complete":
      if (state.projectSlug) {
        await recordMilestoneDelivery(root, state, { commitSha: state.commitSha });
        return state;
      }
      throw new Error("Workflow is already complete");
    case "active":
      throw new Error("Active projects accept milestone work; run: agent-toolkit project finalize only when completion criteria are met");
    default:
      throw new Error(`Cannot advance unknown phase: ${state.phase}`);
  }
  await saveState(root, state);
  if (state.phase === "complete" && state.projectSlug) {
    await recordMilestoneDelivery(root, state, { commitSha: state.commitSha });
  }
  return state;
}

export function nextAction(state, config) {
  const pendingSlice = state.implementation?.slices?.find(slice => !slice.completedAt);
  const map = {
    shaping: state.type === "project" ? "Complete the project frame and system map, then run: agent-toolkit advance" : "Complete the design, file/module placement plan, implementation plan, and system map, then run: agent-toolkit advance",
    "developer-review": state.type === "project" ? "Review the project frame, then run: agent-toolkit feedback record --verdict approved|changes-requested" : "Review the design, expected file/module placement, and implementation plan, then run: agent-toolkit feedback record --verdict approved|changes-requested",
    "design-critic": "agent-toolkit review prepare --stage design --role critic",
    "design-remediation": "Resolve design findings, then run: agent-toolkit advance",
    "design-verifier": "agent-toolkit review prepare --stage design --role verifier",
    "ready-to-build": config.github.issues.policy === "create" && !state.issue ? "agent-toolkit issue ensure" : config.github.issues.policy === "existing" && !state.issue ? "agent-toolkit issue link <number>" : state.kind === "fix" ? "agent-toolkit advance" : "Stop the design workflow and start the build skill; it will verify this handoff before running: agent-toolkit advance",
    active: "Design the next unblocked roadmap milestone, or run agent-toolkit project finalize when all completion criteria are met",
    "integration-testing": "Run every Final Integration acceptance command with agent-toolkit test --kind integration, then run: agent-toolkit advance",
    implementing: pendingSlice
      ? `Implement only Slice ${pendingSlice.number}, run its reviewed acceptance command, then run: agent-toolkit slice complete --number ${pendingSlice.number}`
      : "All slices are complete; run: agent-toolkit advance",
    "baseline-sealed": "agent-toolkit advance",
    "quality-critic": "agent-toolkit review prepare --stage quality --role critic",
    "quality-remediation": "Resolve quality findings, rerun tests, then run: agent-toolkit advance",
    "quality-verifier": "agent-toolkit review prepare --stage quality --role verifier",
    "review-escalation": "Disposition remaining findings or record a developer escalation decision",
    "ready-to-commit": state.git && config.completion.commit.policy !== "off" ? "agent-toolkit commit prepare" : "agent-toolkit advance",
    complete: state.type === "project" ? "No action; the project is complete" : "No action; the change is complete"
  };
  return map[state.phase];
}
