import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CONFIG } from "../src/config.mjs";
import { conventionalMessage } from "../src/git.mjs";

test("commit footers qualify issues from explicit repositories", () => {
  const message = conventionalMessage(
    { kind: "feature", title: "Add Search" },
    { number: 42, repository: "other/project" },
    DEFAULT_CONFIG
  );
  assert.match(message.body, /Closes other\/project#42/);
});
