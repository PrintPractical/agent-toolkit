#!/usr/bin/env node
/**
 * manifest-gate.mjs — Read or update a gate on a change manifest.
 *
 * Usage:
 *   node manifest-gate.mjs --id <id> --gate <gate>                   # read gate status
 *   node manifest-gate.mjs --id <id> --gate <gate> --approve         # approve gate
 *   node manifest-gate.mjs --id <id> --gate <gate> --reset           # reset to pending
 *   node manifest-gate.mjs --id <id> --gate refactor --audit-only    # explicit no-execution selection
 *   node manifest-gate.mjs --id <id> --stage <stage>                 # repair stage from approved gates
 *
 * Output (stdout): JSON { id, gate, status } or { id, stage }
 * Progress (stderr): human-readable status
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { parseArgs } from 'util';
import { fileURLToPath } from 'url';
import {
  readManifest,
  writeManifest,
  GATES,
  STAGES,
  nextSkill,
} from './lib/index.mjs';

const { values } = parseArgs({
  options: {
    help:    { type: 'boolean', short: 'h', default: false },
    id:      { type: 'string' },
    gate:    { type: 'string' },
    stage:   { type: 'string' },
    approve: { type: 'boolean', default: false },
    reset:   { type: 'boolean', default: false },
    'audit-only': { type: 'boolean', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log('Usage: manifest-gate.mjs --id <id> --gate <gate> [--approve|--reset|--audit-only]');
  console.log('       manifest-gate.mjs --id <id> --stage <stage>');
  process.exit(0);
}

if (!values.id) {
  console.error('Usage: manifest-gate.mjs --id <id> --gate <gate> [--approve|--reset|--audit-only]');
  console.error('       manifest-gate.mjs --id <id> --stage <stage>');
  process.exit(1);
}

const repoRoot = process.cwd();
let manifest;

try {
  manifest = readManifest(values.id, repoRoot);
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}

function parseRfIds(value, label) {
  let parsed;
  try {
    parsed = JSON.parse(value.startsWith('`') && value.endsWith('`') ? value.slice(1, -1) : value);
  } catch (error) {
    console.error(`${label} must be a JSON array of exact RF IDs: ${error.message}`);
    process.exit(1);
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some(id => typeof id !== 'string' || !/^RF-[A-Za-z0-9._-]+$/.test(id))) {
    console.error(`${label} must be a non-empty JSON array of exact RF IDs`);
    process.exit(1);
  }
  const ids = parsed.map(id => id.trim()).sort();
  if (new Set(ids).size !== ids.length) {
    console.error(`${label} must not contain duplicate RF IDs`);
    process.exit(1);
  }
  return ids;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function selectedOpportunityBlocks(text, selectedIds) {
  const matches = [...text.matchAll(/^###\s+(RF-[A-Za-z0-9._-]+)\b[^\n]*\n/gm)];
  const blocks = new Map();
  for (const [index, match] of matches.entries()) {
    if (blocks.has(match[1])) {
      console.error(`refactor.md contains duplicate opportunity '${match[1]}'`);
      process.exit(1);
    }
    const nextSection = text.slice(match.index + match[0].length).search(/^#{2,3}\s+/m);
    const end = nextSection === -1 ? text.length : match.index + match[0].length + nextSection;
    blocks.set(match[1], text.slice(match.index, end).trim());
  }
  return selectedIds.map(id => {
    const block = blocks.get(id);
    if (!block) {
      console.error(`Selected opportunity '${id}' has no ranked opportunity record`);
      process.exit(1);
    }
    return block;
  });
}

function opportunityContract(block) {
  return block.split('\n')
    .map(line => line.trim())
    .filter(line => line && !/^\*\*(?:Status|Disposition note):\*\*/.test(line))
    .join('\n');
}

function contractDigest(text, changeClass, selectedIds = []) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => changeClass === 'refactor'
    ? /^\*\*(?:Selected IDs|Selection gate):\*\*/.test(line) || /^\|\s*B-[A-Za-z0-9._-]+\s*\|/.test(line) || /^###\s+B-[A-Za-z0-9._-]+\b/.test(line)
    : /^>\s*\*\*(?:Checkpoint unit|Editable files|Locked test files|Baseline command|Final command):\*\*/.test(line));
  if (lines.length === 0) {
    console.error('Source artifact contains no machine-readable implementation contract');
    process.exit(1);
  }
  const opportunities = changeClass === 'refactor' ? selectedOpportunityBlocks(text, selectedIds).map(opportunityContract) : [];
  return digest([...opportunities, ...lines].join('\n'));
}

