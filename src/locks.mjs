import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

async function owner(lock) {
  try {
    return JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

async function claimDeadLock(lock, observed, busyMessage) {
  const recovery = path.join(lock, "recovery");
  try {
    await mkdir(recovery);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(busyMessage);
    throw error;
  }
  const current = await owner(lock);
  if (current?.token !== observed?.token || processIsAlive(current?.pid)) {
    await rm(recovery, { recursive: true, force: true });
    throw new Error(busyMessage);
  }
  await rm(lock, { recursive: true, force: true });
}

export async function withDirectoryLock(lock, busyMessage, operation) {
  const token = randomUUID();
  for (;;) {
    try {
      await mkdir(lock);
      try {
        await writeFile(path.join(lock, "owner.json"), `${JSON.stringify({ pid: process.pid, token })}\n`);
        break;
      } catch (error) {
        await rm(lock, { recursive: true, force: true });
        throw error;
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await owner(lock);
      if (existing && processIsAlive(existing.pid)) throw new Error(busyMessage);
      if (!existing && Date.now() - (await stat(lock)).mtimeMs < 60_000) throw new Error(busyMessage);
      await claimDeadLock(lock, existing, busyMessage);
    }
  }
  try {
    return await operation();
  } finally {
    if ((await owner(lock))?.token === token) await rm(lock, { recursive: true, force: true });
  }
}
