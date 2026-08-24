import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_CONFIG = {
  version: 1,
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
  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  if (config.version !== 1) throw new Error("Unsupported config version");
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
