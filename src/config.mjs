import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CONFIG = {
  version: 1,
  review: {
    maxClosureRejections: 2,
    requireFindingEvidence: true,
    reuseVerifierContext: true
  },
  evidence: {
    deduplicateCommands: true,
    timeoutMs: 1200000
  },
  completion: {
    commit: {
      policy: "if-git",
      conventional: true,
      dirtyWorktree: "block"
    }
  },
  github: {
    issues: {
      policy: "off",
      repository: "auto",
      commitLink: "closes",
      labels: []
    }
  }
};

export async function readConfig(root) {
  const file = path.join(root, ".agent", "config.json");
  let config;
  try {
    config = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("Toolkit is not initialized. Run: agent-toolkit init");
    }
    throw new Error(`Invalid ${path.relative(root, file)}: ${error.message}`);
  }
  const normalized = {
    ...DEFAULT_CONFIG,
    ...config,
    review: { ...DEFAULT_CONFIG.review, ...config.review },
    evidence: { ...DEFAULT_CONFIG.evidence, ...config.evidence },
    completion: {
      ...DEFAULT_CONFIG.completion,
      ...config.completion,
      commit: { ...DEFAULT_CONFIG.completion.commit, ...config.completion?.commit }
    },
    github: {
      ...DEFAULT_CONFIG.github,
      ...config.github,
      issues: { ...DEFAULT_CONFIG.github.issues, ...config.github?.issues }
    }
  };
  validateConfig(normalized);
  return normalized;
}

export function validateConfig(config) {
  if (config.version !== 1) throw new Error("Unsupported config version");
  const review = { ...DEFAULT_CONFIG.review, ...config.review };
  const evidence = { ...DEFAULT_CONFIG.evidence, ...config.evidence };
  if (!Number.isInteger(review.maxClosureRejections) || review.maxClosureRejections < 1) {
    throw new Error("review.maxClosureRejections must be a positive integer");
  }
  if (review.requireFindingEvidence !== true) {
    throw new Error("review.requireFindingEvidence must remain true");
  }
  if (review.reuseVerifierContext !== true) {
    throw new Error("review.reuseVerifierContext must remain true");
  }
  if (evidence.deduplicateCommands !== true) {
    throw new Error("evidence.deduplicateCommands must remain true");
  }
  if (!Number.isInteger(evidence.timeoutMs) || evidence.timeoutMs < 1) {
    throw new Error("evidence.timeoutMs must be a positive integer");
  }
  const commit = config.completion?.commit;
  const issues = config.github?.issues;
  if (!commit || !["if-git", "off"].includes(commit.policy)) {
    throw new Error("completion.commit.policy must be if-git or off");
  }
  if (commit.conventional !== true) throw new Error("completion.commit.conventional must remain true");
  if (commit.dirtyWorktree !== "block") throw new Error("completion.commit.dirtyWorktree must be block");
  if (!issues || !["off", "create", "existing"].includes(issues.policy)) {
    throw new Error("github.issues.policy must be off, create, or existing");
  }
  if (!["closes", "references"].includes(issues.commitLink)) {
    throw new Error("github.issues.commitLink must be closes or references");
  }
  if (!Array.isArray(issues.labels)) throw new Error("github.issues.labels must be an array");
}

export async function writeDefaultConfig(root) {
  const directory = path.join(root, ".agent");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, "config.json");
  try {
    await readFile(file);
    return false;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(file, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  return true;
}
