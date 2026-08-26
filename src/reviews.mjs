import { mkdir, readFile, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { artifactFingerprint, artifactSnapshot, designContractFingerprint, projectFingerprint, projectSnapshot, snapshotFingerprint } from "./fingerprints.mjs";
import { validateArtifacts } from "./artifacts.mjs";
import { hasRequiredCurrentEvidence, requireCurrentDesign, saveState } from "./state-machine.mjs";

function expectedPhase(stage, role) {
  return `${stage}-${role}`;
}

function criticChecklist(stage) {
  if (stage === "design") {
    return [
      "Trace every requirement and example to an observable outcome, contract, and test.",
      "Inspect domain rules, boundary ownership, dependency direction, and applicable project instructions.",
      "Check placement responsibilities, risks, and that each planned slice is independently vertical.",
      "Identify applicable edge cases, invalid inputs, state freshness, concurrency, and failure handling before reporting findings.",
      "Finish this complete sweep before writing findings; do not stop after the first defect."
    ];
  }
  return [
    "Trace every requirement and reviewed architecture decision to the candidate and its tests.",
    "Inspect all changed paths and relevant callers for observable behavior, errors, invalid inputs, and regressions.",
    "Assess applicable state freshness, concurrency and locking, persistence consistency, resource lifecycle, and failure handling.",
    "Check conformance with reviewed boundaries, dependency direction, placement responsibilities, and project instructions.",
    "Finish this complete sweep before writing findings; do not stop after the first defect."
  ];
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
  if (stage === "design" && !state.developerApproval) {
    throw new Error("Developer approval is required before design review; run: agent-toolkit review restart --stage design");
  }
  if (stage === "design" && state.developerApproval.fingerprint !== fingerprint) {
    throw new Error("Design changed after developer approval; run: agent-toolkit review restart --stage design");
  }
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
  const id = randomUUID();
  const findingsPath = `.agent/.state/reviews/${id}.json`;
  await mkdir(path.join(root, ".agent", ".state", "reviews"), { recursive: true });
  const cycleId = role === "critic" ? id : critic.cycleId || critic.packetId;
  const suppliedFindings = role === "verifier"
    ? state.findings.filter(item => !item.retired && item.stage === stage
      && (item.reviewCycleId === cycleId || (!critic.cycleId && !item.reviewCycleId)))
    : [];
  const packet = {
    id,
    stage,
    role,
    protocol: 2,
    cycleId,
    findingIds: suppliedFindings.map(item => item.id),
    fingerprint,
    designPath: state.designPath,
    findingsPath,
    ...(role === "critic" ? { checklist: criticChecklist(stage) } : {}),
    preparedAt: new Date().toISOString()
  };
  state.packets.push(packet);
  await saveState(root, state);
  return {
    ...packet,
    candidate: snapshot,
    findings: suppliedFindings.map(({ id: findingId, severity, description, resolved, verification, introducedByRemediation, evidence }) => ({
      id: findingId,
      severity: severity || "medium",
      description,
      resolved,
      verification: verification || null,
      introducedByRemediation: introducedByRemediation || false,
      evidence: evidence || null
    }))
  };
}

async function parseLegacyFindings(content) {
  try {
    const parsed = JSON.parse(content);
    const list = Array.isArray(parsed) ? parsed : parsed.findings;
    if (!Array.isArray(list)) throw new Error("Expected an array or { findings: [] }");
    return list.map(item => ({ severity: "medium", description: typeof item === "string" ? item : item.description })).filter(item => item.description);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return content.split("\n").map(line => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean)
        .map(description => ({ severity: "medium", description }));
    }
    throw error;
  }
}

