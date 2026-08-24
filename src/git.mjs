import { spawn } from "node:child_process";

export function run(command, args, { cwd, allowFailure = false, input, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: [input ? "pipe" : "ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    if (input) child.stdin.end(input);
    child.on("close", code => {
      const result = { code, stdout: stdout.trim(), stderr: stderr.trim() };
      if (code !== 0 && !allowFailure) reject(new Error(stderr.trim() || `${command} exited ${code}`));
      else resolve(result);
    });
  });
}

export function runGit(root, args, options = {}) {
  return run("git", args, { cwd: root, ...options });
}

export function runGitBuffer(root, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", chunk => stdout.push(chunk));
    child.stderr.on("data", chunk => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0) reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `git exited ${code}`));
      else resolve(Buffer.concat(stdout));
    });
  });
}

export async function isGitRepository(root) {
  const result = await runGit(root, ["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
  return result.code === 0 && result.stdout === "true";
}

export async function statusPaths(root) {
  const output = await runGitBuffer(root, ["status", "--porcelain=v1", "-z", "-uall"]);
  const records = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] === 0) {
      if (index > start) records.push(output.subarray(start, index));
      start = index + 1;
    }
  }
  const display = value => {
    const text = value.toString("utf8");
    return Buffer.from(text).equals(value) ? text : `base64:${value.toString("base64")}`;
  };
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const status = record.subarray(0, 2).toString("ascii");
    const destination = display(record.subarray(3));
    if (/[RC]/.test(status)) {
      const source = records[index + 1];
      if (source) {
        paths.push(`${display(source)} -> ${destination}`);
        index += 1;
        continue;
      }
    }
    paths.push(destination);
  }
  return paths;
}

export function conventionalMessage(state, issue, config) {
  const type = state.kind === "fix" ? "fix" : "feat";
  const description = state.title.replace(/[.]$/, "").toLowerCase();
  const subject = `${type}: ${description}`;
  if (subject.length > 100) throw new Error("Generated commit subject exceeds 100 characters; shorten the change title");
  const paragraphs = [`Deliver ${state.title} from the reviewed design.`];
  if (issue) {
    const keyword = config.github.issues.commitLink === "closes" ? "Closes" : "Refs";
    paragraphs.push(`${keyword} ${issue.repository}#${issue.number}`);
  }
  return { subject, body: paragraphs.join("\n\n") };
}
