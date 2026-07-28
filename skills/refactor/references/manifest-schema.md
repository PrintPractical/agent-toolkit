# Manifest Schema

Every change tracked by this toolkit has a `manifest.yaml` in `.changes/active/<id>/`. It is the source of truth for the change's current state, and the record of pipeline quality.

## File format

```yaml
id: YYYY-MM-DD-<slug>               # e.g. 2026-07-01-add-rate-limiter
title: Short human-readable title
class: feature | bug | small | epic | refactor
stage: refactor | architect | specify | plan | implement | done
language: <idiom-pack-id>           # lowercase filename stem, e.g. rust, go, typescript; omit for language-agnostic

# Epic parent/child linking (optional)
parent: YYYY-MM-DD-<epic-slug>      # present only on child changes; points to the epic
children:                           # present only on epic manifests
  - YYYY-MM-DD-<child-slug>

# Refactor class only (optional)
refactor_mode: execute | audit-only # execute applies selected cleanup; audit-only stops after the report
refactor_selected_ids:              # user-approved opportunity IDs from refactor.md
  - RF-001

gates:
  refactor:   pending | approved    # refactor class only: audit + selection approved
  architect:  pending | approved
  specify:    pending | approved
  plan:       pending | approved
  implement:  pending | approved
  docs:       pending | approved

artifacts:
  architecture: architecture.md     # relative to this directory
  decisions:    decisions.md
  plan:         plan.md
  refactor:     refactor.md          # refactor class only (replaces architecture/decisions/plan)

context_targets:                    # CONTEXT.md files this change should reconcile
  - CONTEXT.md
  - src/gateway/CONTEXT.md

kickbacks:
  - type:       defect | amendment
    stage:      specify | plan | implement
    at:         2026-07-01T14:32:00Z
    missed:     "What the upstream spec should have caught"
    resolution: "What was decided to resolve it"
```

## Stage machine

```
Feature/bug/small:    architect → specify → plan → implement → done

Epic:                 architect → specify → (decompose) → done
                                                  ↓
                               child architect → specify → plan → implement → done

Refactor:             refactor → implement → done
                      (audit + selection) (execute + independent review)
```

- Stage advances only when the corresponding gate is `approved`.
- **No skill auto-advances past a gate.** Every gate transition requires explicit user approval in the session.
- Each spine skill checks the prior gate on startup and refuses to proceed if it is not `approved`.
- `change-status.mjs` prints the current stage and the recommended next skill.
- A kickback from `plan` or `implement` returns the stage to `specify` and resets the `specify` and `plan` gates. Re-approving those gates advances through `plan` and back to `implement` without losing completed checklist work.

**Epics never run plan or implement.** Their `specify` covers cross-cutting contracts only. After `specify` is approved, run `epic-split.mjs` to create child change manifests. The epic's `architecture.md` + `decisions.md` become parent context for each child's `architect` session.

## Gate semantics

| Gate | Approved by | What it certifies |
|---|---|---|
| `refactor` | User, after audit + explicit opportunity selection | Ranked opportunities recorded; user selected exact `RF-NNN` IDs to execute |
| `architect` | User, after validity-check subagent passes | Architecture decisions are sound; no gaps found |
| `specify` | User, after dry-run subagent passes | All ambiguities resolved; interfaces finalized |
| `plan` | User, after traceability check | Every acceptance criterion traces to ≥1 task |
| `implement` | User, after all tests pass **and an approved independent review** | Implementation complete, all tasks checked, behavior-preserving cleanup verified by a distinct fresh reviewer |
| `docs` | User, after reconciliation + verifier subagent | CONTEXT hierarchy updated and verified |

## Change classes

- **`small`** — Used by `triage`. Single component, no new seams, no interface changes. Abbreviated pipeline.
- **`bug`** — Used by `triage`. Existing behavior being restored. No architect/specify required unless scope expands.
- **`feature`** — Standard full pipeline.
- **`epic`** — Runs `architect` (identify children + overall design) then `specify` (cross-cutting contracts), then decomposes into child changes via `epic-split`. The epic manifest never runs plan or implement — it tracks child change IDs and completion. Each child runs the full `architect → specify → plan → implement` spine independently, depth-first.
- **`refactor`** — Used by the `refactor` skill for behavior-preserving cleanup. Skips the spec spine entirely: `refactor` (audit the scope, rank opportunities, record the user's explicit `RF-NNN` selection) → `implement` (apply the selected cleanup, keep tests green, obtain a distinct fresh independent review) → `docs`. Never changes observable behavior; anything that would is escalated to `architect`. With `refactor_mode: audit-only` the change stops after the report without executing.

## Epic parent/child model

An epic is a container for multiple related feature/bug/small changes that are too large to implement as one change but share a common architectural context.

**Epic manifest:** Contains `class: epic` and a `children` list of child change IDs. The epic runs `architect` then `specify`; `epic-split` populates the `children` list after the specify gate is approved. The epic reaches `done` when all children reach `done` (or are archived).

**Child manifests:** Contain `parent: <epic-id>` linking back to the epic. Each child has its own full pipeline.

**Execution order — depth-first.** Take each child all the way to `done` (architect → specify → plan → implement) before starting the next, in dependency order. Do not architect/specify all children up front: the epic's `specify` already locked the cross-cutting contracts between children, so each child is insulated from the others. Independent children may run in parallel, but each runs its full spine start-to-finish — never batched by stage. If a child implementation reveals a cross-cutting contract is wrong, kick back to the epic's `specify` (firm-change protocol) and propagate to any already-completed children.

**Scripts:**
- `change-new.mjs --class epic` — create a new epic manifest
- `change-new.mjs --parent <epic-id>` — create a child linked to an epic
- `epic-split.mjs --epic <id> --children '[...]'` — bulk-create children from an existing epic architecture.md
- `change-status.mjs --id <epic-id>` — show epic progress with per-child stage rollup

## Kickback types and quality metric

Kickback entries log times when `implement` had to stop and return to an upstream stage.

An empty `resolution` means the kickback is unresolved. The targeted `specify` session replaces it with the actual decision before the specify gate is re-approved.

- **`defect`** — The upstream spec was incomplete; the dry-run in `specify` should have caught this. Counts against kickback frequency.
- **`amendment`** — Legitimate external requirement change or new information. Does not count against kickback frequency.

**Kickback frequency = defect kickbacks / total changes.** This is the single quality metric for the pipeline. If `architect` and `specify` are doing their job, it trends toward zero.

## ID format

`YYYY-MM-DD-<slug>` where slug is `kebab-case`, 3-6 words, derived from the change title. Example: `2026-07-01-add-rate-limiter`. IDs are unique per calendar day; add a numeric suffix if there is a collision (e.g. `2026-07-01-add-rate-limiter-2`).
