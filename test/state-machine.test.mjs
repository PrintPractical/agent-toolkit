import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderChange, renderProject, renderSystem } from "../src/artifacts.mjs";
import { DEFAULT_CONFIG } from "../src/config.mjs";
import { recordTest } from "../src/evidence.mjs";
import { recordDeveloperFeedback } from "../src/feedback.mjs";
import { dispositionFinding, prepareReview, recordEscalation, recordReview, resolveFinding, restartDesignReview, restartQualityReview } from "../src/reviews.mjs";
import { artifactFingerprint, designContractFingerprint, executableFingerprint, projectFingerprint } from "../src/fingerprints.mjs";
import { advance, completeSlice, createState, finalizeProject, listStates, loadRegistry, loadState, milestoneDeliveryComplete, nextAction, reconcileMilestone, recordMilestoneDelivery, registerMilestone, saveState, selectState } from "../src/state-machine.mjs";
import { temporaryDirectory } from "./helpers.mjs";

async function project(kind = "feature") {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind, title: "Deliver Result", slug: "deliver-result" });
  const content = await readFile(design, "utf8");
  await writeFile(design, content
    .replace(/(## Requirements Traceability\n)[\s\S]*?(?=\n## )/, "$11. Requested result -> use case, contract, and tests.\n")
    .replace(/(## Boundaries and Dependencies\n)[\s\S]*?(?=\n## )/, "$11. Results use storage and preserve failure behavior.\n")
    .replace(/(## (?:Abstraction and Extension Pressure|Correction and Extension Pressure)\n)[\s\S]*?(?=\n## )/, "$11. ResultStore provides the persistence behavior needed by results.\n")
    .replace(/(## Existing Capabilities and Reuse\n)[\s\S]*?(?=\n## )/, "$11. Inspected ResultStore; extend it because it owns result persistence behavior.\n")
    .replace(/(## File and Module Placement Plan\n)[\s\S]*?(?=\n## )/, "$1| Path or module | Action | Responsibility | Constraint | Slice |\n| --- | --- | --- | --- | --- |\n| src/result.js | Modify | Result behavior | Use the existing ResultStore | 1 |\n")
    .replace(/(## Implementation Plan\n)[\s\S]*?(?=\n## )/, `$1### Slice 1: Result is delivered\n- Outcome: The observable result is returned.\n- Entry point: Result command.\n- Core behavior: Apply result rules.\n- Boundary integration: Persist through ResultStore.\n- Tests: Rule unit test and storage integration test.\n- Acceptance command: ${JSON.stringify([process.execPath, "-e", "process.exit(0)"])}\n- Complete when: The command builds and tests pass.\n`)
    .replace(/(## Implementation Conformance\n)[\s\S]*?(?=\n## )/, "$1### Architecture Decisions\n- Decision: Results use the existing ResultStore.\n- Implementation: The result command stores results.\n- Verification: Unit and storage integration tests.\n\n### Slice Completion\n#### Slice 1: Result is delivered\n- Slice: Slice 1 delivers the result.\n- Implementation: Command, rules, and storage are integrated.\n- Verification: The command builds and tests pass.\n"));
  await renderSystem(root);
  const state = await createState(root, { slug: "deliver-result", kind, title: "Deliver Result", designPath: ".agent/changes/deliver-result.md", git: false });
  assert.equal(state.artifactFormat, 4);
  return { root, state };
}

async function rollingProject() {
  const root = await temporaryDirectory();
  const artifact = await renderProject(root, { title: "Delivery Platform", slug: "delivery-platform" });
  const command = [process.execPath, "-e", "process.exit(0)"];
  const content = (await readFile(artifact, "utf8"))
    .replace(/(## Outcome\n)[\s\S]*?(?=\n## )/, "$1Teams deliver independently reviewed milestones and recognize project completion from integration evidence.\n")
    .replace(/(## Non-goals\n)[\s\S]*?(?=\n## )/, "$1Automated Git operations and predictive architecture are excluded.\n")
    .replace(/(## Required Outcomes\n)[\s\S]*?(?=\n## )/, "$1### Requirement REQ-1: Deliver a reviewed milestone\n- Outcome: A milestone completes the normal change lifecycle.\n- Acceptance: Its quality verifier approves the integrated candidate.\n")
    .replace(/(## Known Constraints\n)[\s\S]*?(?=\n## )/, "$1Non-Git operation remains supported and no command pushes.\n")
    .replace(/(## Quality Attributes\n)[\s\S]*?(?=\n## )/, "$1Review and evidence records remain candidate-fingerprinted.\n")
    .replace(/(## Decisions and Hypotheses\n)[\s\S]*?(?=\n## )/, "$1- [committed] A milestone is a normal feature workflow with all existing gates.\n")
    .replace(/(## Roadmap\n)[\s\S]*?(?=\n## )/, "$1### Milestone 1: Deliver one workflow\n- Kind: feature\n- Outcome: One milestone is independently delivered.\n- Requirements: [\"REQ-1\"]\n- Dependencies: []\n- Status: active\n")
    .replace(/(## Requirement Coverage\n)[\s\S]*?(?=\n## )/, "$1- REQ-1: Milestone 1 planned.\n")
    .replace(/(## Completion Criteria\n)[\s\S]*?(?=\n## )/, "$1The milestone is reconciled and final integration succeeds.\n")
    .replace('- Acceptance commands: [["npm", "test"]]', `- Acceptance commands: ${JSON.stringify([command])}`);
  await writeFile(artifact, content);
  await renderSystem(root);
  const state = await createState(root, {
    type: "project",
    kind: "project",
    slug: "delivery-platform",
    title: "Delivery Platform",
    projectPath: ".agent/projects/delivery-platform.md",
    designPath: ".agent/projects/delivery-platform.md",
    sources: [],
    milestones: {},
    git: false,
    baseExecutableFingerprint: await executableFingerprint(root)
  });
  return { root, state, artifact, command };
}

async function markDesignApproved(root, state) {
  state.developerApproval = { fingerprint: await artifactFingerprint(root, state) };
  state.reviews["design-verifier"] = {
    verdict: "approved",
    fingerprint: await artifactFingerprint(root, state),
    contractFingerprint: await designContractFingerprint(root, state)
  };
}

async function reachDesignCritic(root, state) {
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "developer-review");
  await recordDeveloperFeedback(root, state, { verdict: "approved" });
}

async function writePacketFindings(root, packet, content) {
  const file = path.join(root, packet.findingsPath);
  await writeFile(file, content);
  return file;
}

async function approveReview(root, state, packet, reviewer) {
  const findingsFile = await writePacketFindings(root, packet, JSON.stringify({ findings: [] }));
  return recordReview(root, state, {
    packetId: packet.id,
    verdict: "approved",
    reviewer,
    findingsFile
  });
}

function finding(description, extra = {}) {
  return {
    severity: "medium",
    description,
    contractReference: "Reviewed requirement R1",
    evidence: "The supplied candidate demonstrates the gap",
    observableImpact: "The reviewed behavior is not delivered",
    ...extra
  };
}

test("design requires a fresh critic and distinct verifier", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  await approveReview(root, state, critic, "critic-session");
  const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  await assert.rejects(recordReview(root, state, { packetId: verifier.id, verdict: "approved", reviewer: "critic-session" }), /distinct/);
  const invented = await writePacketFindings(root, verifier, JSON.stringify({ findings: [finding("Claimed remediation regression", {
    severity: "high",
    introducedByRemediation: true,
    evidence: "No remediation actually occurred"
  })] }));
  await assert.rejects(recordReview(root, state, {
    packetId: verifier.id,
    verdict: "changes-requested",
    reviewer: "verifier-session",
    findingsFile: invented
  }), /critic approved without remediation/);
  await approveReview(root, state, verifier, "verifier-session");
  assert.equal(state.phase, "ready-to-build");
  assert.match(nextAction(state, DEFAULT_CONFIG), /Stop the design workflow and start the build skill/);
});

test("project framing requires developer approval, a fresh critic, and a distinct verifier", async () => {
  const { root, state } = await rollingProject();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  assert(critic.checklist.some(item => item.includes("roadmap coverage")));
  await approveReview(root, state, critic, "project-critic");
  const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  await assert.rejects(approveReview(root, state, verifier, "project-critic"), /distinct/);
  await approveReview(root, state, verifier, "project-verifier");
  assert.equal(state.phase, "active");
  assert.match(nextAction(state, DEFAULT_CONFIG), /next unblocked roadmap milestone/);
});

test("project completion requires delivered milestones, fresh integration evidence, critic, and verifier", async () => {
  const { root, state: projectState, artifact, command } = await rollingProject();
  let state = projectState;
  await reachDesignCritic(root, state);
  await approveReview(root, state, await prepareReview(root, state, { stage: "design", role: "critic" }), "project-critic");
  await approveReview(root, state, await prepareReview(root, state, { stage: "design", role: "verifier" }), "project-verifier");
  await writeFile(artifact, (await readFile(artifact, "utf8"))
    .replace("- Status: active", "- Status: complete")
    .replace("- REQ-1: Milestone 1 planned.", "- REQ-1: Milestone 1 complete with integration evidence.")
    .replace("- Assessment: Complete before final project review.", "- Assessment: The reconciled milestone and integration evidence satisfy completion criteria."));
  await renderChange(root, { kind: "feature", title: "Deliver Workflow", slug: "deliver-workflow" });
  const child = await createState(root, {
    slug: "deliver-workflow",
    kind: "feature",
    title: "Deliver Workflow",
    designPath: ".agent/changes/deliver-workflow.md",
    git: false,
    projectSlug: state.slug,
    milestone: { number: 1, title: "Deliver one workflow", requirements: ["REQ-1"] }
  });
  child.projectSlug = state.slug;
  child.milestone = { number: 1, title: "Deliver one workflow", requirements: ["REQ-1"] };
  child.phase = "complete";
  child.reviews["quality-verifier"] = { verdict: "approved" };
  state.milestones[1] = { workflow: child.slug, reconciledAt: new Date().toISOString(), deliveredAt: "interrupted-delivery" };
  await saveState(root, state);
  await saveState(root, child);
  assert.equal(await milestoneDeliveryComplete(root, state, 1), false);
  await assert.rejects(finalizeProject(root, state), /Deliver every completed milestone/);
  await writeFile(path.join(root, "delivered.js"), "export const delivered = true;\n");
  const deliveredFingerprint = await executableFingerprint(root);
  await recordTest(root, child, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  child.reviews["quality-verifier"].fingerprint = await projectFingerprint(root);
  await saveState(root, child);
  await recordMilestoneDelivery(root, child);
  state = await loadState(root, state.slug);
  assert.equal(state.baseExecutableFingerprint, deliveredFingerprint);
  await writeFile(path.join(root, "delivered.js"), "export const delivered = false;\n");
  await assert.rejects(advance(root, child, DEFAULT_CONFIG), /Restore the quality-verified milestone candidate/);
  await writeFile(path.join(root, "delivered.js"), "export const delivered = true;\n");
  await finalizeProject(root, state);
  const original = await readFile(artifact, "utf8");
  await writeFile(artifact, original.replace(JSON.stringify([command]), JSON.stringify([[process.execPath, "-e", "process.exit(1)"]])));
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /Final Integration commands changed after finalization/);
  await writeFile(artifact, original);
  await finalizeProject(root, state);
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /Run every reviewed final integration command/);
  await recordTest(root, state, { kind: "integration", expectFail: false, command: command[0], args: command.slice(1) });
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "baseline-sealed");
  await advance(root, state, DEFAULT_CONFIG);
  const critic = await prepareReview(root, state, { stage: "quality", role: "critic" });
  assert(critic.checklist.some(item => item.includes("cross-milestone")));
  await approveReview(root, state, critic, "integration-critic");
  await approveReview(root, state, await prepareReview(root, state, { stage: "quality", role: "verifier" }), "integration-verifier");
  assert.equal(state.phase, "complete");
});

test("workflow registry retains multiple states and changes only the current selector", async () => {
  const root = await temporaryDirectory();
  const first = await createState(root, { slug: "first-change", kind: "feature", title: "First Change", designPath: ".agent/changes/first-change.md", git: false });
  const second = await createState(root, { slug: "second-change", kind: "fix", title: "Second Change", designPath: ".agent/changes/second-change.md", git: false });
  assert.deepEqual((await loadRegistry(root)).workflows, [first.slug, second.slug]);
  assert.equal((await loadState(root)).slug, second.slug);
  assert.deepEqual((await listStates(root)).map(state => state.slug), [first.slug, second.slug]);
  await selectState(root, first.slug);
  assert.equal((await loadState(root)).slug, first.slug);
  assert.equal((await loadState(root, second.slug)).phase, "shaping");
});

test("reconciles multiline requirement coverage and invalidates it when reopened", async () => {
  const { root, state: parent, artifact } = await rollingProject();
  await writeFile(artifact, (await readFile(artifact, "utf8"))
    .replace("- Acceptance: Its quality verifier approves the integrated candidate.", "- Acceptance: Its quality verifier approves the integrated candidate.\n\n### Requirement REQ-2: Preserve delivery evidence\n- Outcome: Delivery evidence remains linked to the milestone.\n- Acceptance: Reconciliation records the completed requirement.\n\n### Requirement REQ-3: Expose delivery status\n- Outcome: The project records the milestone as delivered.\n- Acceptance: Reconciliation recognizes its completed coverage.")
    .replace('- Requirements: ["REQ-1"]', '- Requirements: ["REQ-1", "REQ-2", "REQ-3"]')
    .replace("- REQ-1: Milestone 1 planned.", "- REQ-1: Milestone 1 planned.\n- REQ-2: Milestone 1 planned.\n- REQ-3: Milestone 1 planned."));
  parent.phase = "active";
  await markDesignApproved(root, parent);
  const childArtifact = path.join(root, ".agent", "changes", "milestone-one.md");
  await renderChange(root, { kind: "feature", title: "Milestone One", slug: "milestone-one" });
  const linked = await createState(root, {
    slug: "milestone-one",
    kind: "feature",
    title: "Milestone One",
    designPath: path.relative(root, childArtifact),
    git: false,
    baseExecutableFingerprint: await executableFingerprint(root)
  });
  await registerMilestone(root, parent, linked, 1);
  linked.phase = "implementing";
  linked.implementation = { slices: [{ number: 1, completedAt: new Date().toISOString() }] };
  await writeFile(artifact, (await readFile(artifact, "utf8"))
    .replace("- Status: active", "- Status: complete")
    .replace("- REQ-1: Milestone 1 planned.", "- REQ-1: Milestone 1 complete.")
    .replace("- REQ-2: Milestone 1 planned.", "- REQ-2: Milestone 1 complete with linked evidence.")
    .replace("- REQ-3: Milestone 1 planned.", "- REQ-3: Milestone 1 complete."));
  await reconcileMilestone(root, linked);
  assert((await loadState(root, parent.slug)).milestones[1].reconciledAt);
  await restartDesignReview(root, linked);
  assert.equal((await loadState(root, parent.slug)).milestones[1].reconciledAt, undefined);
  assert.equal(linked.milestoneReconciledAt, undefined);
});

test("critic packets require a complete risk sweep before findings", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const design = await prepareReview(root, state, { stage: "design", role: "critic" });
  assert(design.checklist.some(item => item.includes("state freshness")));
  assert.match(design.checklist.at(-1), /do not stop after the first defect/);

  state.phase = "quality-critic";
  await markDesignApproved(root, state);
  state.baseline = { fingerprint: await projectFingerprint(root) };
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  const quality = await prepareReview(root, state, { stage: "quality", role: "critic" });
  assert(quality.checklist.some(item => item.includes("concurrency and locking")));
});

test("new review packets require structured JSON findings", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  const markdown = await writePacketFindings(root, critic, "# Findings\n\n- Material contract gap\n");
  await assert.rejects(recordReview(root, state, {
    packetId: critic.id,
    verdict: "changes-requested",
    reviewer: "critic",
    findingsFile: markdown
  }), /valid JSON/);
  const extra = await writePacketFindings(root, critic, JSON.stringify({ findings: [finding("Gap", { category: "contract" })] }));
  await assert.rejects(recordReview(root, state, {
    packetId: critic.id,
    verdict: "changes-requested",
    reviewer: "critic",
    findingsFile: extra
  }), /unsupported properties/);
  state.packets.find(item => item.id === critic.id).protocol = 4;
  await assert.rejects(recordReview(root, state, {
    packetId: critic.id,
    verdict: "changes-requested",
    reviewer: "critic",
    findingsFile: markdown
  }), /Unsupported review packet protocol/);
  await assert.rejects(recordReview(root, state, {
    packetId: critic.id,
    verdict: "approved",
    reviewer: "critic"
  }), /Unsupported review packet protocol/);
});

test("protocol 3 approvals require the packet's runtime response path", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const packet = await prepareReview(root, state, { stage: "design", role: "critic" });
  await assert.rejects(recordReview(root, state, {
    packetId: packet.id,
    verdict: "approved",
    reviewer: "critic"
  }), /must be saved to .*\.agent\/\.state\/reviews/);

  const scratch = path.join(root, "design-critic.json");
  await writeFile(scratch, JSON.stringify({ findings: [] }));
  await assert.rejects(recordReview(root, state, {
    packetId: packet.id,
    verdict: "approved",
    reviewer: "critic",
    findingsFile: scratch
  }), /packet's findingsPath/);

  await approveReview(root, state, packet, "critic");
  assert.equal(state.phase, "design-verifier");
});

test("protocol 2 packets are rejected", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const packet = await prepareReview(root, state, { stage: "design", role: "critic" });
  state.packets.find(item => item.id === packet.id).protocol = 2;
  const findingsFile = await writePacketFindings(root, packet, JSON.stringify({ findings: [finding("Structured finding")] }));
  await assert.rejects(
    recordReview(root, state, { packetId: packet.id, verdict: "changes-requested", reviewer: "protocol-2-critic", findingsFile }),
    /Unsupported review packet protocol/
  );
});

test("packets without a protocol are rejected", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const prepared = await prepareReview(root, state, { stage: "design", role: "critic" });
  delete state.packets.find(packet => packet.id === prepared.id).protocol;
  const findings = await writePacketFindings(root, prepared, JSON.stringify({ findings: [] }));
  await assert.rejects(recordReview(root, state, {
    packetId: prepared.id,
    verdict: "approved",
    reviewer: "critic",
    findingsFile: findings
  }), /Unsupported review packet protocol/);
});

test("verifier can only reopen supplied findings or report remediation regressions", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  const criticFindings = await writePacketFindings(root, critic, JSON.stringify({ findings: [finding("Define ordering at the public boundary")] }));
  await recordReview(root, state, {
    packetId: critic.id,
    verdict: "changes-requested",
    reviewer: "critic",
    findingsFile: criticFindings
  });
  const original = state.findings.at(-1);
  await resolveFinding(root, state, original.id);
  await advance(root, state, DEFAULT_CONFIG);

  const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  assert.deepEqual(verifier.findings.map(item => item.id), [original.id]);
  const expandedScope = await writePacketFindings(root, verifier, JSON.stringify({ findings: [finding("Specify another pre-existing detail")] }));
  await assert.rejects(recordReview(root, state, {
    packetId: verifier.id,
    verdict: "changes-requested",
    reviewer: "verifier",
    findingsFile: expandedScope
  }), /must reference a supplied finding ID/);

  const closure = await writePacketFindings(root, verifier, JSON.stringify({ findings: [finding("Ordering remains ambiguous in the revised example", { sourceFindingId: original.id })] }));
  await recordReview(root, state, {
    packetId: verifier.id,
    verdict: "changes-requested",
    reviewer: "verifier",
    findingsFile: closure
  });
  assert.equal(state.findings.length, 1);
  assert.equal(original.resolved, false);
  assert.match(original.verification.description, /remains ambiguous/);
  assert.equal(original.verification.evidence, "The supplied candidate demonstrates the gap");
});

test("closure packets retain evidence for regressions introduced by remediation", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  const criticFindings = await writePacketFindings(root, critic, JSON.stringify({ findings: [finding("Clarify ownership")] }));
  await recordReview(root, state, {
    packetId: critic.id,
    verdict: "changes-requested",
    reviewer: "critic",
    findingsFile: criticFindings
  });
  await resolveFinding(root, state, state.findings[0].id);
  await advance(root, state, DEFAULT_CONFIG);
  const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  const regressionFile = await writePacketFindings(root, verifier, JSON.stringify({ findings: [finding("The remediation inverted dependency direction", {
    severity: "high",
    introducedByRemediation: true,
    evidence: "The revised integration now violates its reviewed constraint"
  })] }));
  await recordReview(root, state, {
    packetId: verifier.id,
    verdict: "changes-requested",
    reviewer: "verifier-one",
    findingsFile: regressionFile
  });
  const regression = state.findings.at(-1);
  await resolveFinding(root, state, regression.id);
  await advance(root, state, DEFAULT_CONFIG);
  const closure = await prepareReview(root, state, { stage: "design", role: "verifier" });
  const supplied = closure.findings.find(finding => finding.id === regression.id);
  assert.equal(supplied.introducedByRemediation, true);
  assert.match(supplied.evidence, /violates its reviewed constraint/);
});

test("critic remediation changes return to developer approval before verification", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  const findingsFile = await writePacketFindings(root, critic, JSON.stringify({ findings: [finding("Clarify storage ownership")] }));
  await recordReview(root, state, {
    packetId: critic.id,
    verdict: "changes-requested",
    reviewer: "critic",
    findingsFile
  });
  const design = path.join(root, state.designPath);
  await writeFile(design, (await readFile(design, "utf8")).replace("Results use storage", "Results exclusively use storage"));
  await resolveFinding(root, state, state.findings.at(-1).id);
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "developer-review");
  assert.equal(state.developerApproval, undefined);
  await recordDeveloperFeedback(root, state, { verdict: "approved" });
  assert.equal(state.phase, "design-verifier");
  const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  assert.equal(verifier.cycleId, critic.id);
});

test("review restart invalidates prepared packets from the abandoned cycle", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const stale = await prepareReview(root, state, { stage: "design", role: "critic" });
  await restartDesignReview(root, state);
  await recordDeveloperFeedback(root, state, { verdict: "approved" });
  await assert.rejects(recordReview(root, state, {
    packetId: stale.id,
    verdict: "approved",
    reviewer: "stale-critic"
  }), /invalidated by a review restart/);
});

test("developer can request design changes before approving critic review", async () => {
  const { root, state } = await project();
  await advance(root, state, DEFAULT_CONFIG);
  const feedback = await recordDeveloperFeedback(root, state, {
    verdict: "changes-requested",
    notes: ["Clarify the ordering guarantee", "Split the persistence slice"]
  });
  assert.equal(state.phase, "shaping");
  assert.deepEqual(feedback.notes, ["Clarify the ordering guarantee", "Split the persistence slice"]);
  await advance(root, state, DEFAULT_CONFIG);
  await recordDeveloperFeedback(root, state, { verdict: "approved" });
  assert.equal(state.phase, "design-critic");
});

test("in-flight state cannot bypass developer approval", async () => {
  const { root, state } = await project();
  state.phase = "ready-to-build";
  state.reviews["design-verifier"] = {
    verdict: "approved",
    fingerprint: await artifactFingerprint(root, state),
    contractFingerprint: await designContractFingerprint(root, state)
  };
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /Developer approval/);
  await restartDesignReview(root, state);
  assert.equal(state.phase, "developer-review");
});

test("verifier cannot approve content changed after critic approval", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  await approveReview(root, state, critic, "critic-session");
  const design = path.join(root, state.designPath);
  await writeFile(design, (await readFile(design, "utf8")).replace("State the observable", "State the revised observable"));
  await assert.rejects(prepareReview(root, state, { stage: "design", role: "verifier" }), /changed after developer approval/);
  await restartDesignReview(root, state);
  assert.equal(state.phase, "developer-review");
});

test("verified design drift can restart from ready-to-build", async () => {
  const { root, state } = await project();
  state.phase = "ready-to-build";
  await markDesignApproved(root, state);
  const design = path.join(root, state.designPath);
  await writeFile(design, (await readFile(design, "utf8")).replace("State the observable", "State the replacement observable"));
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /changed after verification/);
  await restartDesignReview(root, state);
  assert.equal(state.phase, "developer-review");
});

test("design restart retires findings from abandoned review cycles", async () => {
  const { root, state } = await project();
  state.phase = "quality-remediation";
  state.findings.push(
    { id: "old-design", stage: "design", description: "Old design finding", resolved: false },
    { id: "old-quality", stage: "quality", description: "Old quality finding", resolved: false }
  );
  await restartDesignReview(root, state);
  assert.equal(state.phase, "developer-review");
  assert.equal(state.findings.every(item => item.retired && item.retiredAt), true);
  await assert.rejects(resolveFinding(root, state, "old-design"), /Unknown active finding/);

  await recordDeveloperFeedback(root, state, { verdict: "approved" });
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  await approveReview(root, state, critic, "new-critic");
  const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  assert.deepEqual(verifier.findings, []);
  await approveReview(root, state, verifier, "new-verifier");
  assert.equal(state.phase, "ready-to-build");
});

test("quality review can restart directly from remediation", async () => {
  const { root, state } = await project();
  await markDesignApproved(root, state);
  state.phase = "quality-remediation";
  state.findings.push({ id: "abandoned-quality", stage: "quality", description: "Old quality finding", resolved: false });
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await restartQualityReview(root, state);
  assert.equal(state.phase, "quality-critic");
  assert.equal(state.findings.at(-1).retired, true);
});

test("implementation baseline requires current tests and separates quality review", async () => {
  const { root, state } = await project();
  state.phase = "implementing";
  await markDesignApproved(root, state);
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /passing test evidence/);
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "baseline-sealed");
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "quality-critic");
});

test("new workflows require exact sequential slice acceptance before baseline", async () => {
  const { root, state } = await project();
  const design = path.join(root, state.designPath);
  await writeFile(design, (await readFile(design, "utf8"))
    .replace(/(## Implementation Plan\n)[\s\S]*?(?=\n## )/, `$1### Slice 1: First outcome\n- Outcome: The first result is observable.\n- Entry point: First command.\n- Core behavior: Apply first rules.\n- Boundary integration: Persist through ResultStore.\n- Tests: First acceptance test.\n- Acceptance command: ${JSON.stringify([process.execPath, "-e", "process.exit(0)"])}\n- Complete when: The first command passes.\n\n### Slice 2: Second outcome\n- Outcome: The second result is observable.\n- Entry point: Second command.\n- Core behavior: Apply second rules.\n- Boundary integration: Read through ResultStore.\n- Tests: Second acceptance test.\n- Acceptance command: ${JSON.stringify([process.execPath, "-e", "process.exit(0)"])}\n- Complete when: The second command passes.\n`)
    .replace(/(### Slice Completion\n)[\s\S]*?(?=\n## )/, "$1#### Slice 1: First outcome\n- Implementation: First command, rules, and storage are integrated.\n- Verification: First acceptance command passes.\n"));
  state.phase = "ready-to-build";
  await markDesignApproved(root, state);
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.implementation.slices.length, 2);
  await assert.rejects(completeSlice(root, state, 2), /next is Slice 1/);
  await assert.rejects(completeSlice(root, state, 1), /reviewed acceptance command/);
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await completeSlice(root, state, 1);
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /Complete Slice 2/);
  await writeFile(design, (await readFile(design, "utf8")).replace(
    "- Verification: First acceptance command passes.",
    "- Verification: First acceptance command passes.\n\n#### Slice 2: Second outcome\n- Implementation: Second command, rules, and storage are integrated.\n- Verification: Second acceptance command passes."
  ));
  await assert.rejects(completeSlice(root, state, 2), /reviewed acceptance command/);
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await completeSlice(root, state, 2);
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "baseline-sealed");
  await advance(root, state, DEFAULT_CONFIG);
  state.phase = "quality-remediation";
  await writeFile(path.join(root, "remediated.js"), "export default true;\n");
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await assert.rejects(
    advance(root, state, DEFAULT_CONFIG),
    new RegExp(`Slice 1: agent-toolkit test --kind acceptance -- ${process.execPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} -e process.exit\\(0\\)`)
  );
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "quality-verifier");
  await writeFile(path.join(root, "restarted.js"), "export default true;\n");
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await assert.rejects(restartQualityReview(root, state), /all required tests/);
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await restartQualityReview(root, state);
  assert.equal(state.phase, "quality-critic");
});

test("implementation cannot seal without architecture conformance evidence", async () => {
  const { root, state } = await project();
  state.phase = "implementing";
  await markDesignApproved(root, state);
  const design = path.join(root, state.designPath);
  await writeFile(design, (await readFile(design, "utf8")).replace(/(## Implementation Conformance\n)[\s\S]*?(?=\n## )/, "$1Pending implementation.\n"));
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /Complete Implementation Conformance/);
});

test("quality critic cannot bypass a drifted sealed baseline", async () => {
  const { root, state } = await project();
  state.phase = "implementing";
  await markDesignApproved(root, state);
  const pass = { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] };
  await recordTest(root, state, pass);
  await advance(root, state, DEFAULT_CONFIG);
  await advance(root, state, DEFAULT_CONFIG);
  await writeFile(path.join(root, "late.js"), "export default true;\n");
  await recordTest(root, state, pass);
  await assert.rejects(prepareReview(root, state, { stage: "quality", role: "critic" }), /changed after baseline sealing/);
  await restartQualityReview(root, state);
  assert.equal(state.phase, "quality-critic");
  assert.equal(state.baseline.fingerprint, await projectFingerprint(root));
});

test("fix cannot enter implementation without an observed regression failure", async () => {
  const { root, state } = await project("fix");
  state.phase = "ready-to-build";
  await markDesignApproved(root, state);
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /expected-failing regression/);
  const command = ["-e", "process.exit(require('node:fs').existsSync('fixed') ? 0 : 1)"];
  await recordTest(root, state, { kind: "regression", expectFail: true, command: process.execPath, args: command });
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "implementing");
  await writeFile(path.join(root, "fixed"), "yes\n");
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await completeSlice(root, state, 1);
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /regression command successfully/);
  await recordTest(root, state, { kind: "regression", expectFail: false, command: process.execPath, args: command });
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "baseline-sealed");
});

test("fix reproduction evidence must match the reviewed pre-fix candidate", async () => {
  const { root, state } = await project("fix");
  const command = ["-e", "process.exit(1)"];
  await recordTest(root, state, { kind: "regression", expectFail: true, command: process.execPath, args: command });
  await writeFile(path.join(root, "changed.js"), "export default true;\n");
  state.phase = "ready-to-build";
  await markDesignApproved(root, state);
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /expected-failing regression/);
  await recordTest(root, state, { kind: "regression", expectFail: true, command: process.execPath, args: command });
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "implementing");
});

test("fix remains bound to the regression selected before implementation", async () => {
  const { root, state } = await project("fix");
  const original = ["-e", "process.exit(require('node:fs').existsSync('fixed') ? 0 : 1)"];
  const unrelated = ["-e", "process.exit(require('node:fs').existsSync('other') ? 0 : 1)"];
  await recordTest(root, state, { kind: "regression", expectFail: true, command: process.execPath, args: original });
  state.phase = "ready-to-build";
  await markDesignApproved(root, state);
  await advance(root, state, DEFAULT_CONFIG);
  await recordTest(root, state, { kind: "regression", expectFail: true, command: process.execPath, args: unrelated });
  await writeFile(path.join(root, "other"), "yes\n");
  await recordTest(root, state, { kind: "regression", expectFail: false, command: process.execPath, args: unrelated });
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await completeSlice(root, state, 1);
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /recorded regression command/);
  await writeFile(path.join(root, "fixed"), "yes\n");
  await recordTest(root, state, { kind: "regression", expectFail: false, command: process.execPath, args: original });
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "baseline-sealed");
});

test("fix remediation requires a current pass of the recorded regression", async () => {
  const { root, state } = await project("fix");
  const command = ["-e", "process.exit(require('node:fs').existsSync('fixed') ? 0 : 1)"];
  await recordTest(root, state, { kind: "regression", expectFail: true, command: process.execPath, args: command });
  state.phase = "ready-to-build";
  await markDesignApproved(root, state);
  await advance(root, state, DEFAULT_CONFIG);
  await writeFile(path.join(root, "fixed"), "yes\n");
  await recordTest(root, state, { kind: "regression", expectFail: false, command: process.execPath, args: command });
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await completeSlice(root, state, 1);
  await advance(root, state, DEFAULT_CONFIG);
  await advance(root, state, DEFAULT_CONFIG);
  state.phase = "quality-remediation";
  await writeFile(path.join(root, "remediation.js"), "export default true;\n");
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /regression command successfully/);
  await recordTest(root, state, { kind: "regression", expectFail: false, command: process.execPath, args: command });
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "quality-verifier");
});

test("non-Git fingerprints include nested application state directories", async () => {
  const { root } = await project();
  const directory = path.join(root, "src", ".state");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "model.json"), "{\"value\":1}\n");
  const before = await projectFingerprint(root);
  await writeFile(path.join(directory, "model.json"), "{\"value\":2}\n");
  assert.notEqual(await projectFingerprint(root), before);
});

test("review packets become stale when reviewed content changes", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const packet = await prepareReview(root, state, { stage: "design", role: "critic" });
  await writeFile(path.join(root, state.designPath), "changed\n");
  await assert.rejects(recordReview(root, state, { packetId: packet.id, verdict: "approved", reviewer: "critic" }), /changed/);
});

test("quality gates require current tests and reject post-verifier changes", async () => {
  const { root, state } = await project();
  await writeFile(path.join(root, "app.js"), "export const value = 1;\n");
  state.phase = "implementing";
  await markDesignApproved(root, state);
  const pass = { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] };
  await recordTest(root, state, pass);
  await advance(root, state, DEFAULT_CONFIG);
  await advance(root, state, DEFAULT_CONFIG);
  const critic = await prepareReview(root, state, { stage: "quality", role: "critic" });
  assert.equal(critic.candidate.repository, "directory");
  assert(critic.candidate.files.some(item => item.path === "app.js" && item.content.includes("value = 1")));
  await approveReview(root, state, critic, "quality-critic");

  await writeFile(path.join(root, "app.js"), "export const value = 2;\n");
  await assert.rejects(prepareReview(root, state, { stage: "quality", role: "verifier" }), /changed after critic approval/);
  await recordTest(root, state, pass);
  await restartQualityReview(root, state);
  const replacementCritic = await prepareReview(root, state, { stage: "quality", role: "critic" });
  await approveReview(root, state, replacementCritic, "replacement-critic");
  const verifier = await prepareReview(root, state, { stage: "quality", role: "verifier" });
  await approveReview(root, state, verifier, "quality-verifier");

  await writeFile(path.join(root, "app.js"), "export const value = 3;\n");
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /approved quality-verifier candidate/);
});

