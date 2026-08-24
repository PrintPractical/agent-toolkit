import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { artifactFingerprint, designContractFingerprint, projectFingerprint } from "./fingerprints.mjs";
import { validateArtifacts } from "./artifacts.mjs";
import { withDirectoryLock } from "./locks.mjs";

export const PHASES = [
  "shaping", "developer-review", "design-critic", "design-remediation", "design-verifier",
  "ready-to-build", "implementing", "baseline-sealed", "quality-critic",
  "quality-remediation", "quality-verifier", "ready-to-commit", "complete"
];

const stateDirectory = root => path.join(root, ".agent", ".state");

export async function createState(root, data) {
  await mkdir(stateDirectory(root), { recursive: true });
  const state = {
    version: 1,
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
  await writeFile(path.join(stateDirectory(root), "active"), `${state.slug}\n`);
  return state;
}

export async function loadState(root) {
  let slug;
  try {
    slug = (await readFile(path.join(stateDirectory(root), "active"), "utf8")).trim();
  } catch {
    throw new Error("No active change. Run: agent-toolkit start --kind feature|fix --title \"...\"");
  }
  try {
    return JSON.parse(await readFile(path.join(stateDirectory(root), `${slug}.json`), "utf8"));
  } catch (error) {
    throw new Error(`Invalid runtime state for ${slug}: ${error.message}`);
  }
}

export async function saveState(root, state) {
  await mkdir(stateDirectory(root), { recursive: true });
  const target = path.join(stateDirectory(root), `${state.slug}.json`);
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
  await rename(temporary, target);
}

export async function withStateLock(root, operation) {
  const directory = stateDirectory(root);
  const lock = path.join(directory, "command.lock");
  await mkdir(directory, { recursive: true });
  return withDirectoryLock(lock, "Another toolkit command is running; retry after it completes", operation);
}

export function currentEvidence(state, fingerprint, predicate = () => true) {
  return state.evidence.some(item => item.fingerprint === fingerprint && predicate(item));
}

export function hasCurrentPassingEvidence(state, fingerprint) {
  return currentEvidence(state, fingerprint, item => !item.expectFail && item.code === 0);
}

function commandKey(item) {
  return JSON.stringify(item.command);
}

function hasPassingRegression(state, fingerprint) {
  const failure = state.evidence.find(item => item.id === state.regression?.evidenceId
    && item.kind === "regression" && item.expectFail && item.code !== 0);
  if (!failure || commandKey(failure) !== JSON.stringify(state.regression.command)) return false;
  return state.evidence.some(item => item.kind === "regression" && !item.expectFail && item.code === 0
    && item.fingerprint === fingerprint && commandKey(item) === commandKey(failure));
}

export function hasRequiredCurrentEvidence(state, fingerprint) {
  return hasCurrentPassingEvidence(state, fingerprint)
    && (state.kind !== "fix" || hasPassingRegression(state, fingerprint));
}

function requireVerifiedCandidate(state, fingerprint) {
  const verified = state.reviews["quality-verifier"];
  if (!verified || verified.verdict !== "approved" || verified.fingerprint !== fingerprint) {
    throw new Error("Current change does not match the approved quality-verifier candidate");
  }
  if (!hasRequiredCurrentEvidence(state, fingerprint)) {
    throw new Error(state.kind === "fix"
      ? "Current passing evidence for the recorded regression command is required for the verified fix"
      : "Current passing test evidence is required for the verified candidate");
  }
  if (state.findings.some(item => !item.retired && !item.resolved)) throw new Error("Resolve all findings before completion");
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

export async function advance(root, state, config) {
  const artifactHash = await artifactFingerprint(root, state);
  const codeHash = await projectFingerprint(root);
  switch (state.phase) {
    case "shaping": {
      const problems = await validateArtifacts(root, state, { requireSystem: true });
      if (problems.length) throw new Error(problems.join("\n"));
      state.phase = "developer-review";
      break;
    }
    case "design-remediation":
      if (state.findings.some(item => !item.retired && item.stage === "design" && !item.resolved)) {
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
        const failure = [...state.evidence].reverse().find(item => item.fingerprint === codeHash
          && item.kind === "regression" && item.expectFail && item.code !== 0);
        if (!failure) throw new Error("Record an expected-failing regression test before implementation");
        state.regression = { evidenceId: failure.id, command: failure.command };
      }
      state.phase = "implementing";
      break;
    case "implementing": {
      await requireCurrentDesign(root, state);
      const problems = await validateArtifacts(root, state, { requireSystem: true, requireConformance: true });
      if (problems.length) throw new Error(problems.join("\n"));
      const passing = hasCurrentPassingEvidence(state, codeHash);
      if (!passing) throw new Error("Current passing test evidence required before sealing the implementation");
      if (state.kind === "fix") {
        if (!hasPassingRegression(state, codeHash)) {
          throw new Error("Run the recorded regression command successfully before sealing the fix");
        }
      }
      state.baseline = { fingerprint: codeHash, designFingerprint: artifactHash, sealedAt: new Date().toISOString() };
      state.phase = "baseline-sealed";
      break;
    }
    case "baseline-sealed":
      if (codeHash !== state.baseline.fingerprint) {
        throw new Error("Candidate changed after baseline sealing; run: agent-toolkit review restart --stage quality");
      }
      if (!hasRequiredCurrentEvidence(state, codeHash)) {
        throw new Error("Current required test evidence no longer matches the sealed baseline");
      }
      state.phase = "quality-critic";
      break;
    case "quality-remediation":
      if (state.findings.some(item => !item.retired && item.stage === "quality" && !item.resolved)) {
        throw new Error("Resolve all quality findings before verification");
      }
      if (!hasRequiredCurrentEvidence(state, codeHash)) {
        throw new Error(state.kind === "fix"
          ? "Run the recorded regression command successfully for the remediated fix"
          : "Run relevant tests for the remediated candidate");
      }
      state.phase = "quality-verifier";
      break;
    case "ready-to-commit":
      await requireCurrentDesign(root, state);
      requireVerifiedCandidate(state, codeHash);
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
    case "complete":
      throw new Error("Change is already complete");
    default:
      throw new Error(`Cannot advance unknown phase: ${state.phase}`);
  }
  await saveState(root, state);
  return state;
}

export function nextAction(state, config) {
  const map = {
    shaping: "Complete the design, implementation plan, and system map, then run: agent-toolkit advance",
    "developer-review": "Review the design and implementation plan, then run: agent-toolkit feedback record --verdict approved|changes-requested",
    "design-critic": "agent-toolkit review prepare --stage design --role critic",
    "design-remediation": "Resolve design findings, then run: agent-toolkit advance",
    "design-verifier": "agent-toolkit review prepare --stage design --role verifier",
    "ready-to-build": config.github.issues.policy === "create" && !state.issue ? "agent-toolkit issue ensure" : config.github.issues.policy === "existing" && !state.issue ? "agent-toolkit issue link <number>" : "agent-toolkit advance",
    implementing: "Implement and test the change, then run: agent-toolkit advance",
    "baseline-sealed": "agent-toolkit advance",
    "quality-critic": "agent-toolkit review prepare --stage quality --role critic",
    "quality-remediation": "Resolve quality findings, rerun tests, then run: agent-toolkit advance",
    "quality-verifier": "agent-toolkit review prepare --stage quality --role verifier",
    "ready-to-commit": state.git && config.completion.commit.policy !== "off" ? "agent-toolkit commit prepare" : "agent-toolkit advance",
    complete: "No action; the change is complete"
  };
  return map[state.phase];
}