function repositoryState() {
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  const listed = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  if (head.status !== 0 || listed.status !== 0 || untracked.status !== 0) {
    console.error('Audit-only closure requires an initialized Git repository with a valid HEAD');
    process.exit(1);
  }
  const files = {};
  for (const relative of listed.stdout.split('\0').filter(Boolean).sort()) {
    if (relative.startsWith('.changes/')) continue;
    const absolute = path.join(repoRoot, relative);
    let stat;
    try { stat = fs.lstatSync(absolute); } catch (error) { if (error.code === 'ENOENT') continue; else throw error; }
    const content = stat.isSymbolicLink() ? Buffer.from(fs.readlinkSync(absolute)) : fs.readFileSync(absolute);
    files[relative] = digest(Buffer.concat([Buffer.from(`${stat.mode & 0o7777}\0`), content]));
  }
  return { head: head.stdout.trim(), files, untracked: untracked.stdout.split('\0').filter(Boolean).sort() };
}

function gitChangedPaths(args, label) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`${label} is unavailable; audit-only verification fails closed`);
    process.exit(1);
  }
  return result.stdout.split('\0').filter(Boolean).sort();
}

function writeAuditBaseline() {
  const file = path.join(repoRoot, '.changes', 'active', values.id, 'audit-only-baseline.json');
  fs.writeFileSync(file, `${JSON.stringify(repositoryState(), null, 2)}\n`);
  return file;
}

function archiveAuditBaseline() {
  const active = path.join(repoRoot, '.changes', 'active', values.id);
  const file = path.join(active, 'audit-only-baseline.json');
  if (!fs.existsSync(file)) return;
  const history = path.join(active, 'checkpoint-history');
  fs.mkdirSync(history, { recursive: true });
  fs.renameSync(file, path.join(history, `audit-only-epoch-${manifest.checkpoint_epoch ?? 0}-${Date.now()}.json`));
}

function validateAuditBaseline() {
  const file = path.join(repoRoot, '.changes', 'active', values.id, 'audit-only-baseline.json');
  if (!fs.existsSync(file)) {
    console.error('Audit-only repository baseline is missing');
    process.exit(1);
  }
  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  const after = repositoryState();
  const allowed = new Set(manifest.context_targets || []);
  const indexDivergence = gitChangedPaths(['diff', '--name-only', '-z'], 'Git index comparison');
  if (indexDivergence.length > 0) {
    console.error(`Audit-only docs approval found index/worktree divergence: ${indexDivergence.join(', ')}`);
    process.exit(1);
  }
  const baselineUntracked = new Set(before.untracked || []);
  const changedUntrackedContext = (after.untracked || []).filter(item =>
    allowed.has(item) && (!baselineUntracked.has(item) || before.files[item] !== after.files[item]));
  if (changedUntrackedContext.length > 0) {
    console.error(`Audit-only docs approval found untracked context targets without matching index content: ${changedUntrackedContext.join(', ')}`);
    process.exit(1);
  }
  const committed = gitChangedPaths(['diff', '--name-only', '-z', `${before.head}..${after.head}`], 'Audit baseline HEAD comparison');
  const forbiddenCommitted = committed.filter(item => !allowed.has(item));
  if (forbiddenCommitted.length > 0) {
    console.error(`Audit-only docs approval found non-context committed changes: ${forbiddenCommitted.join(', ')}`);
    process.exit(1);
  }
  const changed = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  const forbidden = [...changed].filter(item => !allowed.has(item) && before.files[item] !== after.files[item]);
  if (forbidden.length > 0) {
    console.error(`Audit-only docs approval found non-context changes: ${forbidden.sort().join(', ')}`);
    process.exit(1);
  }
}

