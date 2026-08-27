import { mkdir, readFile, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { artifactFingerprint, artifactSnapshot, designContractFingerprint, executableFingerprint, projectFingerprint, projectSnapshot, snapshotFingerprint } from "./fingerprints.mjs";
import { validateArtifacts } from "./artifacts.mjs";
import { DEFAULT_CONFIG } from "./config.mjs";
import { findingBlocksCompletion, findingNeedsClosure, findingStatus, hasRequiredCurrentEvidence, requireCurrentDesign, saveState } from "./state-machine.mjs";

const DISPOSITION_OUTCOMES = ["not-applicable", "outside-contract", "not-material", "duplicate", "deferred"];

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

export async function prepareReview(root, state, { stage, role }, config = DEFAULT_CONFIG) {
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
  const evidenceFingerprint = stage === "quality" ? await executableFingerprint(root) : fingerprint;
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
  if (stage === "quality" && !hasRequiredCurrentEvidence(state, evidenceFingerprint, fingerprint)) {
    throw new Error(state.kind === "fix"
      ? "Run the recorded regression command successfully for the current fix before quality review"
      : "Run relevant tests for the current candidate before quality review");
  }
  const id = randomUUID();
  const findingsPath = `.agent/.state/reviews/${id}.json`;
  await mkdir(path.join(root, ".agent", ".state", "reviews"), { recursive: true });
  const cycleId = role === "critic" ? id : critic.cycleId || critic.packetId;
  const suppliedFindings = role === "verifier"
    ? state.findings.filter(item => findingStatus(item) !== "retired" && item.stage === stage
      && (item.reviewCycleId === cycleId || (!critic.cycleId && !item.reviewCycleId)))
    : [];
  const packet = {
    id,
    stage,
    role,
    protocol: 3,
    cycleId,
    findingIds: suppliedFindings.map(item => item.id),
    fingerprint,
    evidenceFingerprint,
    designPath: state.designPath,
    findingsPath,
    ...(role === "critic" ? { checklist: criticChecklist(stage) } : {
      reuseReviewer: config.review.reuseVerifierContext,
      escalation: state.reviewEscalation?.cycleId === cycleId ? state.reviewEscalation : null
    }),
    preparedAt: new Date().toISOString()
  };
  state.packets.push(packet);
  await saveState(root, state);
  return {
    ...packet,
    candidate: snapshot,
    findings: suppliedFindings.map(({ id: findingId, severity, description, verification, introducedByRemediation, evidence, contractReference, observableImpact, disposition, status, resolved }) => ({
      id: findingId,
      severity: severity || "medium",
      description,
      status: status || (resolved ? "resolved" : "open"),
      verification: verification || null,
      introducedByRemediation: introducedByRemediation || false,
      contractReference: contractReference || null,
      evidence: evidence || null,
      observableImpact: observableImpact || null,
      disposition: disposition || null
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
  if (![2, 3].includes(packet.protocol)) throw new Error(`Unsupported review packet protocol: ${packet.protocol}`);
  if (!file) {
    throw new Error(`Protocol ${packet.protocol} review responses must be saved to ${packet.findingsPath} and recorded with --findings ${packet.findingsPath}`);
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
    if (packet.protocol === 3) {
      for (const key of ["contractReference", "evidence", "observableImpact"]) {
        if (typeof item[key] !== "string" || !item[key].trim()) {
          throw new Error(`Finding ${index + 1} requires a concrete ${key}`);
        }
        finding[key] = item[key].trim();
      }
    }
    const evidenceProperties = packet.protocol === 3 ? ["contractReference", "evidence", "observableImpact"] : [];
    if (packet.role === "critic") {
      if (Object.keys(item).some(key => !["severity", "description", ...evidenceProperties].includes(key))) {
        throw new Error(`Critic finding ${index + 1} contains unsupported properties`);
      }
      return finding;
    }
    if (item.sourceFindingId) {
      if (Object.keys(item).some(key => !["severity", "description", "sourceFindingId", ...evidenceProperties].includes(key))) {
        throw new Error(`Verifier finding ${index + 1} contains unsupported properties`);
      }
      if (!packet.findingIds.includes(item.sourceFindingId)) {
        throw new Error(`Verifier finding ${index + 1} must reference a supplied finding ID`);
      }
      return { ...finding, sourceFindingId: item.sourceFindingId };
    }
    if (item.introducedByRemediation === true && item.severity === "high"
      && typeof item.evidence === "string" && item.evidence.trim()) {
      if (Object.keys(item).some(key => !["severity", "description", "introducedByRemediation", "evidence", ...evidenceProperties].includes(key))) {
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
      source.status = "open";
      source.resolved = false;
      delete source.resolvedAt;
      if (source.disposition) source.disposition.rejectedAt = new Date().toISOString();
      source.verification = {
        description: finding.description,
        severity: finding.severity,
        ...(finding.contractReference ? { contractReference: finding.contractReference } : {}),
        ...(finding.evidence ? { evidence: finding.evidence } : {}),
        ...(finding.observableImpact ? { observableImpact: finding.observableImpact } : {}),
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
      status: "open",
      resolved: false
    });
  }
}

export async function recordReview(root, state, { packetId, verdict, reviewer, findingsFile }, config = DEFAULT_CONFIG) {
  if (!["approved", "changes-requested"].includes(verdict)) {
    throw new Error("Review verdict must be approved or changes-requested");
  }
  if (!reviewer) throw new Error("Reviewer identity is required to enforce critic/verifier separation");
  const packet = state.packets.find(item => item.id === packetId);
  if (!packet) throw new Error(`Unknown review packet: ${packetId}`);
  if (packet.obsoleteAt) throw new Error("Review packet was invalidated by a review restart");
  if (packet.recordedAt) throw new Error("Review packet has already been recorded");
  if (state.phase !== expectedPhase(packet.stage, packet.role)) throw new Error("Review packet is no longer current");
  if (findingsFile && packet.protocol >= 2) {
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
  const evidenceFingerprint = packet.stage === "quality" ? await executableFingerprint(root) : current;
  if (packet.stage === "quality" && !hasRequiredCurrentEvidence(state, evidenceFingerprint, current)) {
    throw new Error(state.kind === "fix"
      ? "Current passing regression evidence is required before recording quality approval"
      : "Current passing test evidence is required before recording quality approval");
  }
  const prior = state.reviews[`${packet.stage}-critic`];
  if (packet.role === "verifier" && reviewer && prior?.reviewer === reviewer) {
    throw new Error("Verifier must be distinct from the critic");
  }
  const priorVerifier = state.packets.find(item => item.stage === packet.stage && item.role === "verifier"
    && item.cycleId === packet.cycleId && item.recordedAt);
  if (packet.role === "verifier" && config.review.reuseVerifierContext
    && priorVerifier && priorVerifier.reviewer !== reviewer) {
    throw new Error(`Reuse verifier context ${priorVerifier.reviewer} for closure retries in this review cycle`);
  }
  const findings = await parseFindings(findingsFile, packet, state);
  if (verdict === "changes-requested" && findings.length === 0) {
    throw new Error("Changes-requested verdict requires a findings file");
  }
  if (verdict === "approved" && findings.length) {
    throw new Error("Approved verdict cannot include unresolved findings");
  }
  const dispositionVerification = state.reviewEscalation?.cycleId === packet.cycleId
    && state.reviewEscalation.awaitingDispositionVerification;
  if (verdict === "approved" && packet.role === "verifier"
    && state.findings.some(item => item.stage === packet.stage
      && (dispositionVerification ? findingNeedsClosure(item) : findingBlocksCompletion(item)))) {
    throw new Error(dispositionVerification
      ? "Resolve or disposition all findings before verifier approval"
      : "Resolve all findings before verifier approval");
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
  if (verdict === "changes-requested" && packet.role === "verifier") {
    const rejectionCount = state.packets.filter(item => item.stage === packet.stage && item.role === "verifier"
      && item.cycleId === packet.cycleId && item.verdict === "changes-requested").length;
    const escalatedAttempt = state.reviewEscalation?.cycleId === packet.cycleId
      && (state.reviewEscalation.awaitingDispositionVerification || state.reviewEscalation.retryAuthorized);
    if (escalatedAttempt || rejectionCount >= config.review.maxClosureRejections) {
      state.reviewEscalation = {
        ...state.reviewEscalation,
        stage: packet.stage,
        cycleId: packet.cycleId,
        enteredAt: state.reviewEscalation?.enteredAt || new Date().toISOString(),
        closureRejections: rejectionCount,
        awaitingDispositionVerification: false,
        retryAuthorized: false,
        lastRejectedPacketId: packet.id
      };
      state.phase = "review-escalation";
    } else {
      state.phase = `${packet.stage}-remediation`;
    }
  } else if (verdict === "changes-requested") {
    state.phase = `${packet.stage}-remediation`;
  } else if (packet.role === "critic") {
    state.phase = `${packet.stage}-verifier`;
  } else {
    if (dispositionVerification) {
      const verifiedAt = new Date().toISOString();
      for (const finding of state.findings) {
        if (finding.stage === packet.stage && findingStatus(finding) === "disposition-pending") {
          finding.status = "disposition-verified";
          finding.resolved = true;
          finding.disposition.verifiedAt = verifiedAt;
          finding.disposition.verifierPacketId = packet.id;
        }
      }
    }
    if (state.reviewEscalation?.cycleId === packet.cycleId) {
      state.reviewEscalation.completedAt = new Date().toISOString();
      (state.reviewEscalationHistory ||= []).push(state.reviewEscalation);
      delete state.reviewEscalation;
    }
    state.phase = packet.stage === "design" ? "ready-to-build" : "ready-to-commit";
  }
  await saveState(root, state);
  return state;
}

function retireFindings(state, stages) {
  const retiredAt = new Date().toISOString();
  for (const finding of state.findings) {
    if (stages.includes(finding.stage) && !finding.retired) {
      finding.retired = true;
      finding.status = "retired";
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

function archiveEscalation(state) {
  if (!state.reviewEscalation) return;
  state.reviewEscalation.completedAt = new Date().toISOString();
  (state.reviewEscalationHistory ||= []).push(state.reviewEscalation);
  delete state.reviewEscalation;
}

export async function restartDesignReview(root, state, { fromEscalation = false } = {}) {
  if (!["design-critic", "design-remediation", "design-verifier", "ready-to-build", "implementing", "baseline-sealed", "quality-critic", "quality-remediation", "quality-verifier", "review-escalation", "ready-to-commit"].includes(state.phase)) {
    throw new Error(`Design review cannot be restarted during ${state.phase}`);
  }
  if (state.phase === "review-escalation" && !fromEscalation) {
    throw new Error("Record the restart-design decision with: agent-toolkit escalation record --decision restart-design");
  }
  retireFindings(state, ["design", "quality"]);
  invalidatePackets(state, ["design", "quality"]);
  delete state.reviews["design-critic"];
  delete state.reviews["design-verifier"];
  delete state.reviews["quality-critic"];
  delete state.reviews["quality-verifier"];
  delete state.baseline;
  delete state.commitPlan;
  archiveEscalation(state);
  delete state.developerApproval;
  delete state.developerReviewTarget;
  delete state.developerReviewFingerprint;
  state.phase = "developer-review";
  await saveState(root, state);
  return state;
}

export async function restartQualityReview(root, state, { fromEscalation = false } = {}) {
  if (!["baseline-sealed", "quality-critic", "quality-remediation", "quality-verifier", "review-escalation", "ready-to-commit"].includes(state.phase)
    || (state.phase === "review-escalation" && state.reviewEscalation?.stage !== "quality")) {
    throw new Error(`Quality review cannot be restarted during ${state.phase}`);
  }
  if (state.phase === "review-escalation" && !fromEscalation) {
    throw new Error("Record the restart-quality decision with: agent-toolkit escalation record --decision restart-quality");
  }
  await requireCurrentDesign(root, state);
  const fingerprint = await projectFingerprint(root);
  const evidenceFingerprint = await executableFingerprint(root);
  if (!hasRequiredCurrentEvidence(state, evidenceFingerprint, fingerprint)) {
    throw new Error("Run all required tests for the current candidate before restarting quality review");
  }
  retireFindings(state, ["quality"]);
  invalidatePackets(state, ["quality"]);
  delete state.reviews["quality-critic"];
  delete state.reviews["quality-verifier"];
  delete state.commitPlan;
  archiveEscalation(state);
  state.baseline = {
    fingerprint,
    evidenceFingerprint,
    designFingerprint: await artifactFingerprint(root, state),
    sealedAt: new Date().toISOString()
  };
  state.phase = "quality-critic";
  await saveState(root, state);
  return state;
}

export async function resolveFinding(root, state, id) {
  const finding = state.findings.find(item => item.id === id && findingStatus(item) !== "retired");
  if (!finding) throw new Error(`Unknown active finding: ${id}`);
  finding.status = "resolved";
  finding.resolved = true;
  finding.resolvedAt = new Date().toISOString();
  await saveState(root, state);
  return finding;
}

export async function dispositionFinding(root, state, id, { outcome, reason, duplicateOf, followUp }) {
  if (state.phase !== "review-escalation") throw new Error("Findings may be dispositioned only during review escalation");
  if (!DISPOSITION_OUTCOMES.includes(outcome)) {
    throw new Error(`Disposition outcome must be one of: ${DISPOSITION_OUTCOMES.join(", ")}`);
  }
  if (typeof reason !== "string" || !reason.trim()) throw new Error("Disposition rationale is required");
  const finding = state.findings.find(item => item.id === id && item.stage === state.reviewEscalation?.stage
    && !["retired", "resolved", "disposition-verified"].includes(findingStatus(item)));
  if (!finding) throw new Error(`Unknown open escalation finding: ${id}`);
  if (outcome === "duplicate") {
    const target = state.findings.find(item => item.id === duplicateOf && item.id !== id
      && item.stage === finding.stage && findingStatus(item) !== "retired");
    if (!target) throw new Error("Duplicate disposition requires --duplicate-of with another active finding ID");
  } else if (duplicateOf) {
    throw new Error("--duplicate-of is valid only for a duplicate disposition");
  }
  if (followUp && outcome !== "deferred") throw new Error("--follow-up is valid only for a deferred disposition");
  finding.status = "disposition-pending";
  finding.resolved = false;
  delete finding.resolvedAt;
  finding.disposition = {
    outcome,
    reason: reason.trim(),
    ...(duplicateOf ? { duplicateOf } : {}),
    ...(followUp ? { followUp } : {}),
    recordedAt: new Date().toISOString()
  };
  await saveState(root, state);
  return finding;
}

export async function recordEscalation(root, state, decision, reason) {
  if (state.phase !== "review-escalation" || !state.reviewEscalation) {
    throw new Error("No review escalation requires a developer decision");
  }
  const allowed = ["continue", "retry", "require-proof", "restart-quality", "restart-design", "split", "stop"];
  if (!allowed.includes(decision)) throw new Error(`Escalation decision must be one of: ${allowed.join(", ")}`);
  if (["require-proof", "split", "stop"].includes(decision) && (!reason || !reason.trim())) {
    throw new Error(`${decision} requires --reason`);
  }
  if (decision === "restart-quality" && state.reviewEscalation.stage !== "quality") {
    throw new Error("Quality review can be restarted only from a quality escalation");
  }
  if (decision === "continue" && state.findings.some(item => item.stage === state.reviewEscalation.stage && findingNeedsClosure(item))) {
    throw new Error("Resolve or disposition every active finding before continuing to final verification");
  }
  if (decision === "retry" && state.reviewEscalation.retryUsed) {
    throw new Error("The additional focused remediation retry has already been used");
  }
  const record = { decision, ...(reason ? { reason: reason.trim() } : {}), recordedAt: new Date().toISOString() };
  (state.reviewEscalation.decisions ||= []).push(record);
  if (decision === "restart-design") return restartDesignReview(root, state, { fromEscalation: true });
  if (decision === "restart-quality") return restartQualityReview(root, state, { fromEscalation: true });
  if (decision === "continue") {
    state.reviewEscalation.awaitingDispositionVerification = true;
    state.reviewEscalation.retryAuthorized = false;
    state.phase = `${state.reviewEscalation.stage}-verifier`;
  } else if (decision === "retry") {
    state.reviewEscalation.retryUsed = true;
    state.reviewEscalation.retryAuthorized = true;
    state.reviewEscalation.awaitingDispositionVerification = false;
    state.phase = `${state.reviewEscalation.stage}-remediation`;
  }
  await saveState(root, state);
  return state;
}