test("test commands cannot mutate the candidate they certify", async () => {
  const { root, state } = await project();
  state.phase = "implementing";
  await markDesignApproved(root, state);
  await assert.rejects(recordTest(root, state, {
    kind: "unit",
    expectFail: false,
    command: process.execPath,
    args: ["-e", "require('node:fs').writeFileSync('generated.js', 'changed\\n')"]
  }), /changed the project candidate/);
  assert.equal(state.evidence.length, 1);
  assert.equal(state.evidence[0].candidateChanged, true);
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /passing test evidence/);
});

test("a newer failed command attempt invalidates its older pass", async () => {
  const { root, state } = await project();
  const external = await temporaryDirectory();
  const marker = path.join(external, "fail");
  const script = `process.exit(require('node:fs').existsSync(${JSON.stringify(marker)}) ? 1 : 0)`;
  state.phase = "implementing";
  await markDesignApproved(root, state);
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", script] });
  await writeFile(marker, "fail\n");
  await assert.rejects(recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", script] }), /exit 1/);
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /passing test evidence/);
});

test("a newer timed-out command attempt invalidates its older pass", async () => {
  const { root, state } = await project();
  const external = await temporaryDirectory();
  const marker = path.join(external, "hang");
  const script = `require('node:fs').existsSync(${JSON.stringify(marker)}) ? setTimeout(() => {}, 10000) : process.exit(0)`;
  state.phase = "implementing";
  await markDesignApproved(root, state);
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", script] });
  await writeFile(marker, "hang\n");
  await assert.rejects(recordTest(root, state, {
    kind: "unit", expectFail: false, command: process.execPath, args: ["-e", script]
  }, { evidence: { timeoutMs: 20 } }), /timed out/);
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /passing test evidence/);
});

