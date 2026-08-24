import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { projectFingerprint } from "./fingerprints.mjs";
import { saveState } from "./state-machine.mjs";

function execute(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output = (output + chunk).slice(-8000); });
    child.stderr.on("data", chunk => { output = (output + chunk).slice(-8000); });
    child.on("error", reject);
    child.on("close", code => resolve({ code, output }));
  });
}

export async function recordTest(root, state, { kind, expectFail, command, args }) {
  if (!["regression", "unit", "integration"].includes(kind)) {
    throw new Error("Test kind must be regression, unit, or integration");
  }
  if (!command) throw new Error("Test command required after --");
  const before = await projectFingerprint(root);
  const result = await execute(command, args, root);
  const after = await projectFingerprint(root);
  if (before !== after) throw new Error("Test command changed the project candidate; discard its changes and run it again");
  if (expectFail && result.code === 0) throw new Error("Expected-failing test passed; regression is not reproduced");
  if (!expectFail && result.code !== 0) {
    throw new Error(`Test command failed with exit ${result.code}\n${result.output}`);
  }
  const evidence = {
    id: randomUUID(),
    kind,
    expectFail,
    command: [command, ...args],
    code: result.code,
    output: result.output,
    fingerprint: after,
    recordedAt: new Date().toISOString()
  };
  state.evidence.push(evidence);
  await saveState(root, state);
  return evidence;
}