async function parseFindings(file, packet, state) {
  if (packet.protocol === undefined) {
    if (!file) return [];
    return parseLegacyFindings(await readFile(file, "utf8"));
  }
  if (packet.protocol !== 2) throw new Error(`Unsupported review packet protocol: ${packet.protocol}`);
  if (!file) {
    throw new Error(`Protocol 2 review responses must be saved to ${packet.findingsPath} and recorded with --findings ${packet.findingsPath}`);
  }
  const content = await readFile(file, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Findings file must be valid JSON: { \"findings\": [...] }");
  }
  if (!parsed || Array.isArray(parsed) || !Array.isArray(parsed.findings)) {
    throw new Error("Findings JSON must be an object with a findings array");
  }
  if (Object.keys(parsed).some(key => key !== "findings")) {
    throw new Error("Findings JSON may contain only the findings property");
  }
  return parsed.findings.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Finding ${index + 1} must be an object`);
    }
    if (!['high', 'medium'].includes(item.severity) || typeof item.description !== "string" || !item.description.trim()) {
      throw new Error(`Finding ${index + 1} requires severity high|medium and a description`);
    }
    const finding = { severity: item.severity, description: item.description.trim() };
    if (packet.role === "critic") {
      if (Object.keys(item).some(key => !["severity", "description"].includes(key))) {
        throw new Error(`Critic finding ${index + 1} contains unsupported properties`);
      }
      return finding;
    }
    if (item.sourceFindingId) {
      if (Object.keys(item).some(key => !["severity", "description", "sourceFindingId"].includes(key))) {
        throw new Error(`Verifier finding ${index + 1} contains unsupported properties`);
      }
      if (!packet.findingIds.includes(item.sourceFindingId)) {
        throw new Error(`Verifier finding ${index + 1} must reference a supplied finding ID`);
      }
      return { ...finding, sourceFindingId: item.sourceFindingId };
    }
    if (item.introducedByRemediation === true && item.severity === "high"
      && typeof item.evidence === "string" && item.evidence.trim()) {
      if (Object.keys(item).some(key => !["severity", "description", "introducedByRemediation", "evidence"].includes(key))) {
        throw new Error(`Verifier finding ${index + 1} contains unsupported properties`);
      }
      const criticReview = state.reviews[`${packet.stage}-critic`];
      if (criticReview?.verdict !== "changes-requested") {
        throw new Error(`Verifier finding ${index + 1} cannot be remediation-introduced because the critic approved without remediation`);
      }
      return { ...finding, introducedByRemediation: true, evidence: item.evidence.trim() };
    }
    throw new Error(`Verifier finding ${index + 1} must reference a supplied finding ID or document a high-severity regression introduced by remediation`);
  });
}

function applyFindings(state, packet, findings) {
  for (const finding of findings) {
    if (finding.sourceFindingId) {
      const source = state.findings.find(item => item.id === finding.sourceFindingId);
      source.resolved = false;
      delete source.resolvedAt;
      source.verification = {
        description: finding.description,
        severity: finding.severity,
        packetId: packet.id
      };
      continue;
    }
    state.findings.push({
      id: randomUUID(),
      stage: packet.stage,
      role: packet.role,
      reviewCycleId: packet.cycleId,
      packetId: packet.id,
      ...finding,
      resolved: false
    });
  }
}

export async function recordReview(root, state, { packetId, verdict, reviewer, findingsFile }) {
  if (!["approved", "changes-requested"].includes(verdict)) {
    throw new Error("Review verdict must be approved or changes-requested");
  }
  if (!reviewer) throw new Error("Reviewer identity is required to enforce critic/verifier separation");
  const packet = state.packets.find(item => item.id === packetId);
  if (!packet) throw new Error(`Unknown review packet: ${packetId}`);
  if (packet.obsoleteAt) throw new Error("Review packet was invalidated by a review restart");
  if (packet.recordedAt) throw new Error("Review packet has already been recorded");
  if (state.phase !== expectedPhase(packet.stage, packet.role)) throw new Error("Review packet is no longer current");
  if (findingsFile && packet.protocol === 2) {
    const [canonicalRoot, provided] = await Promise.all([
      realpath(root),
      realpath(path.resolve(root, findingsFile))
    ]);
    const expected = path.resolve(canonicalRoot, packet.findingsPath);
    if (provided !== expected) {
      throw new Error(`Review responses must use this packet's findingsPath: ${packet.findingsPath}`);
    }
  }
  const current = snapshotFingerprint(await reviewSnapshot(root, state, packet.stage));
  if (current !== packet.fingerprint) throw new Error("Reviewed content changed; prepare a fresh review packet");
  if (packet.stage === "design" && !state.developerApproval) {
    throw new Error("Developer approval is required before recording design review");
  }
  if (packet.stage === "design" && state.developerApproval.fingerprint !== current) {
    throw new Error("Design changed after developer approval; restart design review");
  }
  if (packet.stage === "quality") await requireCurrentDesign(root, state);
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
  const findings = await parseFindings(findingsFile, packet, state);
  if (verdict === "changes-requested" && findings.length === 0) {
    throw new Error("Changes-requested verdict requires a findings file");
  }
  if (verdict === "approved" && findings.length) {
    throw new Error("Approved verdict cannot include unresolved findings");
  }
  if (verdict === "approved" && packet.role === "verifier"
    && state.findings.some(item => !item.retired && item.stage === packet.stage && !item.resolved)) {
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
    cycleId: packet.cycleId,
    recordedAt: packet.recordedAt
  };
  if (packet.stage === "design") {
    state.reviews[`${packet.stage}-${packet.role}`].contractFingerprint = await designContractFingerprint(root, state);
  }
  applyFindings(state, packet, findings);
  if (verdict === "changes-requested") state.phase = `${packet.stage}-remediation`;
  else if (packet.role === "critic") state.phase = `${packet.stage}-verifier`;
  else state.phase = packet.stage === "design" ? "ready-to-build" : "ready-to-commit";
  await saveState(root, state);
  return state;
}