test("material design drift requires a fresh design review", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  await approveReview(root, state, critic, "critic");
  const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  await approveReview(root, state, verifier, "verifier");
  await advance(root, state, DEFAULT_CONFIG);
  const design = path.join(root, state.designPath);
  await writeFile(design, (await readFile(design, "utf8")).replace("State the observable", "Define the revised observable"));
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /review restart/);
  await restartDesignReview(root, state);
  assert.equal(state.phase, "developer-review");
});

test("changed reproduction details require a fresh design review", async () => {
  const { root, state } = await project("fix");
  await markDesignApproved(root, state);
  state.phase = "implementing";
  const design = path.join(root, state.designPath);
  await writeFile(design, (await readFile(design, "utf8")).replace("Give deterministic steps", "Give revised deterministic steps"));
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /review restart/);
});

test("approved reviews cannot smuggle unresolved findings", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const packet = await prepareReview(root, state, { stage: "design", role: "critic" });
  const findings = await writePacketFindings(root, packet, JSON.stringify({ findings: [finding("Material contract gap")] }));
  await assert.rejects(recordReview(root, state, {
    packetId: packet.id,
    verdict: "approved",
    reviewer: "critic",
    findingsFile: findings
  }), /cannot include unresolved findings/);
});

test("review is unavailable during implementation", async () => {
  const { root, state } = await project();
  state.phase = "implementing";
  await assert.rejects(prepareReview(root, state, { stage: "quality", role: "critic" }), /during implementing/);
});