function refactorExecutionEvidence() {
  const artifact = path.join(repoRoot, '.changes', 'active', values.id, manifest.artifacts?.refactor || 'refactor.md');
  if (!fs.existsSync(artifact)) {
    console.error(`Cannot approve refactor execution without ${artifact}`);
    process.exit(1);
  }
  const text = fs.readFileSync(artifact, 'utf8');
  const response = text.match(/^\*\*User response \(verbatim\):\*\*\s*(.+)$/m)?.[1]?.trim();
  const selectedText = text.match(/^\*\*Selected IDs:\*\*\s*(.+)$/m)?.[1]?.trim();
  if (!/^\*\*Selection gate:\*\*\s*approved-for-exact-IDs\s*$/m.test(text) ||
      !response || /\{\{|exact response/i.test(response) || !selectedText) {
    console.error('refactor.md must record the verbatim response, exact selected RF IDs, and the approved execution selection gate');
    process.exit(1);
  }
  const selectedIds = parseRfIds(selectedText, 'refactor.md Selected IDs');
  const roles = text.match(/## Audit roles([\s\S]*?)## Ranked opportunities/)?.[1] || '';
  if (!/^\*\*Read-only audit confirmed:\*\*\s*yes\b/im.test(text) ||
      !/^\*\*Pre-selection non-artifact edits:\*\*\s*none\s*$/im.test(text) ||
      !roles || /pending|\{\{/i.test(roles)) {
    console.error('refactor.md must contain completed read-only audit evidence before execution approval');
    process.exit(1);
  }
  const opportunityBlocks = selectedOpportunityBlocks(text, selectedIds);
  for (const [index, block] of opportunityBlocks.entries()) {
    const id = selectedIds[index];
    const required = ['Rank', 'Scope', 'Evidence', 'Payoff', 'Behavior-preservation argument', 'Current coverage', 'Proposed files', 'Verification', 'Disposition note'];
    if (!/^\*\*Status:\*\*\s*selected\s*$/m.test(block) || !/^\*\*Observable invariants:\*\*[\s\S]*?^\s*-\s+\S/m.test(block) ||
        required.some(label => !new RegExp(`^\\*\\*${label}:\\*\\*\\s*\\S`, 'm').test(block)) || /\{\{/i.test(block)) {
      console.error(`Selected opportunity '${id}' must be a complete ranked record with status selected and observable invariants`);
      process.exit(1);
    }
    if (!new RegExp(`(^|[^A-Za-z0-9._-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9._-]|$)`).test(response)) {
      console.error(`Verbatim user response must explicitly include selected opportunity '${id}'`);
      process.exit(1);
    }
  }
  const headings = [...text.matchAll(/^###\s+(B-[A-Za-z0-9._-]+)\b/gm)].map(match => match[1]).sort();
  const tableRows = text.split('\n').filter(line => /^\|\s*B-[A-Za-z0-9._-]+\s*\|/.test(line));
  const tableIds = [];
  const assignedIds = [];
  for (const row of tableRows) {
    const columns = row.split('|').slice(1, -1).map(item => item.trim());
    if (columns.length < 6) {
      console.error('refactor.md implementation-unit table must include selected IDs, files, locks, and commands');
      process.exit(1);
    }
    tableIds.push(columns[0]);
    assignedIds.push(...parseRfIds(columns[1], `Refactor unit '${columns[0]}' selected IDs`));
  }
  tableIds.sort();
  assignedIds.sort();
  if (headings.length === 0 || JSON.stringify(headings) !== JSON.stringify(tableIds) || new Set(tableIds).size !== tableIds.length) {
    console.error('refactor.md batch headings must exactly match its unique implementation-unit table rows');
    process.exit(1);
  }
  if (new Set(assignedIds).size !== assignedIds.length || JSON.stringify(assignedIds) !== JSON.stringify(selectedIds)) {
    console.error('refactor.md implementation units must assign every selected RF ID exactly once and no others');
    process.exit(1);
  }
  return selectedIds;
}

function stageImpliedByGates(value) {
  const gates = value.gates || {};
  if (value.class === 'epic') {
    return gates.architect === 'approved' ? 'specify' : 'architect';
  }
  if (value.class === 'refactor') {
    if (gates.docs === 'approved') return 'done';
    return gates.refactor === 'approved' && value.refactor_mode === 'execute' ? 'implement' : 'refactor';
  }
  if (gates.docs === 'approved') return 'done';
  if (gates.plan === 'approved') return 'implement';
  if (gates.specify === 'approved') return 'plan';
  if (gates.architect === 'approved') return 'specify';
  return 'architect';
}

// Stage repair mode. A stage may only be restored to the value implied by
// approved gates; it cannot be used to bypass the lifecycle.
if (values.stage) {
  if (!STAGES.includes(values.stage)) {
    console.error(`Invalid stage: ${values.stage}. Must be one of: ${STAGES.join(', ')}`);
    process.exit(1);
  }
  const impliedStage = stageImpliedByGates(manifest);
  if (values.stage !== impliedStage) {
    console.error(`Cannot set stage to '${values.stage}'; approved gates imply '${impliedStage}'`);
    process.exit(1);
  }
  manifest.stage = values.stage;
  writeManifest(values.id, manifest, repoRoot);
  console.error(`Stage set to '${values.stage}' for change '${values.id}'`);
  const skill = nextSkill(manifest);
  if (skill) console.error(`Next skill: ${skill}`);
  process.stdout.write(JSON.stringify({ id: values.id, stage: values.stage }) + '\n');
  process.exit(0);
}

// Gate read/update mode
if (!values.gate) {
  console.error('Specify --gate <gate> or --stage <stage>');
  process.exit(1);
}

if (!GATES.includes(values.gate)) {
  console.error(`Invalid gate: ${values.gate}. Must be one of: ${GATES.join(', ')}`);
  process.exit(1);
}

const allowedGates = manifest.class === 'epic'
  ? ['architect', 'specify']
  : manifest.class === 'refactor'
    ? ['refactor', 'implement', 'docs']
    : ['architect', 'specify', 'plan', 'implement', 'docs'];
if (!allowedGates.includes(values.gate)) {
  console.error(`Gate '${values.gate}' is not valid for class '${manifest.class}'`);
  process.exit(1);
}

const updateActions = [values.approve, values.reset, values['audit-only']].filter(Boolean).length;
if (updateActions > 1) {
  console.error('Use only one of --approve, --reset, or --audit-only');
  process.exit(1);
}

if (values['audit-only']) {
  if (manifest.class !== 'refactor' || values.gate !== 'refactor' || manifest.stage !== 'refactor') {
    console.error('--audit-only is valid only for the refactor gate at the refactor stage');
    process.exit(1);
  }
  if (manifest.gates?.refactor === 'approved' || manifest.refactor_mode || fs.existsSync(path.join(repoRoot, '.changes', 'active', values.id, 'audit-only-baseline.json'))) {
    console.error('Audit-only selection is already recorded; reset the refactor gate before recording a new selection');
    process.exit(1);
  }
  const artifact = path.join(repoRoot, '.changes', 'active', values.id, manifest.artifacts?.refactor || 'refactor.md');
  if (!fs.existsSync(artifact)) {
    console.error(`Cannot record audit-only selection without ${artifact}`);
    process.exit(1);
  }
  const text = fs.readFileSync(artifact, 'utf8');
  const response = text.match(/^\*\*User response \(verbatim\):\*\*\s*(.+)$/m)?.[1]?.trim();
  const roles = text.match(/## Audit roles([\s\S]*?)## Ranked opportunities/)?.[1] || '';
  const hasAudit = /^###\s+RF-[A-Za-z0-9._-]+\b/m.test(text) || /^\*\*Audit conclusion:\*\*\s*no-actionable-opportunities\s*$/m.test(text);
  if (!/^\*\*Selection gate:\*\*\s*audit-only\s*$/m.test(text) || !/^\*\*Selected IDs:\*\*\s*audit-only\s*$/m.test(text) ||
      !/^\*\*Read-only audit confirmed:\*\*\s*yes\b/im.test(text) || !/^\*\*Pre-selection non-artifact edits:\*\*\s*none\s*$/im.test(text) ||
      !response || /\{\{|exact response/i.test(response) || !hasAudit || /pending|\{\{/i.test(roles)) {
    console.error('refactor.md must contain a completed read-only audit and explicit audit-only selection evidence');
    process.exit(1);
  }
  writeAuditBaseline();
  manifest.gates = manifest.gates || {};
  manifest.gates.refactor = 'approved';
  manifest.refactor_mode = 'audit-only';
  writeManifest(values.id, manifest, repoRoot);
  console.error(`Audit-only refactor selection recorded for change '${values.id}'`);
  process.stdout.write(JSON.stringify({ id: values.id, gate: 'refactor', status: 'approved', mode: 'audit-only' }) + '\n');
  process.exit(0);
}

const currentStatus = manifest.gates?.[values.gate] ?? 'pending';

if (values.approve) {
  const expectedStage = values.gate === 'docs' ? 'implement' : values.gate;
  const auditOnlyDocs = manifest.class === 'refactor' && values.gate === 'docs' &&
    manifest.stage === 'refactor' && manifest.refactor_mode === 'audit-only' && manifest.gates?.refactor === 'approved';
  if (manifest.stage !== expectedStage && !auditOnlyDocs) {
    console.error(`Cannot approve gate '${values.gate}' while stage is '${manifest.stage}' (expected '${expectedStage}')`);
    process.exit(1);
  }

  if (manifest.class === 'refactor' && values.gate === 'refactor') {
    manifest.refactor_selected_ids = refactorExecutionEvidence();
    const artifact = path.join(repoRoot, '.changes', 'active', values.id, manifest.artifacts?.refactor || 'refactor.md');
    manifest.implementation_contract_digest = contractDigest(fs.readFileSync(artifact, 'utf8'), 'refactor', manifest.refactor_selected_ids);
  }

  if (values.gate === 'plan') {
    const artifact = path.join(repoRoot, '.changes', 'active', values.id, manifest.artifacts?.plan || 'plan.md');
    if (!fs.existsSync(artifact)) {
      console.error(`Cannot approve plan gate without ${artifact}`);
      process.exit(1);
    }
    manifest.implementation_contract_digest = contractDigest(fs.readFileSync(artifact, 'utf8'), manifest.class);
  }

  if (values.gate === 'specify') {
    const unresolvedKickbacks = (manifest.kickbacks || []).filter(kickback =>
      typeof kickback.resolution !== 'string' || kickback.resolution.trim() === ''
    );
    if (unresolvedKickbacks.length > 0) {
      console.error(`Cannot approve specify gate with ${unresolvedKickbacks.length} unresolved kickback(s)`);
      process.exit(1);
    }
  }

  if (values.gate === 'docs' && !auditOnlyDocs && manifest.gates?.implement !== 'approved') {
    console.error(`Cannot approve docs gate before the implement gate`);
    process.exit(1);
  }

  if (values.gate === 'docs') {
    if (auditOnlyDocs) validateAuditBaseline();
    else {
      const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'implementation-checkpoint.mjs');
      const check = spawnSync(process.execPath, [script, '--id', values.id, '--check-all', '--allow-docs'], { cwd: repoRoot, encoding: 'utf8' });
      if (check.status !== 0) {
        if (check.stdout) process.stderr.write(check.stdout);
        if (check.stderr) process.stderr.write(check.stderr);
        console.error('Cannot approve docs gate after implementation checkpoint evidence became stale');
        process.exit(1);
      }
    }
  }

  if (values.gate === 'implement') {
    const prerequisiteReady = manifest.class === 'refactor'
      ? manifest.gates?.refactor === 'approved' && manifest.refactor_mode === 'execute'
      : manifest.gates?.plan === 'approved';
    if (!prerequisiteReady) {
      console.error(`Cannot approve implement gate before its upstream authorization gate`);
      process.exit(1);
    }
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'implementation-checkpoint.mjs');
    const check = spawnSync(process.execPath, [script, '--id', values.id, '--check-all'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (check.status !== 0) {
      if (check.stdout) process.stderr.write(check.stdout);
      if (check.stderr) process.stderr.write(check.stderr);
      console.error(`Cannot approve implement gate until every implementation unit is verified and current`);
      process.exit(1);
    }
  }

  manifest.gates = manifest.gates || {};
  manifest.gates[values.gate] = 'approved';
  if (manifest.class === 'refactor' && values.gate === 'refactor') manifest.refactor_mode = 'execute';

  // Auto-advance stage when a gate is approved.
  // Epics follow a different progression: architect → specify → (decompose) → done
  // They never advance to plan or implement.
  const isEpic = manifest.class === 'epic';

  const gateToStageMap = isEpic
    ? {
        architect: 'specify',
        specify:   'specify', // epics stay at specify until decomposed; epic-split drives done
        docs:      'done',
      }
    : manifest.class === 'refactor'
      ? {
          refactor:  'implement',
          implement: 'implement',
          docs:      'done',
        }
      : {
        architect: 'specify',
        specify:   'plan',
        plan:      'implement',
        implement: 'implement', // stays implement until docs also approved
        docs:      'done',
      };

  if (values.gate === 'docs') {
    manifest.stage = 'done';
  } else if (gateToStageMap[values.gate]) {
    // Only advance if currently at the expected stage
    if (manifest.stage === values.gate) {
      manifest.stage = gateToStageMap[values.gate];
    }
  }

  // For epics: after specify is approved, prompt the user to decompose
  if (isEpic && values.gate === 'specify') {
    const children = manifest.children || [];
    if (children.length === 0) {
      console.error(`\nEpic specify gate approved.`);
      console.error(`Next: run epic-split to create child change manifests:`);
      console.error(`  node packages/build/epic-split.mjs --epic ${values.id} --children '[...]'`);
      console.error(`  (architect will generate the children JSON from the architecture + decisions)`);
    } else {
      console.error(`\nEpic specify gate approved. ${children.length} child change(s) already exist.`);
      console.error(`Run 'architect' on each child to begin implementation:`);
      children.forEach(c => console.error(`  node packages/build/change-status.mjs --id ${c}`));
    }
  }

  writeManifest(values.id, manifest, repoRoot);
  console.error(`Gate '${values.gate}' approved for change '${values.id}'`);
  const skill = nextSkill(manifest);
  if (skill) console.error(`Next skill: ${skill}`);

  process.stdout.write(JSON.stringify({ id: values.id, gate: values.gate, status: 'approved' }) + '\n');

} else if (values.reset) {
  manifest.gates = manifest.gates || {};
  if (manifest.class === 'refactor') {
    if (values.gate === 'refactor') {
      archiveAuditBaseline();
      manifest.gates.refactor = 'pending';
      manifest.gates.implement = 'pending';
      manifest.gates.docs = 'pending';
      manifest.stage = 'refactor';
      manifest.checkpoint_epoch = (Number.isInteger(manifest.checkpoint_epoch) ? manifest.checkpoint_epoch : 0) + 1;
      delete manifest.refactor_mode;
      delete manifest.refactor_selected_ids;
      delete manifest.implementation_contract_digest;
    } else if (values.gate === 'implement') {
      manifest.gates.implement = 'pending';
      manifest.gates.docs = 'pending';
      manifest.stage = 'implement';
    } else {
      manifest.gates.docs = 'pending';
      manifest.stage = manifest.refactor_mode === 'audit-only' ? 'refactor' : 'implement';
    }
  } else if (manifest.class === 'epic') {
    if (values.gate === 'architect') {
      manifest.gates.architect = 'pending';
      manifest.gates.specify = 'pending';
      manifest.stage = 'architect';
    } else {
      manifest.gates.specify = 'pending';
      manifest.stage = 'specify';
    }
  } else {
    const order = ['architect', 'specify', 'plan', 'implement', 'docs'];
    const resetIndex = order.indexOf(values.gate);
    for (const gate of order.slice(resetIndex)) manifest.gates[gate] = 'pending';
    manifest.stage = values.gate === 'docs' ? 'implement' : values.gate;
    if (resetIndex <= order.indexOf('plan')) {
      manifest.checkpoint_epoch = (Number.isInteger(manifest.checkpoint_epoch) ? manifest.checkpoint_epoch : 0) + 1;
      delete manifest.implementation_contract_digest;
    }
  }
  writeManifest(values.id, manifest, repoRoot);
  console.error(`Gate '${values.gate}' reset to pending for change '${values.id}'`);
  process.stdout.write(JSON.stringify({ id: values.id, gate: values.gate, status: 'pending' }) + '\n');

} else {
  // Read-only
  console.error(`Gate '${values.gate}' for change '${values.id}': ${currentStatus}`);
  process.stdout.write(JSON.stringify({ id: values.id, gate: values.gate, status: currentStatus }) + '\n');
}
