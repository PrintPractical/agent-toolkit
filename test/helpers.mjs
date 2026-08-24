import { mkdtemp, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const cli = path.join(repositoryRoot, "bin", "agent-toolkit.mjs");

export async function temporaryDirectory(prefix = "agent-toolkit-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export function execute(command, args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout, stderr }));
  });
}

export async function runCli(cwd, args, env) {
  return execute(process.execPath, [cli, ...args], cwd, env);
}

export async function initializeGit(root) {
  await execute("git", ["init", "-q"], root);
  await execute("git", ["config", "user.name", "Toolkit Test"], root);
  await execute("git", ["config", "user.email", "toolkit@example.test"], root);
  await writeFile(path.join(root, "README.md"), "# Test project\n");
  await execute("git", ["add", "README.md"], root);
  await execute("git", ["commit", "-q", "-m", "chore: initialize test project"], root);
}