test("two verifier rejections escalate and dispositions still require the same verifier", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  const criticFile = await writePacketFindings(root, critic, JSON.stringify({ findings: [finding("Define cancellation ownership")] }));
  await recordReview(root, state, { packetId: critic.id, verdict: "changes-requested", reviewer: "critic", findingsFile: criticFile });
  const original = state.findings[0];

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await resolveFinding(root, state, original.id);
    await advance(root, state, DEFAULT_CONFIG);
    const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
    const closureFile = await writePacketFindings(root, verifier, JSON.stringify({ findings: [finding(`Cancellation remains unresolved ${attempt}`, { sourceFindingId: original.id })] }));
    await recordReview(root, state, { packetId: verifier.id, verdict: "changes-requested", reviewer: "verifier", findingsFile: closureFile }, DEFAULT_CONFIG);
  }

  assert.equal(state.phase, "review-escalation");
  assert.equal(state.reviewEscalation.closureRejections, 2);
  await assert.rejects(prepareReview(root, state, { stage: "design", role: "verifier" }), /during review-escalation/);
  await assert.rejects(restartDesignReview(root, state), /escalation record/);

  const restartState = structuredClone(state);
  await recordEscalation(root, restartState, "restart-design");
  assert.equal(restartState.phase, "developer-review");
  assert.equal(restartState.reviewEscalationHistory.at(-1).decisions.at(-1).decision, "restart-design");

  await recordEscalation(root, state, "retry");
  assert.equal(state.phase, "design-remediation");
  await resolveFinding(root, state, original.id);
  await advance(root, state, DEFAULT_CONFIG);
  const retryVerifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  const retryFile = await writePacketFindings(root, retryVerifier, JSON.stringify({ findings: [finding("Cancellation remains unresolved after focused retry", { sourceFindingId: original.id })] }));
  await recordReview(root, state, { packetId: retryVerifier.id, verdict: "changes-requested", reviewer: "verifier", findingsFile: retryFile }, DEFAULT_CONFIG);
  assert.equal(state.phase, "review-escalation");
  await assert.rejects(recordEscalation(root, state, "retry"), /already been used/);

  await dispositionFinding(root, state, original.id, { outcome: "not-material", reason: "The reviewed single-shot command has no cancellation path" });
  await recordEscalation(root, state, "continue");
  assert.equal(state.phase, "design-verifier");
  const finalVerifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  await assert.rejects(approveReview(root, state, finalVerifier, "another-verifier"), /Reuse verifier context/);
  await approveReview(root, state, finalVerifier, "verifier");
  assert.equal(state.phase, "ready-to-build");
  assert.equal(original.status, "disposition-verified");
});

