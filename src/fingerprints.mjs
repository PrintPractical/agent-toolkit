import { createHash } from "node:crypto";
import { lstat, readFile, readlink, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { isGitRepository, runGit, runGitBuffer } from "./git.mjs";

const excluded = new Set([".git", "node_modules"]);

export function snapshotFingerprint(snapshot) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function encoded(buffer) {
  const text = buffer.toString("utf8");
  return Buffer.from(text).equals(buffer) && !text.includes("\0")
    ? { encoding: "utf8", content: text }
    : { encoding: "base64", content: buffer.toString("base64") };
}

async function currentFile(root, relative) {
  const file = Buffer.isBuffer(relative)
    ? Buffer.concat([Buffer.from(root), Buffer.from(path.sep), relative])
    : path.join(root, relative);
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) {
      return { mode: "120000", ...encoded(Buffer.from(await readlink(file, { encoding: "buffer" }))) };
    }
    if (!stat.isFile()) return null;
    return { mode: stat.mode & 0o111 ? "100755" : "100644", ...encoded(await readFile(file)) };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function walk(directory, root, records) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (excluded.has(entry.name)) continue;
    const file = path.join(directory, entry.name);
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (relative === ".agent/.state" || relative.startsWith(".agent/.state/")) continue;
    if (entry.isDirectory()) await walk(file, root, records);
    else {
      const current = await currentFile(root, relative);
      if (current) records.push({ path: relative, status: "present", ...current });
    }
  }
}

function nulRecords(buffer) {
  const records = [];
  let start = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0) {
      if (index > start) records.push(buffer.subarray(start, index));
      start = index + 1;
    }
  }
  return records;
}

function pathKey(value) {
  return value.toString("base64");
}

function snapshotPath(value) {
  const text = value.toString("utf8");
  return Buffer.from(text).equals(value) ? text : { encoding: "base64", content: value.toString("base64") };
}

function isRuntimePath(value) {
  const text = value.toString("utf8");
  return Buffer.from(text).equals(value) && (text === ".agent/.state" || text.startsWith(".agent/.state/"));
}

async function nestedHead(root) {
  let actualRoot;
  try { actualRoot = await realpath(root); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const top = await runGit(root, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  if (top.code !== 0 || await realpath(top.stdout) !== actualRoot) return null;
  const head = await runGit(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true });
  return head.code === 0 ? head.stdout : null;
}

async function gitSnapshot(root) {
  const headResult = await runGit(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true });
  const head = headResult.code === 0 ? headResult.stdout : null;
  const tree = head ? (await runGit(root, ["rev-parse", "HEAD^{tree}"])).stdout : null;
  const base = new Map();
  if (head) {
    const listing = await runGitBuffer(root, ["ls-tree", "-rz", "HEAD"]);
    for (const record of nulRecords(listing)) {
      const tab = record.indexOf(9);
      if (tab < 0) continue;
      const header = record.subarray(0, tab).toString("ascii").match(/^(\d+) (blob|commit) ([0-9a-f]+)$/);
      if (header) {
        const relative = record.subarray(tab + 1);
        base.set(pathKey(relative), { path: relative, mode: header[1], type: header[2], oid: header[3] });
      }
    }
  }
  const listed = nulRecords(await runGitBuffer(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]));
  const index = new Map();
  const staged = nulRecords(await runGitBuffer(root, ["ls-files", "-z", "--stage"]));
  for (const record of staged) {
    const tab = record.indexOf(9);
    if (tab < 0) continue;
    const header = record.subarray(0, tab).toString("ascii").match(/^(\d+) ([0-9a-f]+) 0$/);
    if (header) index.set(pathKey(record.subarray(tab + 1)), { mode: header[1], oid: header[2] });
  }
  const paths = new Map([...base.values()].map(item => [pathKey(item.path), item.path]));
  for (const relative of listed) paths.set(pathKey(relative), relative);
  const changes = [];
  for (const relative of [...paths.values()].sort(Buffer.compare)) {
    if (isRuntimePath(relative)) continue;
    const key = pathKey(relative);
    const priorRecord = base.get(key) || null;
    const prior = priorRecord && { mode: priorRecord.mode, type: priorRecord.type, oid: priorRecord.oid };
    let before = null;
    if (prior) {
      before = prior.type === "commit"
        ? { ...prior }
        : { ...prior, ...encoded(await runGitBuffer(root, ["cat-file", "blob", prior.oid])) };
    }
    const gitlink = prior?.mode === "160000" || index.get(key)?.mode === "160000";
    if (gitlink) {
      const submoduleRoot = path.join(root, relative.toString("utf8"));
      const head = await nestedHead(submoduleRoot);
      const oid = head || index.get(key)?.oid || prior?.oid;
      let worktree;
      if (head) {
        const nested = await gitSnapshot(submoduleRoot);
        if (nested.changes.length) worktree = nested;
      }
      const current = oid ? { mode: "160000", type: "commit", oid, ...(worktree ? { worktree } : {}) } : null;
      if (!current) {
        if (before) changes.push({ path: snapshotPath(relative), status: "deleted", before });
      } else if (before?.oid !== current.oid || worktree) {
        changes.push({ path: snapshotPath(relative), status: before ? "modified" : "added", before, ...current });
      }
      continue;
    }
    const current = await currentFile(root, relative);
    if (!current) {
      if (before) changes.push({ path: snapshotPath(relative), status: "deleted", before });
      continue;
    }
    if (before?.mode === current.mode && before.encoding === current.encoding && before.content === current.content) continue;
    changes.push({
      path: snapshotPath(relative),
      status: before ? "modified" : "added",
      before,
      ...current
    });
  }
  return { format: 1, repository: "git", head, tree, changes };
}

