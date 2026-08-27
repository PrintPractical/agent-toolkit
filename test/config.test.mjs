import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CONFIG, readConfig, validateConfig, writeDefaultConfig } from "../src/config.mjs";
import { temporaryDirectory } from "./helpers.mjs";

test("default config keeps Git conditional and GitHub opt-in", async () => {
  const root = await temporaryDirectory();
  assert.equal(await writeDefaultConfig(root), true);
  assert.equal(await writeDefaultConfig(root), false);
  const config = await readConfig(root);
  assert.equal(config.completion.commit.policy, "if-git");
  assert.equal(config.github.issues.policy, "off");
  assert.deepEqual(config.review, { maxClosureRejections: 2, requireFindingEvidence: true, reuseVerifierContext: true });
  assert.deepEqual(config.evidence, { deduplicateCommands: true, timeoutMs: 1200000 });
  assert.match(await readFile(path.join(root, ".agent", "config.json"), "utf8"), /"commitLink": "closes"/);
});

test("invalid integration policies are rejected", () => {
  assert.throws(() => validateConfig({ version: 1, completion: { commit: { policy: "always" } }, github: { issues: { policy: "off", commitLink: "closes", labels: [] } } }), /if-git or off/);
});

test("legacy version 1 config receives workflow guardrail defaults", async () => {
  const root = await temporaryDirectory();
  await writeDefaultConfig(root);
  const configPath = path.join(root, ".agent", "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  delete config.review;
  delete config.evidence;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const normalized = await readConfig(root);
  assert.equal(normalized.review.maxClosureRejections, 2);
  assert.equal(normalized.evidence.timeoutMs, 1200000);
});

test("review and evidence safeguards cannot be disabled", () => {
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, review: { ...DEFAULT_CONFIG.review, maxClosureRejections: 0 } }), /positive integer/);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, review: { ...DEFAULT_CONFIG.review, requireFindingEvidence: false } }), /must remain true/);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, evidence: { ...DEFAULT_CONFIG.evidence, timeoutMs: 0 } }), /positive integer/);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, evidence: { ...DEFAULT_CONFIG.evidence, deduplicateCommands: false } }), /must remain true/);
});