test("failed and timed out test attempts are retained", async () => {
  const { root, state } = await project();
  await assert.rejects(recordTest(root, state, {
    kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(2)"]
  }, { evidence: { timeoutMs: 1000 } }), /exit 2/);
  await assert.rejects(recordTest(root, state, {
    kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "setTimeout(() => {}, 10000)"]
  }, { evidence: { timeoutMs: 20 } }), /timed out/);
  assert.equal(state.evidence.length, 2);
  assert.equal(state.evidence[0].code, 2);
  assert.equal(state.evidence[1].timedOut, true);
});

test("a timed-out expected failure cannot establish a fix regression", async () => {
  const { root, state } = await project("fix");
  state.phase = "ready-to-build";
  await markDesignApproved(root, state);
  await assert.rejects(recordTest(root, state, {
    kind: "regression", expectFail: true, command: process.execPath, args: ["-e", "setTimeout(() => {}, 10000)"]
  }, { evidence: { timeoutMs: 20 } }), /timed out/);
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /expected-failing regression/);
});

test("project-fingerprint regression evidence is not accepted by the new state format", async () => {
  const { root, state } = await project("fix");
  state.phase = "ready-to-build";
  await markDesignApproved(root, state);
  const command = [process.execPath, "-e", "process.exit(1)"];
  state.evidence.push({
    id: "legacy-regression",
    kind: "regression",
    expectFail: true,
    command,
    code: 1,
    output: "legacy failure",
    fingerprint: await projectFingerprint(root),
    recordedAt: new Date().toISOString()
  });
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /expected-failing regression/);
});

test("artifact-only edits preserve executable evidence", async () => {
  const { root, state } = await project();
  await writeFile(path.join(root, "app.js"), "export const result = true;\n");
  const evidenceFingerprint = await executableFingerprint(root);
  const reviewFingerprint = await projectFingerprint(root);
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await writeFile(path.join(root, state.designPath), (await readFile(path.join(root, state.designPath), "utf8")).replace("Record consequential decisions", "Record material decisions"));
  assert.equal(await executableFingerprint(root), evidenceFingerprint);
  assert.notEqual(await projectFingerprint(root), reviewFingerprint);
});
