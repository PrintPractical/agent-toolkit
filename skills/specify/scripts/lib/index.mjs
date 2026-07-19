#!/usr/bin/env node
/**
 * Shared utilities for agent-toolkit scripts.
 * Import with: import { readManifest, writeManifest, ... } from '../../../packages/lib/index.mjs'
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// ── YAML minimal parser/serializer ───────────────────────────────────────────
// We keep a small bespoke implementation to avoid runtime npm dependencies.
// Supports: scalars, block sequences, block mappings, inline strings, comments.

/**
 * Parse the manifest YAML. Returns a plain JS object.
 * Only handles the subset used by manifest.yaml (scalars + simple maps/sequences).
 */
export function parseYaml(text) {
  // Strip full-line comments
  const lines = text.split('\n').map(l => l.replace(/^\s*#.*$/, ''));
  return parseBlock(lines, 0, 0).value;
}

function parseBlock(lines, startIdx, baseIndent) {
  const result = {};
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) { i++; continue; } // blank or comment-stripped

    const indent = trimmed.length - trimmed.trimStart().length;
    if (indent < baseIndent) break; // back to parent

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) { i++; continue; }

    const key = trimmed.slice(0, colonIdx).trim();
    const rest = trimmed.slice(colonIdx + 1).trim();

    if (rest === '' || rest.startsWith('#')) {
      // block value on next line(s)
      const nextIndent = findNextIndent(lines, i + 1);
      if (nextIndent > indent) {
        const { value, endIdx } = isSequence(lines, i + 1, nextIndent)
          ? parseSequence(lines, i + 1, nextIndent)
          : parseBlock(lines, i + 1, nextIndent);
        result[key] = value;
        i = endIdx;
      } else {
        result[key] = null;
        i++;
      }
    } else if (rest.startsWith('- ')) {
      // inline sequence (rare in our format)
      result[key] = [rest.slice(2).replace(/^['"]|['"]$/g, '')];
      i++;
    } else {
      result[key] = parseScalar(rest);
      i++;
    }
  }

  return { value: result, endIdx: i };
}

function parseSequence(lines, startIdx, baseIndent) {
  const items = [];
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) { i++; continue; }
    const indent = trimmed.length - trimmed.trimStart().length;
    if (indent < baseIndent) break;

    const item = trimmed.trimStart();
    if (item.startsWith('- ')) {
      const val = item.slice(2).trim();
      if (val === '' || val.startsWith('#')) {
        // block mapping as list item
        const nextIndent = findNextIndent(lines, i + 1);
        if (nextIndent > indent) {
          const { value, endIdx } = parseBlock(lines, i + 1, nextIndent);
          items.push(value);
          i = endIdx;
        } else {
          items.push(null);
          i++;
        }
      } else if (val.includes(':')) {
        // single-line mapping as list item
        const obj = {};
        val.split(',').forEach(pair => {
          const [k, v] = pair.split(':').map(s => s.trim());
          if (k) obj[k] = parseScalar(v || '');
        });
        items.push(parseScalar(val));
        i++;
      } else {
        items.push(parseScalar(val));
        i++;
      }
    } else {
      break;
    }
  }
  return { value: items, endIdx: i };
}

function isSequence(lines, startIdx, indent) {
  for (let i = startIdx; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (!t.trim()) continue;
    const ind = t.length - t.trimStart().length;
    if (ind < indent) return false;
    return t.trimStart().startsWith('- ');
  }
  return false;
}

function findNextIndent(lines, from) {
  for (let i = from; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (!t.trim()) continue;
    return t.length - t.trimStart().length;
  }
  return -1;
}