export async function projectSnapshot(root) {
  if (await isGitRepository(root)) return gitSnapshot(root);
  const files = [];
  await walk(root, root, files);
  return { format: 1, repository: "directory", files };
}

export async function projectFingerprint(root) {
  return snapshotFingerprint(await projectSnapshot(root));
}

export async function repositorySnapshot(root) {
  if (await isGitRepository(root)) {
    const result = await runGit(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true });
    const paths = nulRecords(await runGitBuffer(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]));
    const index = new Map();
    for (const record of nulRecords(await runGitBuffer(root, ["ls-files", "-z", "--stage"]))) {
      const tab = record.indexOf(9);
      if (tab < 0) continue;
      const header = record.subarray(0, tab).toString("ascii").match(/^(\d+) ([0-9a-f]+) 0$/);
      if (header) index.set(pathKey(record.subarray(tab + 1)), { mode: header[1], oid: header[2] });
    }
    const files = [];
    for (const relative of paths.sort(Buffer.compare)) {
      if (isRuntimePath(relative)) continue;
      const staged = index.get(pathKey(relative));
      if (staged?.mode === "160000") {
        const submoduleRoot = path.join(root, relative.toString("utf8"));
        const head = await nestedHead(submoduleRoot);
        if (!head) {
          files.push({ path: snapshotPath(relative), status: "present", mode: "160000", type: "commit", oid: staged.oid });
          continue;
        }
        const nested = await gitSnapshot(submoduleRoot);
        files.push({
          path: snapshotPath(relative),
          status: "present",
          mode: "160000",
          type: "commit",
          oid: head,
          ...(nested.changes.length ? { worktree: nested } : {})
        });
        continue;
      }
      const current = await currentFile(root, relative);
      files.push(current
        ? { path: snapshotPath(relative), status: "present", ...current }
        : { path: snapshotPath(relative), status: "deleted" });
    }
    return { format: 1, repository: "full-git", head: result.code === 0 ? result.stdout : null, files };
  }
  const files = [];
  await walk(root, root, files);
  return { format: 1, repository: "full-directory", head: null, files };
}

export async function candidateSnapshot(root, state) {
  return state.type === "project" ? repositorySnapshot(root) : projectSnapshot(root);
}

export async function candidateFingerprint(root, state) {
  return snapshotFingerprint(await candidateSnapshot(root, state));
}

function isWorkflowArtifact(record) {
  const value = record.path;
  if (typeof value !== "string") return false;
  return value === ".agent" || value.startsWith(".agent/");
}

export async function executableSnapshot(root) {
  const snapshot = await projectSnapshot(root);
  return snapshot.repository === "git"
    ? { ...snapshot, changes: snapshot.changes.filter(record => !isWorkflowArtifact(record)) }
    : { ...snapshot, files: snapshot.files.filter(record => !isWorkflowArtifact(record)) };
}

export async function executableFingerprint(root) {
  return snapshotFingerprint(await executableSnapshot(root));
}

export async function artifactSnapshot(root, state) {
  const systemPath = ".agent/SYSTEM.md";
  const sourcePaths = (state.sources || state.projectSources || []).map(source => source.path);
  const paths = state.type === "project"
    ? [state.projectPath || state.designPath, ...sourcePaths, systemPath]
    : [state.projectPath, ...sourcePaths, state.designPath, systemPath].filter(Boolean);
  return {
    format: 2,
    artifacts: await Promise.all(paths.map(relative => {
      const normalized = relative.split(path.sep).join("/");
      return readFile(path.join(root, normalized)).then(content => ({ path: normalized, ...encoded(content) }));
    }))
  };
}

export async function artifactFingerprint(root, state) {
  return snapshotFingerprint(await artifactSnapshot(root, state));
}

const evolvingSections = new Set(["Implementation Conformance", "Reviews", "Status"]);
const evolvingProjectSections = new Set(["Decisions and Hypotheses", "Roadmap", "Requirement Coverage", "Discoveries", "Final Integration", "Reviews", "Status"]);

function stableSections(content, excluded) {
  return content.split(/(?=^## )/m).filter(section => {
    const heading = section.match(/^## (.+)$/m)?.[1];
    return !heading || !excluded.has(heading);
  }).join("");
}

export async function designContractFingerprint(root, state) {
  const design = await readFile(path.join(root, state.designPath), "utf8");
  const sources = await Promise.all((state.sources || state.projectSources || []).map(async source => ({
    path: source.path,
    content: (await readFile(path.join(root, source.path))).toString("base64")
  })));
  if (state.type === "project") {
    return snapshotFingerprint({ format: 3, projectContract: stableSections(design, evolvingProjectSections), sources });
  }
  const projectContract = state.projectPath
    ? stableSections(await readFile(path.join(root, state.projectPath), "utf8"), evolvingProjectSections)
    : null;
  return snapshotFingerprint({ format: 3, projectContract, sources, designContract: stableSections(design, evolvingSections) });
}
