import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderChange } from "../src/artifacts.mjs";
import { DEFAULT_CONFIG } from "../src/config.mjs";
import { ensureIssue, linkIssue } from "../src/github.mjs";
import { createState, loadState, saveState } from "../src/state-machine.mjs";
import { temporaryDirectory } from "./helpers.mjs";

test("configured GitHub issue creation is idempotent", async () => {
  const root = await temporaryDirectory();
  const bin = path.join(root, "fake-bin");
  await mkdir(bin);
  const script = path.join(bin, "gh");
  await writeFile(script, `#!/bin/sh
case "$1 $2" in
  "auth status") exit 0 ;;
  "repo view") printf 'owner/repo\\n' ;;
  "issue list") printf '[]\\n' ;;
  "issue create") printf 'https://github.com/owner/repo/issues/42\\n' ;;
  *) exit 1 ;;
esac
`);
  await chmod(script, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  try {
    await renderChange(root, { kind: "feature", title: "Add Search", slug: "add-search" });
    const state = await createState(root, { slug: "add-search", kind: "feature", title: "Add Search", designPath: ".agent/changes/add-search.md", git: true });
    const config = structuredClone(DEFAULT_CONFIG);
    config.github.issues.policy = "create";
    const first = await ensureIssue(root, state, config);
    const recoveredState = await loadState(root);
    delete recoveredState.issue;
    await saveState(root, recoveredState);
    const listed = JSON.stringify([{ number: 42, url: first.url, body: `<!-- agent-toolkit-change: ${state.id} -->` }]);
    await writeFile(script, `#!/bin/sh
case "$1 $2" in
  "auth status") exit 0 ;;
  "repo view") printf 'owner/repo\\n' ;;
  "issue list") printf '%s\\n' '${listed}' ;;
  "issue create") exit 99 ;;
  *) exit 1 ;;
esac
`);
    const second = await ensureIssue(root, await loadState(root), config);
    assert.equal(first.number, 42);
    assert.deepEqual(second, first);
  } finally {
    process.env.PATH = oldPath;
  }
});

test("disabled GitHub integration rejects issue linking before invoking gh", async () => {
  const root = await temporaryDirectory();
  const state = { slug: "change" };
  await assert.rejects(linkIssue(root, state, DEFAULT_CONFIG, 42), /disabled/);
});