function parseScalar(s) {
  const t = s.replace(/#.*$/, '').trim();
  if (t === '' || t === 'null' || t === '~') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === '[]') return [];
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t.replace(/^['"]|['"]$/g, '');
}

/**
 * Minimal YAML serializer for manifest.yaml structure.
 * Produces human-readable YAML for the manifest shape.
 */
export function stringifyYaml(obj, indent = 0) {
  const pad = ' '.repeat(indent);
  const lines = [];

  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      lines.push(`${pad}${k}: null`);
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${pad}${k}:`);
      lines.push(stringifyYaml(v, indent + 2));
    } else if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${pad}${k}: []`);
      } else {
        lines.push(`${pad}${k}:`);
        for (const item of v) {
          if (typeof item === 'object' && item !== null) {
            const entries = Object.entries(item);
            const first = entries[0];
            lines.push(`${pad}  - ${first[0]}: ${serializeScalar(first[1])}`);
            for (const [ik, iv] of entries.slice(1)) {
              lines.push(`${pad}    ${ik}: ${serializeScalar(iv)}`);
            }
          } else {
            lines.push(`${pad}  - ${serializeScalar(item)}`);
          }
        }
      }
    } else {
      lines.push(`${pad}${k}: ${serializeScalar(v)}`);
    }
  }
  return lines.join('\n');
}

function serializeScalar(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  if (typeof v === 'string' && (v.includes(':') || v.includes('#') || v.includes('"'))) {
    return `"${v.replace(/"/g, '\\"')}"`;
  }
  return String(v);
}

// ── Manifest I/O ─────────────────────────────────────────────────────────────

/**
 * Find the active changes directory relative to cwd or a provided root.
 */
export function changesDir(repoRoot = process.cwd()) {
  return path.join(repoRoot, '.changes');
}

export function activeDir(repoRoot = process.cwd()) {
  return path.join(changesDir(repoRoot), 'active');
}

export function archiveDir(repoRoot = process.cwd()) {
  return path.join(changesDir(repoRoot), 'archive');
}

export function changeDir(id, repoRoot = process.cwd()) {
  return path.join(activeDir(repoRoot), id);
}

export function manifestPath(id, repoRoot = process.cwd()) {
  return path.join(changeDir(id, repoRoot), 'manifest.yaml');
}

/**
 * Read and parse a manifest. Throws if not found.
 */
export function readManifest(id, repoRoot = process.cwd()) {
  const mp = manifestPath(id, repoRoot);
  if (!fs.existsSync(mp)) {
    throw new Error(`Manifest not found: ${mp}`);
  }
  return parseYaml(fs.readFileSync(mp, 'utf8'));
}

/**
 * Write a manifest object back to disk.
 */
export function writeManifest(id, manifest, repoRoot = process.cwd()) {
  const mp = manifestPath(id, repoRoot);
  fs.mkdirSync(path.dirname(mp), { recursive: true });
  fs.writeFileSync(mp, stringifyYaml(manifest) + '\n', 'utf8');
}

/**
 * List all active change IDs.
 */
export function listActiveChanges(repoRoot = process.cwd()) {
  const dir = activeDir(repoRoot);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => {
    return fs.statSync(path.join(dir, name)).isDirectory();
  });
}

// ── Git utilities ─────────────────────────────────────────────────────────────

/**
 * Get the current HEAD SHA. Returns null if not in a git repo.
 */
export function getHeadSha(repoRoot = process.cwd()) {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] })
      .toString().trim();
  } catch {
    return null;
  }
}

/**
 * Get files changed since a given SHA in a given directory.
 * Returns an array of relative file paths.
 */
