import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { artifactFingerprint, artifactSnapshot, designContractFingerprint, projectFingerprint, projectSnapshot, snapshotFingerprint } from "./fingerprints.mjs";
import { validateArtifacts } from "./artifacts.mjs";
import { hasRequiredCurrentEvidence, requireCurrentDesign, saveState } from "./state-machine.mjs";

function expectedPhase(stage, role) {
  return `${stage}-${role}`;
}

async function reviewSnapshot(root, state, stage) {
  return stage === "design" ? artifactSnapshot(root, state) : projectSnapshot(root);
}

export async function prepareReview(root, state, { stage, role }) {
  if (!["design", "quality"].includes(stage) || !["critic", "verifier"].includes(role)) {
    throw new Error("Review stage/role must be design|quality and critic|verifier");
  }
  if (state.phase !== expectedPhase(stage, role)) {
    throw new Error(`Cannot prepare ${stage} ${role} review during ${state.phase}`);
  }
  if (stage === "quality") await requireCurrentDesign(root, state);
  const problems = await validateArtifacts(root, state, { requireSystem: true });
  if (problems.length) throw new Error(problems.join("\n"));
  const snapshot = await reviewSnapshot(root, state, stage);
  const fingerprint = snapshotFingerprint(snapshot);
  if (stage === "quality" && role === "critic" && state.baseline?.fingerprint !== fingerprint) {
    throw new Error("Candidate changed after baseline sealing; run: agent-toolkit review restart --stage quality");
  }
  const critic = state.reviews[`${stage}-critic`];
  if (role === "verifier" && !critic) throw new Error(`${stage} verifier requires a completed critic review`);
  if (role === "verifier" && critic.verdict === "approved" && critic.fingerprint !== fingerprint) {
    throw new Error(`Candidate changed after critic approval; run: agent-toolkit review restart --stage ${stage}`);
  }
  if (stage === "quality" && !hasRequiredCurrentEvidence(state, fingerprint)) {
    throw new Error(state.kind === "fix"
      ? "Run the recorded regression command successfully for the current fix before quality review"
      : "Run relevant tests for the current candidate before quality review");
  }
  const packet = {
    id: randomUUID(),
    stage,
    role,
    fingerprint,
    designPath: state.designPath,
    preparedAt: new Date().toISOString()
  };
  state.packets.push(packet);
  await saveState(root, state);
  return { ...packet, candidate: snapshot };
}

async function parseFindings(file) {
  if (!file) return [];
  const content = await readFile(file, "utf8");
  try {
    const parsed = JSON.parse(content);
    const list = Array.isArray(parsed) ? parsed : parsed.findings;
    if (!Array.isArray(list)) throw new Error("Expected an array or { findings: [] }");
    return list.map(item => typeof item === "string" ? item : item.description).filter(Boolean);
  } catch (error) {
    if (error instanceof SyntaxError) return content.split("\n").map(line => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
    throw error;
  }
}

export async function recordReview(root, state, { packetId, verdict, reviewer, findingsFile }) {
  if (!["approved", "changes-requested"].includes(verdict)) {
    throw new Error("Review verdict must be approved or changes-requested");
  }
  if (!reviewer) throw new Error("Reviewer identity is required to enforce critic/verifier separation");
  const packet = state.packets.find(item => item.id === packetId);
  if (!packet) throw new Error(`Unknown review packet: ${packetId}`);
  if (packet.recordedAt) throw new Error("Review packet has already been recorded");
  if (state.phase !== expectedPhase(packet.stage, packet.role)) throw new Error("Review packet is no longer current");
  const current = snapshotFingerprint(await reviewSnapshot(root, state, packet.stage));
  if (current !== packet.fingerprint) throw new Error("Reviewed content changed; prepare a fresh review packet");
  const problems = await validateArtifacts(root, state, { requireSystem: true });
  if (problems.length) throw new Error(problems.join("\n"));
  if (packet.stage === "quality" && !hasRequiredCurrentEvidence(state, current)) {
    throw new Error(state.kind === "fix"
      ? "Current passing regression evidence is required before recording quality approval"
      : "Current passing test evidence is required before recording quality approval");
  }
  const prior = state.reviews[`${packet.stage}-critic`];
  if (packet.role === "verifier" && reviewer && prior?.reviewer === reviewer) {
    throw new Error("Verifier must be distinct from the critic");
  }
  const descriptions = await parseFindings(findingsFile);
  if (verdict === "changes-requested" && descriptions.length === 0) {
    throw new Error("Changes-requested verdict requires a findings file");
  }
  if (verdict === "approved" && descriptions.length) {
    throw new Error("Approved verdict cannot include unresolved findings");
  }
  if (verdict === "approved" && packet.role === "verifier"
    && state.findings.some(item => item.stage === packet.stage && !item.resolved)) {
    throw new Error("Resolve all findings before verifier approval");
  }
  packet.recordedAt = new Date().toISOString();
  packet.verdict = verdict;
  packet.reviewer = reviewer;
  state.reviews[`${packet.stage}-${packet.role}`] = {
    packetId: packet.id,
    reviewer: packet.reviewer,
    verdict,
    fingerprint: packet.fingerprint,
    recordedAt: packet.recordedAt
  };
  if (packet.stage === "design") {
    state.reviews[`${packet.stage}-${packet.role}`].contractFingerprint = await designContractFingerprint(root, state);
  }
  for (const description of descriptions) {
    state.findings.push({ id: randomUUID(), stage: packet.stage, description, resolved: false });
  }
  if (verdict === "changes-requested") state.phase = `${packet.stage}-remediation`;
  else if (packet.role === "critic") state.phase = `${packet.stage}-verifier`;
  else state.phase = packet.stage === "design" ? "ready-to-build" : "ready-to-commit";
  await saveState(root, state);
  return state;
}

export async function restartDesignReview(root, state) {
  if (!["design-verifier", "ready-to-build", "implementing", "baseline-sealed", "quality-critic", "quality-remediation", "quality-verifier", "ready-to-commit"].includes(state.phase)) {
    throw new Error(`Design review cannot be restarted during ${state.phase}`);
  }
  delete state.reviews["design-critic"];
  delete state.reviews["design-verifier"];
  delete state.reviews["quality-critic"];
  delete state.reviews["quality-verifier"];
  delete state.baseline;
  delete state.commitPlan;
  state.phase = "design-critic";
  await saveState(root, state);
  return state;
}

export async function restartQualityReview(root, state) {
  if (!["baseline-sealed", "quality-critic", "quality-verifier", "ready-to-commit"].includes(state.phase)) {
    throw new Error(`Quality review cannot be restarted during ${state.phase}`);
  }
  await requireCurrentDesign(root, state);
  const fingerprint = await projectFingerprint(root);
  if (!hasRequiredCurrentEvidence(state, fingerprint)) {
    throw new Error("Run all required tests for the current candidate before restarting quality review");
  }
  delete state.reviews["quality-critic"];
  delete state.reviews["quality-verifier"];
  delete state.commitPlan;
  state.baseline = {
    fingerprint,
    designFingerprint: await artifactFingerprint(root, state),
    sealedAt: new Date().toISOString()
  };
  state.phase = "quality-critic";
  await saveState(root, state);
  return state;
}

export async function resolveFinding(root, state, id) {
  const finding = state.findings.find(item => item.id === id);
  if (!finding) throw new Error(`Unknown finding: ${id}`);
  finding.resolved = true;
  finding.resolvedAt = new Date().toISOString();
  await saveState(root, state);
  return finding;
}
