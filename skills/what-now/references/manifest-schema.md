# Manifest Schema

Every change tracked by this toolkit has a `manifest.yaml` in `.changes/active/<id>/`. It is the source of truth for the change's current state, and the record of pipeline quality.

## File format

```yaml
id: YYYY-MM-DD-<slug>               # e.g. 2026-07-01-add-rate-limiter
title: Short human-readable title
class: feature | bug | small | epic | refactor
phase: refactor | architect | specify | plan | implement | decomposed | archive-ready
language: <idiom-pack-id>           # lowercase filename stem, e.g. rust, go, typescript; omit for language-agnostic

# Epic parent/child linking (optional)
parent: YYYY-MM-DD-<epic-slug>      # present only on child changes; points to the epic
children:                           # present only on epic manifests
  - YYYY-MM-DD-<child-slug>

# Refactor class only (optional)
refactor_mode: execute | audit-only # execute applies selected cleanup; audit-only stops after the report
refactor_selected_ids:              # user-approved opportunity IDs from refactor.md
  - RF-001

approvals:
  refactor:   pending | approved    # refactor class only: audit + selection approved
  architect:  pending | approved
  specify:    pending | approved
  plan:       pending | approved
  implement:  pending | approved
  docs:       pending | approved    # epic class only

# Formal-review cycle epoch. Omit until a kickback advances an affected phase;
# the implicit starting epoch is 1. Keep prior reviews.json cycles as history.
review_epochs:
  specify: 2
  implement: 2

artifacts:
  change_brief:  change-brief.md      # intake captured before discovery
  architecture: architecture.md     # relative to this directory
  decisions:    decisions.md
  plan:         plan.md
  refactor:     refactor.md          # refactor class only (replaces architecture/decisions/plan)
  implementation: implementation.md  # non-refactor, non-epic completion evidence
  epic_docs: epic-docs.md            # epic class only

# Required only for a cancellation archive
archive:
  outcome: cancelled
  reason: "Why this change will not continue"

# Formal review findings live in the active artifacts:
# architecture.md: AV-NNN; decisions.md: SV-NNN; plan/refactor.md: RV-NNN
# Implementation/refactor approval attestations additionally live in reviews.json.

context_targets:                    # CONTEXT.md files this change should reconcile
  - CONTEXT.md
  - src/gateway/CONTEXT.md

kickbacks:
  - type:       defect | amendment
    phase:      specify | plan | implement | refactor
    at:         2026-07-01T14:32:00Z
    missed:     "What the upstream spec should have caught"
    resolution: "What was decided to resolve it"
    impact: specify | plan | implementation | epic-specify | architect
    invalidated_approvals: "specify,plan,implement"
    restart_phase: specify
```

## Change brief

Create `change-brief.md` from `change-brief.md.tmpl` immediately after creating an active workspace and before discovery. It records the goal and observable outcome, affected area, constraints and anti-goals, and whether requirements are formed, partially formed, or unformed. It may identify unknowns; it does not decide architecture.

## Phase machine

```
Feature:              architect → specify → plan → implement → archive-ready → verified archive

Bug/small (triage):   implement → archive-ready → verified archive

Epic:                 architect → specify → decomposed → docs → archive-ready
                                            ↓
                         child ... → archive-ready (held by epic)
                                            ↓
                         coordinated verified archive of parent and children

Refactor execute:     refactor → implement → archive-ready → verified archive
Refactor audit-only:  refactor → archive-ready → verified archive
```

- The phase advances only when the corresponding approval is `approved`.
- **No skill auto-advances past an approval.** Every approval requires explicit user approval in the session.
- Each spine skill checks the prior approval on startup and refuses to proceed if it is not `approved`.
- `change-status.mjs` prints the current phase and the recommended next skill.
- `archive-ready` is active, not terminal. The only terminal state is a verified archive; the active workspace is removed only after archive verification succeeds.
- Cancellation may occur from any active phase. Record `archive.outcome: cancelled` and a specific `archive.reason`, then create a verified cancellation archive. It bypasses unfinished approvals but never silently discards the workspace.
- A kickback records its impact. `specify` resets specify, plan, and implement; `plan` resets plan and implement; `implementation` resets implement. It advances affected formal review epochs, so resumed reviews use the current `phase-N` epoch while prior cycles remain history. Re-approve only invalidated approvals without losing unaffected checklist work.
- A child may use `epic-specify` to return a cross-cutting contract to its direct epic parent. The parent and active children are reset for revalidation. A refactor uses `architect` to record an escalation handoff, then creates an architect-class change rather than continuing as a refactor.

**Epics never run plan or implement.** Their `specify` covers cross-cutting contracts only. After `specify` is approved, run `epic-split.mjs`; the epic enters `decomposed`, and its `architecture.md` + `decisions.md` become parent context for each child's `architect` session. Keep completed children at `archive-ready` until the epic is ready to archive them together.

## Approval semantics

