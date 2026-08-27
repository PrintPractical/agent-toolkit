import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { executableFingerprint } from "./fingerprints.mjs";
import { saveState } from "./state-machine.mjs";

function execute(command, args, cwd, timeoutMs) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    let spawnError;
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, output, timedOut, ...(spawnError ? { error: spawnError.message } : {}) });
    };
    const terminate = signal => {
      try {
        if (process.platform === "win32") child.kill(signal);
        else process.kill(-child.pid, signal);
      } catch {}
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      setTimeout(() => terminate("SIGKILL"), 1000).unref();
    }, timeoutMs);
    child.stdout.on("data", chunk => { output = (output + chunk).slice(-8000); });
    child.stderr.on("data", chunk => { output = (output + chunk).slice(-8000); });
    child.on("error", error => {
      spawnError = error;
      finish({ code: null });
    });
    child.on("close", (code, signal) => finish({ code, signal }));
  });
}

export async function recordTest(root, state, { kind, expectFail, command, args }, config) {
  if (!["regression", "unit", "integration", "acceptance"].includes(kind)) {
    throw new Error("Test kind must be regression, unit, integration, or acceptance");
  }
  if (!command) throw new Error("Test command required after --");
  const timeoutMs = config?.evidence?.timeoutMs || 1200000;
  const before = await executableFingerprint(root);
  const result = await execute(command, args, root, timeoutMs);
  const after = await executableFingerprint(root);
  const evidence = {
    id: randomUUID(),
    kind,
    expectFail,
    command: [command, ...args],
    code: result.code,
    ...(result.signal ? { signal: result.signal } : {}),
    ...(result.error ? { error: result.error } : {}),
    timedOut: result.timedOut,
    candidateChanged: before !== after,
    output: result.output,
    fingerprint: after,
    recordedAt: new Date().toISOString()
  };
  state.evidence.push(evidence);
  await saveState(root, state);
  if (before !== after) throw new Error("Test command changed the project candidate's executable content; discard its changes and run it again");
  if (result.timedOut) throw new Error(`Test command timed out after ${timeoutMs}ms\n${result.output}`);
  if (result.error) throw new Error(`Test command could not start: ${result.error}`);
  if (expectFail && result.code === 0) throw new Error("Expected-failing test passed; regression is not reproduced");
  if (!expectFail && result.code !== 0) {
    throw new Error(`Test command failed with exit ${result.code}\n${result.output}`);
  }
  return evidence;
}
