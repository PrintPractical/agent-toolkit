import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { readConfig, validateConfig, writeDefaultConfig } from "../src/config.mjs";
import { temporaryDirectory } from "./helpers.mjs";

test("default config keeps Git conditional and GitHub opt-in", async () => {
  const root = await temporaryDirectory();
  assert.equal(await writeDefaultConfig(root), true);
  assert.equal(await writeDefaultConfig(root), false);
  const config = await readConfig(root);
  assert.equal(config.completion.commit.policy, "if-git");
  assert.equal(config.github.issues.policy, "off");
  assert.match(await readFile(path.join(root, ".agent", "config.json"), "utf8"), /"commitLink": "closes"/);
});

test("invalid integration policies are rejected", () => {
  assert.throws(() => validateConfig({ version: 1, completion: { commit: { policy: "always" } }, github: { issues: { policy: "off", commitLink: "closes", labels: [] } } }), /if-git or off/);
});
