import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const bundledSkillsRoot = fileURLToPath(new URL("..", import.meta.url));
export const skillsCliVersion = "1.4.4";

export function parseInstallOptions(values) {
  const options = { global: false, agents: [], all: false, copy: false };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--global") options.global = true;
    else if (value === "--all") options.all = true;
    else if (value === "--copy") options.copy = true;
    else if (value === "--agent") {
      const agent = values[index + 1];
      if (!agent || agent.startsWith("-")) throw new Error("Missing --agent value");
      options.agents.push(agent);
      index += 1;
    } else {
      throw new Error(`Unknown install option: ${value}`);
    }
  }
  if (options.all && options.agents.length) throw new Error("Use either --all or --agent, not both");
  if (options.all && options.global) throw new Error("--all is project-only; use --agent with --global");
  return options;
}

export function skillsInstallArguments({ global = false, agents = [], all = false, copy = false } = {}) {
  const args = ["--yes", `skills@${skillsCliVersion}`, "add", bundledSkillsRoot];
  if (all) args.push("--all");
  else {
    args.push("--skill", "*");
    for (const agent of agents) args.push("--agent", agent);
    if (agents.length) args.push("--yes");
  }
  if (global) args.push("--global");
  if (copy) args.push("--copy");
  return args;
}

export function npxExecutable(platform = process.platform) {
  return platform === "win32" ? "npx.cmd" : "npx";
}

export async function installSkills(options = {}, {
  spawnProcess = spawn,
  platform = process.platform,
  stdout = process.stdout,
  stderr = process.stderr
} = {}) {
  for (const name of ["ideate", "design", "build", "fix"]) {
    await access(path.join(bundledSkillsRoot, "skills", name, "SKILL.md"));
  }
  const args = skillsInstallArguments(options);
  await new Promise((resolve, reject) => {
    const child = spawnProcess(npxExecutable(platform), args, { stdio: ["inherit", "pipe", "pipe"] });
    let tail = "";
    let failed = false;
    const relay = (stream, destination) => stream.on("data", chunk => {
      destination.write(chunk);
      const combined = `${tail}${chunk.toString()}`;
      if (combined.includes("Failed to install")) failed = true;
      tail = combined.slice(-64);
    });
    relay(child.stdout, stdout);
    relay(child.stderr, stderr);
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) reject(new Error(`skills installer exited ${code}`));
      else if (failed) reject(new Error("skills installer reported one or more failed targets"));
      else resolve();
    });
  });
}
