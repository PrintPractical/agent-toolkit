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
implement → per section: code + tests green, live checklist updated
    ↓         then once, over the whole change: independent review →
    ↓         behavior-preserving refactor → tests still green → fresh verifier approves
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
```

`<id>` format: `YYYY-MM-DD-<kebab-slug>`.

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
2. Run `kickback-log.mjs` — appends an unresolved entry to `manifest.yaml`, sets `stage` to `specify`, and resets the `specify` and `plan` gates to `pending`.
3. Run a targeted `specify` amendment session covering only the gap.
4. `specify` updates `decisions.md`, reconciles `architecture.md` if needed, and records the actual resolution in the kickback entry.
5. The user re-approves the `specify` gate, which advances the stage to `plan`.
6. `plan` amends `plan.md` to cover the new decisions without discarding completed checklist items.
7. The user re-approves the `plan` gate, which advances the stage to `implement`.
8. `implement` resumes from the checkpoint.

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

Only after docs gate is approved does `change-archive.mjs` run.

## Independent implementation review (implement gate)

Before the implement gate can be approved, every change (standard, triage, and refactor) passes one independent review-and-refactor pass over the finished work — described in full in `implementation-review.md`:

1. Bring all implementation to a green test baseline (standard changes do this per plan section; a refactor's selected cleanup is the work itself).
2. A **fresh auditor subagent** reviews the whole change against the language idiom packs, flagging unsafe/panic-prone code, non-idiomatic patterns, oversized/monolithic modules, and hygiene issues, and records findings with `review-log.mjs`.
3. Apply behavior-preserving cleanup for those findings. Firm-seam tests stay green throughout; a firm-seam failure is a kickback, never a test edit.
4. Run the full suite green, then a **distinct fresh verifier subagent** confirms behavior is preserved and approves with `review-log.mjs`.
5. `manifest-gate.mjs --gate implement --approve` refuses until that approved verifier review exists.

This is intentionally snapshot-free: the review record in `.changes/active/<id>/reviews.json` is an attestation, with no per-file hashing, locking, or index checks.

## Refactor class lifecycle

A `class: refactor` change skips the spec spine: `refactor` (audit the scope, rank opportunities in `refactor.md`, record the user's explicit `RF-NNN` selection) → `implement` (apply the selected cleanup with the independent review above) → `docs`. It never changes observable behavior; anything that would is escalated to `architect`. See `implementation-review.md` for the audit roles, opportunity schema, and boundaries.

## Tracking multiple concurrent changes

Each change has its own isolated directory. Multiple `active/<id>/` directories can coexist. `change-status.mjs` lists all active changes and their current stages.

It is the user's responsibility to ensure concurrent changes don't create conflicting edits. The toolkit does not prevent concurrent work, but `architect` will flag when a proposed change touches seams already being modified by another active change.
