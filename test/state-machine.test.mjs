import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderChange, renderSystem } from "../src/artifacts.mjs";
import { DEFAULT_CONFIG } from "../src/config.mjs";
import { recordTest } from "../src/evidence.mjs";
import { prepareReview, recordReview, restartDesignReview, restartQualityReview } from "../src/reviews.mjs";
import { artifactFingerprint, designContractFingerprint, projectFingerprint } from "../src/fingerprints.mjs";
import { advance, createState } from "../src/state-machine.mjs";
import { temporaryDirectory } from "./helpers.mjs";

async function project(kind = "feature") {
  const root = await temporaryDirectory();
  await renderChange(root, { kind, title: "Deliver Result", slug: "deliver-result" });
  await renderSystem(root);
  const state = await createState(root, { slug: "deliver-result", kind, title: "Deliver Result", designPath: ".agent/changes/deliver-result.md", git: false });
  return { root, state };
}

async function markDesignApproved(root, state) {
  state.reviews["design-verifier"] = {
    verdict: "approved",
    fingerprint: await artifactFingerprint(root, state),
    contractFingerprint: await designContractFingerprint(root, state)
  };
}

test("design requires a fresh critic and distinct verifier", async () => {
  const { root, state } = await project();
  await advance(root, state, DEFAULT_CONFIG);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  await recordReview(root, state, { packetId: critic.id, verdict: "approved", reviewer: "critic-session" });
  const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  await assert.rejects(recordReview(root, state, { packetId: verifier.id, verdict: "approved", reviewer: "critic-session" }), /distinct/);
  await recordReview(root, state, { packetId: verifier.id, verdict: "approved", reviewer: "verifier-session" });
  assert.equal(state.phase, "ready-to-build");
});

test("verifier cannot approve content changed after critic approval", async () => {
  const { root, state } = await project();
  await advance(root, state, DEFAULT_CONFIG);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  await recordReview(root, state, { packetId: critic.id, verdict: "approved", reviewer: "critic-session" });
  const design = path.join(root, state.designPath);
  await writeFile(design, (await readFile(design, "utf8")).replace("State the observable", "State the revised observable"));
  await assert.rejects(prepareReview(root, state, { stage: "design", role: "verifier" }), /changed after critic approval/);
  await restartDesignReview(root, state);
  assert.equal(state.phase, "design-critic");
});

test("verified design drift can restart from ready-to-build", async () => {
  const { root, state } = await project();
  state.phase = "ready-to-build";
  await markDesignApproved(root, state);
  const design = path.join(root, state.designPath);
  await writeFile(design, (await readFile(design, "utf8")).replace("State the observable", "State the replacement observable"));
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /changed after verification/);
  await restartDesignReview(root, state);
  assert.equal(state.phase, "design-critic");
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
  await advance(root, state, DEFAULT_CONFIG);
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
  await advance(root, state, DEFAULT_CONFIG);
  const critic = await prepareReview(root, state, { stage: "design", role: "critic" });
  await recordReview(root, state, { packetId: critic.id, verdict: "approved", reviewer: "critic" });
  const verifier = await prepareReview(root, state, { stage: "design", role: "verifier" });
  await recordReview(root, state, { packetId: verifier.id, verdict: "approved", reviewer: "verifier" });
  await advance(root, state, DEFAULT_CONFIG);
  const design = path.join(root, state.designPath);
  await writeFile(design, (await readFile(design, "utf8")).replace("State the observable", "Define the revised observable"));
  await assert.rejects(advance(root, state, DEFAULT_CONFIG), /review restart/);
  await restartDesignReview(root, state);
  assert.equal(state.phase, "design-critic");
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
  await advance(root, state, DEFAULT_CONFIG);
  const packet = await prepareReview(root, state, { stage: "design", role: "critic" });
  const findings = path.join(root, "findings.txt");
  await writeFile(findings, "- Material contract gap\n");
  await assert.rejects(recordReview(root, state, {
    packetId: packet.id,
    verdict: "approved",
    reviewer: "critic",
    findingsFile: findings
  }), /cannot include unresolved findings/);
});
