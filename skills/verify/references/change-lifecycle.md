# Change Lifecycle

This document describes how a change moves from idea to merged code, what artifacts are created, and what happens to them.

## Overview

```
Optional discovery for unformed ideas:
brainstorm → optional architect-seed.md → architect

Entry ramp (map | reforge | triage | architect)
    ↓
.changes/active/<id>/ created with manifest.yaml
    ↓
architect gate approved
    ↓
specify  → decisions.md, reconcile architecture.md
    ↓
specify gate approved
    ↓
plan     → plan.md (live checklist)
    ↓
plan gate approved
    ↓
implement → per section: code green → independent review → cleanup → tests → fresh verification
    ↓
implement gate approved
    ↓
docs reconciliation → CONTEXT hierarchy updated + verified
    ↓
docs gate approved (user confirms happy)
    ↓
change-archive.mjs → .changes/archive/<id>.zip, active dir removed
    ↓
done
```

## Active workspace

While a change is in progress, all artifacts live at:

```
.changes/active/<id>/
  manifest.yaml
  architecture.md    (created by architect)
  decisions.md       (created by specify)
  plan.md            (created by plan, updated live by implement)
  implementation-units.json
  implementation-state.json
  reviews/           (snapshot-bound initial and final review reports)
```

`<id>` format: `YYYY-MM-DD-<kebab-slug>`.

## Implementation checkpoints

Every standard or triage implementation unit moves one transition at a time:

```
building → green → reviewed → refactoring → tested → verified
```

`implementation-checkpoint.mjs` runs baseline/final commands, hashes declared files and locked tests, accepts structured read-only reviews only for the current snapshot, and invalidates stale evidence after edits. The implement gate runs `--check-all` and cannot be approved until every expected unit is verified and current. A no-op cleanup is valid only with substantive review evidence and a concrete no-change rationale.

Manifest-backed workflows use exactly `.changes/active/<id>/implementation-units.json`, never inline JSON or an alternate path. Every declaration requires `id`, exact `files`, `lockedTestFiles`, exact `baselineCommand`, and exact `finalCommand`; a path may be shared across units (e.g., a central file modified per section). A file cannot be both editable and locked across units. Standard and triage `plan.md` files carry exact JSON path arrays and commands in addition to unit IDs; all values must match the declarations. Refactor tables and headings match the units and assign every approved RF ID exactly once. The upstream gate stores a normalized digest of this machine-readable contract.

Checkpoint state binds the current integer `manifest.checkpoint_epoch`, the gate-approved contract digest, initialization HEAD/worktree, and canonical declaration digest. Manifest-backed workflows require Git with a valid HEAD. It rejects index/worktree divergence, undeclared worktree or committed-tree changes, and edits to another unit outside its cycle. Resetting an upstream authorization gate or logging a kickback cascades all downstream gates and increments the epoch. Review IDs cannot be reused across units, but identity remains self-declared, so the orchestrator still guarantees real reviewer/producer separation. Kickback findings cannot be marked resolved inside a review report.

Firm-seam and cycle-locked tests cannot change between the first green baseline and verification. Once a cycle lock is green, its baseline is immutable for that epoch: restore a changed lock or kick back, but never rebaseline the changed test.

## Refactor maintenance branch

Behavior-preserving maintenance uses `class: refactor` rather than the spec spine:

```
refactor audit → ranked refactor.md → exact user selection → refactor gate
  → characterized checkpointed batches → implement gate
  → docs reconciliation → docs gate → archive
```

Its active workspace uses `refactor.md`, `implementation-units.json`, `implementation-state.json`, and `reviews/`. Audit is read-only outside the active artifact. No source, config, docs, snapshot, or test edit occurs before exact selection and refactor-gate approval. Exact selected IDs use `manifest-gate.mjs --gate refactor --approve`; every ID must name a complete ranked opportunity marked selected and explicitly appear in the verbatim response, and its full meaning plus batch contract is digest-bound at the gate. A verbatim audit-only selection must instead be recorded once with `manifest-gate.mjs --gate refactor --audit-only`, followed by the docs gate; it never authorizes implementation or baseline replacement. Relevant red baseline tests block execution. Missing safety coverage is added afterward as characterization tests and cycle-locked. Behavior or firm-contract changes leave this branch as architect candidates.

**Important:** The `.changes/active/` directory is tracked by git and IS visible to agents. This is intentional — agents need to read the spec artifacts while working. Archive prevents context bloat for *closed* changes.

## Archive

When a change reaches `done` (docs gate approved, user confirms happy), `change-archive.mjs` runs:
1. Zips `.changes/active/<id>/` to `.changes/archive/<id>.zip`.
2. Removes `.changes/active/<id>/`.
3. Commits the zip (or leaves it for the user to commit — configurable).

Archived zips are **not readable by agents** without explicit unzipping. This is intentional: completed change rationale should live in CONTEXT.md (current state), not in raw session logs agents can drift-anchor on.

Humans can unzip any archive to understand historical context.

## Kickback handling

When `implement` discovers a gap the spec didn't anticipate:
1. Stop immediately. Do not improvise.
2. Run `kickback-log.mjs` — appends an unresolved entry to `manifest.yaml`, increments integer `checkpoint_epoch`, sets `stage` to `specify`, and resets `specify`, `plan`, `implement`, and `docs` to `pending`.
3. Run a targeted `specify` amendment session covering only the gap.
4. `specify` updates `decisions.md`, reconciles `architecture.md` if needed, and records the actual resolution in the kickback entry.
5. The user re-approves the `specify` gate, which advances the stage to `plan`.
6. `plan` amends `plan.md` to cover the new decisions without discarding completed checklist items.
7. The user re-approves the `plan` gate, which advances the stage to `implement`.
8. Update the canonical `.changes/active/<id>/implementation-units.json` and all `Checkpoint unit` markers to match the amended plan.
9. Reset checkpoint state with `implementation-checkpoint.mjs --id <id> --reset --units .changes/active/<id>/implementation-units.json`. The script archives prior state and reviews, then initializes amended state bound to the new epoch and declaration digest.
10. `implement` resumes from the amended checkpoints. A changed cycle lock from the prior epoch still requires the approved kickback; it is never silently rebaselined.

Kickback does not mean restart. It means stop-fix-continue. The checklist survives; already-completed tasks are not re-done.

## Docs reconciliation (docs gate)

Reconciliation is not optional. It is a hard gate.

The reconciliation process:
1. Walk `manifest.yaml context_targets`.
2. Diff architecture.md + decisions.md against each target CONTEXT.md.
3. Update each CONTEXT.md to reflect the change: new seams, updated interfaces, graduated firmness, new known-soft-spots.
4. Re-stamp provenance (`validated-at: <current HEAD sha>`).
5. Adversarial verifier subagent: confirm CONTEXT claims match the implemented code.
6. Present summary to user. User approves (docs gate → approved) or requests corrections.

Docs approval reruns checkpoint freshness while permitting changes only to declared `context_targets`; index/worktree divergence is forbidden even for those targets, and any source, lock, or undeclared-file drift blocks approval. Audit-only refactors compare HEAD, index/worktree consistency, and repository contents against the one-time baseline captured by their explicit gate and likewise permit only context-target changes. Only after docs gate is approved does `change-archive.mjs` run.

## Tracking multiple concurrent changes

Each change has its own isolated directory. Multiple `active/<id>/` directories can coexist. `change-status.mjs` lists all active changes and their current stages.

It is the user's responsibility to ensure concurrent changes don't create conflicting edits. The toolkit does not prevent concurrent work, but `architect` will flag when a proposed change touches seams already being modified by another active change.
