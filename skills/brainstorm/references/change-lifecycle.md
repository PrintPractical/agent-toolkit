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
implement → code + tests green, live checklist updated
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
2. Run `kickback-log.mjs` — appends to `manifest.yaml kickbacks` array, sets `type` (defect or amendment).
3. Return to `specify`. Run a targeted amendment session covering only the gap.
4. `specify` updates `decisions.md`, reconciles `architecture.md` if needed.
5. `specify` gate re-set to `pending`; user must re-approve before `implement` resumes.
6. `plan.md` amended to cover the new decisions.
7. `plan` gate re-set to `pending`; user must re-approve.
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

## Tracking multiple concurrent changes

Each change has its own isolated directory. Multiple `active/<id>/` directories can coexist. `change-status.mjs` lists all active changes and their current stages.

It is the user's responsibility to ensure concurrent changes don't create conflicting edits. The toolkit does not prevent concurrent work, but `architect` will flag when a proposed change touches seams already being modified by another active change.