export function getChangedFilesSince(sha, dirPath, repoRoot = process.cwd()) {
  if (!sha) return [];
  try {
    const result = execSync(
      `git diff --name-only "${sha}"..HEAD -- "${dirPath}"`,
      { cwd: repoRoot, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();
    return result ? result.split('\n') : [];
  } catch {
    return [];
  }
}

// ── ID generation ─────────────────────────────────────────────────────────────

/**
 * Generate a change ID from a title.
 * Format: YYYY-MM-DD-<kebab-slug>
 */
export function generateChangeId(title, repoRoot = process.cwd()) {
  const date = new Date().toISOString().slice(0, 10);
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40)
    .replace(/-$/, '');

  let id = `${date}-${slug}`;
  const dir = activeDir(repoRoot);

  // Collision avoidance
  if (fs.existsSync(path.join(dir, id))) {
    let n = 2;
    while (fs.existsSync(path.join(dir, `${id}-${n}`))) n++;
    id = `${id}-${n}`;
  }

  return id;
}

// ── Stage ordering ─────────────────────────────────────────────────────────────

export const STAGES = ['architect', 'specify', 'plan', 'implement', 'done'];
export const GATES  = ['architect', 'specify', 'plan', 'implement', 'docs'];

export function stageIndex(stage) {
  return STAGES.indexOf(stage);
}

export function nextSkill(manifest) {
  const stage = manifest.stage;
  const gates = manifest.gates || {};

  if (stage === 'done') return null;

  // Epics: architect → specify → decompose → done (no plan/implement)
  if (manifest.class === 'epic') {
    return epicNextAction(manifest);
  }

  if (stage === 'architect' && gates.architect !== 'approved') return 'architect';
  if (stage === 'architect' && gates.architect === 'approved') return 'specify';
  if (stage === 'specify'   && gates.specify !== 'approved')  return 'specify';
  if (stage === 'specify'   && gates.specify === 'approved')  return 'plan';
  if (stage === 'plan'      && gates.plan !== 'approved')     return 'plan';
  if (stage === 'plan'      && gates.plan === 'approved')     return 'implement';
  if (stage === 'implement' && gates.implement !== 'approved') return 'implement';
  if (stage === 'implement' && gates.implement === 'approved' && gates.docs !== 'approved') return 'implement (docs reconciliation)';
  return null;
}

// ── Epic helpers ──────────────────────────────────────────────────────────────

/**
 * Epic stage progression:
 *   architect → specify → decompose (epic-split) → done
 *
 * Epics never run plan or implement. They plan; their children implement.
 */
export function epicNextAction(manifest) {
  const gates  = manifest.gates  || {};
  const stage  = manifest.stage  || 'architect';
  const children = manifest.children || [];

  if (stage === 'done') return null;

  // architect gate
  if (gates.architect !== 'approved') return 'architect (identify children + overall design)';

  // specify gate — cross-cutting contracts
  if (stage === 'architect' || stage === 'specify') {
    if (gates.specify !== 'approved') return 'specify (cross-cutting contracts)';
  }

  // decompose — create child manifests from the approved arch+decisions
  if (gates.specify === 'approved' && children.length === 0) {
    return 'epic-split (decompose into child changes)';
  }

  // children exist — track their progress
  if (children.length > 0 && gates.specify === 'approved') {
    return null; // children drive completion; use change-status to track
  }

  return null;
}

/**
 * Compute epic completion status from child manifests.
 * Returns { total, done, inProgress, pending, byStage }
 */
export function epicStatus(epicManifest, repoRoot = process.cwd()) {
  const children = epicManifest.children || [];
  const result = {
    total: children.length,
    done: 0,
    inProgress: 0,
    pending: 0,
    byStage: {},
  };

  for (const childId of children) {
    let child;
    try {
      child = readManifest(childId, repoRoot);
    } catch {
      // Child may be archived
      result.done++;
      result.byStage['archived'] = (result.byStage['archived'] || 0) + 1;
      continue;
    }
    const stage = child.stage || 'architect';
    result.byStage[stage] = (result.byStage[stage] || 0) + 1;
    if (stage === 'done') result.done++;
    else if (stage === 'architect') result.pending++;
    else result.inProgress++;
  }

  return result;
}

/**
 * Add a child change ID to an epic manifest's children list.
 * Updates the epic manifest on disk.
 */
export function addChildToEpic(epicId, childId, repoRoot = process.cwd()) {
  const epic = readManifest(epicId, repoRoot);
  if (epic.class !== 'epic') {
    throw new Error(`Change '${epicId}' is not an epic (class: ${epic.class})`);
  }
  epic.children = epic.children || [];
  if (!epic.children.includes(childId)) {
    epic.children.push(childId);
    writeManifest(epicId, epic, repoRoot);
  }
  return epic;
}
