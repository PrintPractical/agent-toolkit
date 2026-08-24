import assert from "node:assert/strict";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { withDirectoryLock } from "../src/locks.mjs";
import { temporaryDirectory } from "./helpers.mjs";

test("an old lock held by a live process is not stolen", async () => {
  const root = await temporaryDirectory();
  const lock = path.join(root, "operation.lock");
  await mkdir(lock);
  await writeFile(path.join(lock, "owner.json"), `${JSON.stringify({ pid: process.pid, token: "live" })}\n`);
  const old = new Date(Date.now() - 120_000);
  await utimes(lock, old, old);
  await assert.rejects(withDirectoryLock(lock, "busy", async () => {}), /busy/);
});

test("a lock owned by a dead process is recovered", async () => {
  const root = await temporaryDirectory();
  const lock = path.join(root, "operation.lock");
  await mkdir(lock);
  await writeFile(path.join(lock, "owner.json"), `${JSON.stringify({ pid: 2_147_483_647, token: "dead" })}\n`);
  let called = false;
  await withDirectoryLock(lock, "busy", async () => { called = true; });
  assert.equal(called, true);
});

test("concurrent dead-owner recovery admits only one operation", async () => {
  const root = await temporaryDirectory();
  const lock = path.join(root, "operation.lock");
  await mkdir(lock);
  await writeFile(path.join(lock, "owner.json"), `${JSON.stringify({ pid: 2_147_483_647, token: "dead" })}\n`);
  let active = 0;
  let maximum = 0;
  const operation = () => withDirectoryLock(lock, "busy", async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 20));
    active -= 1;
  });
  const results = await Promise.allSettled([operation(), operation()]);
  assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
  assert.equal(maximum, 1);
});
