import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { artifactFingerprint } from "./fingerprints.mjs";
import { validateArtifacts } from "./artifacts.mjs";
import { saveState } from "./state-machine.mjs";

async function readNotes(file) {
  if (!file) return [];
  const content = await readFile(file, "utf8");
  try {
    const parsed = JSON.parse(content);
    const notes = Array.isArray(parsed) ? parsed : parsed.notes;
    if (!Array.isArray(notes)) throw new Error("Expected an array or { notes: [] }");
    return notes.map(item => typeof item === "string" ? item : item.description).filter(Boolean);
  } catch (error) {
    if (error instanceof SyntaxError) return content.split("\n").map(line => line.replace(/^[-*]\s*/, "").trim()).filter(Boolean);
    throw error;
  }
}

export async function recordDeveloperFeedback(root, state, { verdict, notesFile, notes: inlineNotes = [] }) {
  if (state.phase !== "developer-review") throw new Error(`Developer feedback cannot be recorded during ${state.phase}`);
  if (!["approved", "changes-requested"].includes(verdict)) {
    throw new Error("Feedback verdict must be approved or changes-requested");
  }
  const problems = await validateArtifacts(root, state, { requireSystem: true });
  if (problems.length) throw new Error(problems.join("\n"));
  const notes = [...inlineNotes, ...await readNotes(notesFile)].filter(Boolean);
  if (verdict === "changes-requested" && notes.length === 0) {
    throw new Error("Changes-requested feedback requires --note <text> or --notes <file>");
  }
  if (verdict === "approved" && notes.length) {
    throw new Error("Approved feedback cannot include change requests");
  }
  const record = {
    id: randomUUID(),
    verdict,
    notes,
    fingerprint: await artifactFingerprint(root, state),
    recordedAt: new Date().toISOString()
  };
  (state.developerFeedback ||= []).push(record);
  if (verdict === "approved") {
    state.developerApproval = record;
    state.phase = state.developerReviewTarget === "design-verifier"
      && state.developerReviewFingerprint === record.fingerprint ? "design-verifier" : "design-critic";
  } else {
    const retiredAt = new Date().toISOString();
    for (const finding of state.findings) {
      if (finding.stage === "design" && !finding.retired) Object.assign(finding, { status: "retired", retired: true, retiredAt });
    }
    for (const packet of state.packets) {
      if (packet.stage === "design" && !packet.recordedAt && !packet.obsoleteAt) packet.obsoleteAt = retiredAt;
    }
    delete state.reviews["design-critic"];
    delete state.reviews["design-verifier"];
    delete state.developerApproval;
    state.phase = "shaping";
  }
  delete state.developerReviewTarget;
  delete state.developerReviewFingerprint;
  await saveState(root, state);
  return record;
}
