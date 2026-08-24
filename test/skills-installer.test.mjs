import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { bundledSkillsRoot, installSkills, npxExecutable, parseInstallOptions, skillsCliVersion, skillsInstallArguments } from "../src/skills-installer.mjs";
import { runCli, temporaryDirectory } from "./helpers.mjs";

test("skill installer targets bundled skills with portable options", () => {
  assert.deepEqual(skillsInstallArguments({ global: true, agents: ["opencode", "claude-code"], copy: true }), [
    "--yes", `skills@${skillsCliVersion}`, "add", bundledSkillsRoot,
    "--skill", "*", "--agent", "opencode", "--agent", "claude-code", "--yes", "--global", "--copy"
  ]);
  assert.deepEqual(skillsInstallArguments({ all: true }), ["--yes", `skills@${skillsCliVersion}`, "add", bundledSkillsRoot, "--all"]);
});

test("install options reject typos, missing values, and unsafe combinations", () => {
  assert.deepEqual(parseInstallOptions(["--global", "--agent", "opencode", "--agent", "claude-code", "--copy"]), {
    global: true,
    agents: ["opencode", "claude-code"],
    all: false,
    copy: true
  });
  assert.throws(() => parseInstallOptions(["--globla"]), /Unknown install option/);
  assert.throws(() => parseInstallOptions(["--agent"]), /Missing --agent value/);
  assert.throws(() => parseInstallOptions(["--agent", "-g"]), /Missing --agent value/);
  assert.throws(() => parseInstallOptions(["--all", "--agent", "opencode"]), /either --all or --agent/);
  assert.throws(() => parseInstallOptions(["--all", "--global"]), /project-only/);
});

function installerProcess(output, code = 0) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  queueMicrotask(() => {
    child.stdout.end(output);
    child.stderr.end();
    child.emit("close", code);
  });
  return child;
}

test("installer selects the platform command and rejects reported target failures", async () => {
  let invocation;
  const output = new PassThrough();
  await installSkills({ agents: ["opencode"] }, {
    platform: "win32",
    stdout: output,
    stderr: output,
    spawnProcess(executable, args, options) {
      invocation = { executable, args, options };
      return installerProcess("Installed 3 skills\n");
    }
  });
  assert.equal(invocation.executable, "npx.cmd");
  assert.equal(invocation.options.stdio[0], "inherit");
  assert.equal(npxExecutable("linux"), "npx");
  await assert.rejects(installSkills({ agents: ["opencode"] }, {
    spawnProcess: () => installerProcess("Installation complete\nFailed to install 1\n"),
    stdout: output,
    stderr: output
  }), /reported one or more failed targets/);
  await assert.rejects(installSkills({ agents: ["opencode"] }, {
    spawnProcess: () => installerProcess("", 2),
    stdout: output,
    stderr: output
  }), /exited 2/);
});

test("CLI validates install options before invoking the external installer", async () => {
  const result = await runCli(await temporaryDirectory(), ["install", "--globla"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Unknown install option: --globla/);
});