function retireFindings(state, stages) {
  const retiredAt = new Date().toISOString();
  for (const finding of state.findings) {
    if (stages.includes(finding.stage) && !finding.retired) {
      finding.retired = true;
      finding.retiredAt = retiredAt;
    }
  }
}

function invalidatePackets(state, stages) {
  const obsoleteAt = new Date().toISOString();
  for (const packet of state.packets) {
    if (stages.includes(packet.stage) && !packet.recordedAt && !packet.obsoleteAt) packet.obsoleteAt = obsoleteAt;
  }
}

export async function restartDesignReview(root, state) {
  if (!["design-critic", "design-remediation", "design-verifier", "ready-to-build", "implementing", "baseline-sealed", "quality-critic", "quality-remediation", "quality-verifier", "ready-to-commit"].includes(state.phase)) {
    throw new Error(`Design review cannot be restarted during ${state.phase}`);
  }
  retireFindings(state, ["design", "quality"]);
  invalidatePackets(state, ["design", "quality"]);
  delete state.reviews["design-critic"];
  delete state.reviews["design-verifier"];
  delete state.reviews["quality-critic"];
  delete state.reviews["quality-verifier"];
  delete state.baseline;
  delete state.commitPlan;
  delete state.developerApproval;
  delete state.developerReviewTarget;
  delete state.developerReviewFingerprint;
  state.phase = "developer-review";
  await saveState(root, state);
  return state;
}

export async function restartQualityReview(root, state) {
  if (!["baseline-sealed", "quality-critic", "quality-remediation", "quality-verifier", "ready-to-commit"].includes(state.phase)) {
    throw new Error(`Quality review cannot be restarted during ${state.phase}`);
  }
  await requireCurrentDesign(root, state);
  const fingerprint = await projectFingerprint(root);
  if (!hasRequiredCurrentEvidence(state, fingerprint)) {
    throw new Error("Run all required tests for the current candidate before restarting quality review");
  }
  retireFindings(state, ["quality"]);
  invalidatePackets(state, ["quality"]);
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
  const finding = state.findings.find(item => item.id === id && !item.retired);
  if (!finding) throw new Error(`Unknown active finding: ${id}`);
  finding.resolved = true;
  finding.resolvedAt = new Date().toISOString();
  await saveState(root, state);
  return finding;
}
