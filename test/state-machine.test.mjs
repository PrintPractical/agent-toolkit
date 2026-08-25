import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderChange, renderSystem } from "../src/artifacts.mjs";
import { DEFAULT_CONFIG } from "../src/config.mjs";
import { recordTest } from "../src/evidence.mjs";
import { recordDeveloperFeedback } from "../src/feedback.mjs";
import { prepareReview, recordReview, resolveFinding, restartDesignReview, restartQualityReview } from "../src/reviews.mjs";
import { artifactFingerprint, designContractFingerprint, projectFingerprint } from "../src/fingerprints.mjs";
import { advance, completeSlice, createState, nextAction } from "../src/state-machine.mjs";
import { temporaryDirectory } from "./helpers.mjs";

async function project(kind = "feature") {
  const root = await temporaryDirectory();
  const design = await renderChange(root, { kind, title: "Deliver Result", slug: "deliver-result" });
  const content = await readFile(design, "utf8");
  await writeFile(design, content
    .replace(/(## Requirements Traceability\n)[\s\S]*?(?=\n## )/, "$11. Requested result -> use case, contract, and tests.\n")
    .replace(/(## Boundaries and Dependencies\n)[\s\S]*?(?=\n## )/, "$11. Application owns the ResultStore port; its real adapter is composed at the entry point.\n")
    .replace(/(## (?:Abstraction and Extension Pressure|Correction and Extension Pressure)\n)[\s\S]*?(?=\n## )/, "$11. ResultStore isolates the persistence contract and supports deterministic application tests.\n")
    .replace(/(## Implementation Plan\n)[\s\S]*?(?=\n## )/, `$1### Slice 1: Result is delivered\n- Outcome: The observable result is returned.\n- Entry point: Result command.\n- Core behavior: Apply result rules.\n- Boundary integration: Persist through ResultStore.\n- Tests: Rule unit test and storage integration test.\n- Acceptance command: ${JSON.stringify([process.execPath, "-e", "process.exit(0)"])}\n- Complete when: The command builds and tests pass.\n`)
    .replace(/(## Implementation Conformance\n)[\s\S]*?(?=\n## )/, "$1### Architecture Decisions\n- Decision: ResultStore is application-owned.\n- Implementation: Its adapter is outward and composed at the entry point.\n- Verification: Dependency unit test and adapter integration test.\n\n### Slice Completion\n#### Slice 1: Result is delivered\n- Slice: Slice 1 delivers the result.\n- Implementation: Command, rules, and adapter are integrated.\n- Verification: The command builds and tests pass.\n"));
  await renderSystem(root);
  const state = await createState(root, { slug: "deliver-result", kind, title: "Deliver Result", designPath: ".agent/changes/deliver-result.md", git: false });
  state.artifactFormat = 1;
  return { root, state };
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

test("design requires a fresh critic and distinct verifier", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  await recordReview(root, state, { packetId: critic.id, verdict: "approved", reviewer: "critic-session" });
  const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  await assert.rejects(recordReview(root, state, { packetId: verifier.id, verdict: "approved", reviewer: "critic-session" }), /distinct/);
  const invented = await writePacketFindings(root, verifier, JSON.stringify({ findings: [{
    severity: "high",
    description: "Claimed remediation regression",
    introducedByRemediation: true,
    evidence: "No remediation actually occurred"
  }] }));
  await assert.rejects(recordReview(root, state, {
    packetId: verifier.id,
    verdict: "changes-requested",
    reviewer: "verifier-session",
    findingsFile: invented
  }), /critic approved without remediation/);
  await recordReview(root, state, { packetId: verifier.id, verdict: "approved", reviewer: "verifier-session" });
  assert.equal(state.phase, "ready-to-build");
  assert.match(nextAction(state, DEFAULT_CONFIG), /Stop the design workflow and start the build skill/);
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
  const extra = await writePacketFindings(root, critic, JSON.stringify({ findings: [{ severity: "medium", description: "Gap", category: "contract" }] }));
  await assert.rejects(recordReview(root, state, {
    packetId: critic.id,
    verdict: "changes-requested",
    reviewer: "critic",
    findingsFile: extra
  }), /unsupported properties/);
  state.packets.find(item => item.id === critic.id).protocol = 3;
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

test("legacy packets without a protocol retain Markdown and JSON compatibility", async () => {
  for (const [name, content] of [
    ["markdown", "- Preserve the legacy boundary\n"],
    ["json", JSON.stringify({ findings: [{ description: "Preserve the legacy contract" }] })]
  ]) {
    const { root, state } = await project();
    await reachDesignCritic(root, state);
    const prepared = await prepareReview(root, state, { stage: "design", role: "critic" });
    delete state.packets.find(packet => packet.id === prepared.id).protocol;
    const findings = await writePacketFindings(root, prepared, content);
    await recordReview(root, state, {
      packetId: prepared.id,
      verdict: "changes-requested",
      reviewer: `legacy-${name}-critic`,
      findingsFile: findings
    });
    assert.equal(state.findings.length, 1);
    assert.equal(state.findings[0].severity, "medium");
  }
});

test("verifier can only reopen supplied findings or report remediation regressions", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  const criticFindings = await writePacketFindings(root, critic, JSON.stringify({ findings: [{ severity: "medium", description: "Define ordering at the public boundary" }] }));
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
  const expandedScope = await writePacketFindings(root, verifier, JSON.stringify({ findings: [{ severity: "medium", description: "Specify another pre-existing detail" }] }));
  await assert.rejects(recordReview(root, state, {
    packetId: verifier.id,
    verdict: "changes-requested",
    reviewer: "verifier",
    findingsFile: expandedScope
  }), /must reference a supplied finding ID/);

  const closure = await writePacketFindings(root, verifier, JSON.stringify({ findings: [{ severity: "medium", description: "Ordering remains ambiguous in the revised example", sourceFindingId: original.id }] }));
  await recordReview(root, state, {
    packetId: verifier.id,
    verdict: "changes-requested",
    reviewer: "verifier",
    findingsFile: closure
  });
  assert.equal(state.findings.length, 1);
  assert.equal(original.resolved, false);
  assert.match(original.verification.description, /remains ambiguous/);
});

test("closure packets retain evidence for regressions introduced by remediation", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  const criticFindings = await writePacketFindings(root, critic, JSON.stringify({ findings: [{ severity: "medium", description: "Clarify ownership" }] }));
  await recordReview(root, state, {
    packetId: critic.id,
    verdict: "changes-requested",
    reviewer: "critic",
    findingsFile: criticFindings
  });
  await resolveFinding(root, state, state.findings[0].id);
  await advance(root, state, DEFAULT_CONFIG);
  const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  const regressionFile = await writePacketFindings(root, verifier, JSON.stringify({ findings: [{
    severity: "high",
    description: "The remediation inverted dependency direction",
    introducedByRemediation: true,
    evidence: "The revised boundary now imports its concrete adapter"
  }] }));
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
  assert.match(supplied.evidence, /imports its concrete adapter/);
});

test("critic remediation changes return to developer approval before verification", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  const findingsFile = await writePacketFindings(root, critic, JSON.stringify({ findings: [{ severity: "medium", description: "Clarify adapter ownership" }] }));
  await recordReview(root, state, {
    packetId: critic.id,
    verdict: "changes-requested",
    reviewer: "critic",
    findingsFile
  });
  const design = path.join(root, state.designPath);
  await writeFile(design, (await readFile(design, "utf8")).replace("Application owns the ResultStore port", "Application exclusively owns the ResultStore port"));
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

test("in-flight legacy state cannot bypass developer approval", async () => {
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
  await recordReview(root, state, { packetId: critic.id, verdict: "approved", reviewer: "critic-session" });
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
  await recordReview(root, state, { packetId: critic.id, verdict: "approved", reviewer: "new-critic" });
  const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  assert.deepEqual(verifier.findings, []);
  await recordReview(root, state, { packetId: verifier.id, verdict: "approved", reviewer: "new-verifier" });
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
  state.artifactFormat = 2;
  const design = path.join(root, state.designPath);
  await writeFile(design, (await readFile(design, "utf8"))
    .replace(/(## Implementation Plan\n)[\s\S]*?(?=\n## )/, `$1### Slice 1: First outcome\n- Outcome: The first result is observable.\n- Entry point: First command.\n- Core behavior: Apply first rules.\n- Boundary integration: Persist through ResultStore.\n- Tests: First acceptance test.\n- Acceptance command: ${JSON.stringify([process.execPath, "-e", "process.exit(0)"])}\n- Complete when: The first command passes.\n\n### Slice 2: Second outcome\n- Outcome: The second result is observable.\n- Entry point: Second command.\n- Core behavior: Apply second rules.\n- Boundary integration: Read through ResultStore.\n- Tests: Second acceptance test.\n- Acceptance command: ${JSON.stringify([process.execPath, "-e", "process.exit(0)"])}\n- Complete when: The second command passes.\n`)
    .replace(/(### Slice Completion\n)[\s\S]*?(?=\n## )/, "$1#### Slice 1: First outcome\n- Implementation: First command, rules, and adapter are integrated.\n- Verification: First acceptance command passes.\n"));
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
    "- Verification: First acceptance command passes.\n\n#### Slice 2: Second outcome\n- Implementation: Second command, rules, and adapter are integrated.\n- Verification: Second acceptance command passes."
  ));
  await assert.rejects(completeSlice(root, state, 2), /reviewed acceptance command/);
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await completeSlice(root, state, 2);
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /each reviewed slice acceptance command/);
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "baseline-sealed");
  await advance(root, state, DEFAULT_CONFIG);
  state.phase = "quality-remediation";
  await writeFile(path.join(root, "remediated.js"), "export default true;\n");
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /relevant tests/);
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await advance(root, state, DEFAULT_CONFIG);
  assert.equal(state.phase, "quality-verifier");
  await writeFile(path.join(root, "restarted.js"), "export default true;\n");
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await assert.rejects(restartQualityReview(root, state), /all required tests/);
  await recordTest(root, state, { kind: "acceptance", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
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
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /recorded regression command/);
  await writeFile(path.join(root, "fixed"), "yes\n");
  await recordTest(root, state, { kind: "regression", expectFail: false, command: process.execPath, args: original });
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
  await advance(root, state, DEFAULT_CONFIG);
  await advance(root, state, DEFAULT_CONFIG);
  state.phase = "quality-remediation";
  await writeFile(path.join(root, "remediation.js"), "export default true;\n");
  await recordTest(root, state, { kind: "unit", expectFail: false, command: process.execPath, args: ["-e", "process.exit(0)"] });
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /regression command successfully/);
  await recordTest(root, state, { kind: "regression", expectFail: false, command: process.execPath, args: command });
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
  await recordReview(root, state, { packetId: critic.id, verdict: "approved", reviewer: "quality-critic" });

  await writeFile(path.join(root, "app.js"), "export const value = 2;\n");
  await assert.rejects(prepareReview(root, state, { stage: "quality", role: "verifier" }), /changed after critic approval/);
  await recordTest(root, state, pass);
  await restartQualityReview(root, state);
  const replacementCritic = await prepareReview(root, state, { stage: "quality", role: "critic" });
  await recordReview(root, state, { packetId: replacementCritic.id, verdict: "approved", reviewer: "replacement-critic" });
  const verifier = await prepareReview(root, state, { stage: "quality", role: "verifier" });
  await recordReview(root, state, { packetId: verifier.id, verdict: "approved", reviewer: "quality-verifier" });

  await writeFile(path.join(root, "app.js"), "export const value = 3;\n");
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /approved quality-verifier candidate/);
});

test("test commands cannot mutate the candidate they certify", async () => {
  const { root, state } = await project();
  await assert.rejects(recordTest(root, state, {
    kind: "unit",
    expectFail: false,
    command: process.execPath,
    args: ["-e", "require('node:fs').writeFileSync('generated.js', 'changed\\n')"]
  }), /changed the project candidate/);
  assert.equal(state.evidence.length, 0);
});

test("material design drift requires a fresh design review", async () => {
  const { root, state } = await project();
  await reachDesignCritic(root, state);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  await recordReview(root, state, { packetId: critic.id, verdict: "approved", reviewer: "critic" });
  const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  await recordReview(root, state, { packetId: verifier.id, verdict: "approved", reviewer: "verifier" });
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
  const findings = await writePacketFindings(root, packet, JSON.stringify({ findings: [{ severity: "medium", description: "Material contract gap" }] }));
  await assert.rejects(recordReview(root, state, {
    packetId: packet.id,
    verdict: "approved",
    reviewer: "critic",
    findingsFile: findings
  }), /cannot include unresolved findings/);
});