| Approval | Approved by | What it certifies |
|---|---|---|
| `refactor` | User, after audit; execute mode also requires explicit opportunity selection | Audit report is complete; execute mode records exact selected `RF-NNN` IDs |
| `architect` | User, after bounded `AV-*` review and deterministic artifact validation | Material topics confirmed; original review IDs closed; no unresolved blockers |
| `specify` | User, after explicit confirmation ledger, bounded `SV-*` implement-as-if review, and deterministic artifact validation | Every material decision explicitly confirmed; original review IDs closed; no unresolved blockers |
| `plan` | User, after source-grounded implementability review, traceability, and deterministic artifact validation | Every seam has behavioral criteria; every criterion traces to >=1 task; prospective review passed |
| `implement` | User; full-spine features/refactors also require an approved bounded `RV-*` review | Implementation evidence records passing tests and completed context verification; CONTEXT hierarchy is reconciled and verified; when formal review applies, original findings are closed by a distinct fresh verifier |
| `docs` | User, after reconciliation, `context-verify`, and verifier subagent | Epic-only `epic-docs.md` records reconciliation, passing verification, independent docs review, and explicit approval evidence |

## Change classes

- **`small`** — Used by `triage`. Single component, no new seams or interface changes. It runs directly from `implement` to `archive-ready` with one implement approval after a lightweight self-check and docs reconciliation; no formal adversarial review is required.
- **`bug`** — Used by `triage`. Existing behavior being restored. It uses the same direct `implement → archive-ready` path; no architect/specify or formal review is required unless scope expands.
- **`feature`** — Standard full pipeline, including bounded `AV-*`, `SV-*`, and `RV-*` review cycles.
- **`epic`** — Runs `architect` with one `AV-*` cycle, then `specify` with one `SV-*` cycle over cross-cutting contracts, then enters `decomposed` via `epic-split`. The epic never runs plan or implement. Each child runs its own applicable spine depth-first, remains `archive-ready` when complete, and archives with the parent in one coordinated operation.
- **`refactor`** — Used by the `refactor` skill for behavior-preserving cleanup. Execute mode skips the spec spine: `refactor` (audit, rank opportunities, record the user's explicit `RF-NNN` selection) → `implement` (apply selected cleanup, reconcile docs, keep tests green, obtain a distinct fresh independent review) → `archive-ready`. Audit-only approves the completed `refactor` audit, moves directly to `archive-ready`, and archives the report without execution. Never changes observable behavior; anything that would is escalated to `architect`.

## Epic parent/child model

An epic is a container for multiple related feature/bug/small changes that are too large to implement as one change but share a common architectural context.

**Epic manifest:** Contains `class: epic` and a `children` list of child change IDs. The epic runs `architect` then `specify`; `epic-split` populates the `children` list after the specify approval is approved and moves the epic to `decomposed`. When every child is `archive-ready`, use the `epic` skill to reconcile parent context, approve docs, move the epic to `archive-ready`, and archive the parent plus children together.

**Child manifests:** Contain `parent: <epic-id>` linking back to the epic. Each child has its own full pipeline and cannot be archived or cancelled independently. Cancel the epic parent to create one coordinated cancellation archive for it and all children.

**Execution order — depth-first.** Take each child through its applicable spine to `archive-ready` before starting the next, in dependency order. Do not architect/specify all children up front: the epic's `specify` already locked the cross-cutting contracts between children, so each child is insulated from the others. Independent children may run in parallel, but each runs its full spine start-to-finish — never batched by phase. Do not archive an `archive-ready` child independently. If a child implementation reveals a cross-cutting contract is wrong, kick back to the epic's `specify` (firm-change protocol) and propagate to any already-completed children.

**Scripts:**
- `change-new.mjs --class epic` — create a new epic manifest
- `change-new.mjs --parent <epic-id>` — create a child linked to an epic
- `epic-split.mjs --epic <id> --children '[...]'` — bulk-create children from an existing epic architecture.md
- `change-status.mjs --id <epic-id>` — show epic progress with per-child phase rollup

## Kickback types and quality metric

Kickback entries log times when `implement` had to stop and return to an upstream phase.

An empty `resolution` means the kickback is unresolved. Resolve only the affected artifact at its recorded `restart_phase` before re-approving invalidated approvals.

- **`defect`** — The upstream spec was incomplete; the dry-run in `specify` should have caught this. Counts against kickback frequency.
- **`amendment`** — Legitimate external requirement change or new information. Does not count against kickback frequency.

**Kickback frequency = defect kickbacks / total changes.** This is the single quality metric for the pipeline. If `architect` and `specify` are doing their job, it trends toward zero.

## ID format

`YYYY-MM-DD-<slug>` where slug is `kebab-case`, 3-6 words, derived from the change title. Example: `2026-07-01-add-rate-limiter`. IDs are unique per calendar day; add a numeric suffix if there is a collision (e.g. `2026-07-01-add-rate-limiter-2`).
