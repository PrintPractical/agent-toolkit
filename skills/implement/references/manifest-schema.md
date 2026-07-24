# Manifest Schema

Every change tracked by this toolkit has a `manifest.yaml` in `.changes/active/<id>/`. It is the source of truth for the change's current state, and the record of pipeline quality.

## File format

```yaml
id: YYYY-MM-DD-<slug>               # e.g. 2026-07-01-add-rate-limiter
title: Short human-readable title
class: feature | bug | small | epic | refactor
stage: refactor | architect | specify | plan | implement | done
language: <idiom-pack-id>           # lowercase filename stem, e.g. rust, go, typescript; omit for language-agnostic
checkpoint_epoch: 0                 # integer; incremented by kickbacks and upstream gate resets
implementation_contract_digest: "" # normalized plan/refactor execution contract captured on gate approval
refactor_mode: execute | audit-only # present only after the refactor selection gate
refactor_selected_ids: [RF-001]     # execute mode only; exact user-approved inventory

# Epic parent/child linking (optional)
parent: YYYY-MM-DD-<epic-slug>      # present only on child changes; points to the epic
children:                           # present only on epic manifests
  - YYYY-MM-DD-<child-slug>

gates:
  refactor:   pending | approved  # refactor class only; refactor_mode records the branch
  architect:  pending | approved
  specify:    pending | approved
  plan:       pending | approved
  implement:  pending | approved
  docs:       pending | approved

artifacts:
  architecture: architecture.md     # relative to this directory
  decisions:    decisions.md
  plan:         plan.md

# Refactor manifests use these artifacts instead:
# artifacts:
#   refactor:             refactor.md
#   implementation_units: implementation-units.json
#   implementation_state: implementation-state.json
#   reviews:              reviews/

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

Refactor selected IDs: refactor (audit + selection) → implement (selected batches + docs) → done
Refactor audit-only:   refactor (audit + verbatim audit-only gate) → docs → done
```

- Stage advances only when the corresponding gate is `approved`. Resetting a gate cascades all downstream gates to `pending` and restores the corresponding stage. Resetting `architect`, `specify`, `plan`, or `refactor` increments `checkpoint_epoch`, so stale implementation evidence cannot survive revoked authorization. `refactor --audit-only` approves the refactor gate with `refactor_mode: audit-only`, keeps the stage at `refactor`, and permits only the docs gate.
- **No skill auto-advances past a gate.** Every gate transition requires explicit user approval in the session.
- Each spine skill checks the prior gate on startup and refuses to proceed if it is not `approved`.
- `change-status.mjs` prints the current stage and the recommended next skill.
- A kickback from `plan` or `implement` increments `checkpoint_epoch`, returns the stage to `specify`, clears the approved contract digest, and resets `specify`, `plan`, `implement`, and `docs`. Re-approving those gates advances through `plan` and back to `implement` without losing completed checklist work; checkpoint state is then reset from the amended canonical declarations.

**Epics never run plan or implement.** Their `specify` covers cross-cutting contracts only. After `specify` is approved, run `epic-split.mjs` to create child change manifests. The epic's `architecture.md` + `decisions.md` become parent context for each child's `architect` session.

## Gate semantics

| Gate | Approved by | What it certifies |
|---|---|---|
| `architect` | User, after validity-check subagent passes | Architecture decisions are sound; no gaps found |
| `specify` | User, after dry-run subagent passes | All ambiguities resolved; interfaces finalized |
| `plan` | User, after traceability check | Every acceptance criterion traces to ≥1 task |
| `implement` | User, after all tests pass | Implementation complete, all tasks checked |
| `docs` | User, after reconciliation + verifier subagent | CONTEXT hierarchy updated and verified |
| `refactor` | User, after ranked audit | Exact behavior-preserving opportunity IDs with complete selected records and batches are selected with `--approve`, or a verbatim audit-only selection is recorded once with `--audit-only` |

## Change classes

- **`small`** — Used by `triage`. Single component, no new seams, no interface changes. Abbreviated pipeline.
- **`bug`** — Used by `triage`. Existing behavior being restored. No architect/specify required unless scope expands.
- **`feature`** — Standard full pipeline.
- **`epic`** — Runs `architect` (identify children + overall design) then `specify` (cross-cutting contracts), then decomposes into child changes via `epic-split`. The epic manifest never runs plan or implement — it tracks child change IDs and completion. Each child runs the full `architect → specify → plan → implement` spine independently, depth-first.
- **`refactor`** — Standalone behavior-preserving maintenance. Audits a scope, requires exact user selection, then executes checkpointed batches. It cannot be an epic child; behavior or firm-contract changes become separate architect work.

Standalone `bug` and `small` manifests created for `triage` begin at `stage: implement` with architect/specify/plan recorded as approved. Their single implementation unit still requires the full checkpoint cycle. Feature changes and epic children use the standard spine.

## Implementation state

Standard, triage, and executing refactor changes use exactly `.changes/active/<id>/implementation-units.json`. Each unit object requires `id`, exact `files`, `lockedTestFiles`, exact `baselineCommand`, and exact `finalCommand`; no alternate declaration path or inline JSON is valid, and every path has exactly one owning unit. Standard and triage plan markers include exact editable/locked JSON arrays and commands, all of which match the declarations. Refactor tables and headings match the units and assign the complete `refactor_selected_ids` set exactly once with no extras. The plan/refactor gate stores a normalized digest of this complete contract; checkpoint initialization and every later action require it unchanged.

`implementation-state.json` binds `checkpoint_epoch`, the gate-approved contract digest, initialization HEAD/worktree, and a digest of the canonical declaration file. A refactor contract includes the full selected opportunity records, preventing semantic redefinition after approval. Manifest-backed state requires Git with a valid HEAD. Units progress `building → green → reviewed → refactoring → tested → verified`. `--check-all` rejects index/worktree divergence and undeclared changes whether they remain in the worktree or were committed after initialization. Review reports are versioned JSON under `reviews/` and bind a stable nonempty self-declared `reviewerId`, reviewer role, checks, file/line findings, disposition, verdict, and the exact content snapshot. Initial and final reviewer IDs differ; the permanent state registry prevents ID reuse across units, invalidation, and reset. A review cannot locally resolve a `kickback` finding.

The first green snapshot makes its cycle-lock baseline immutable. If a locked test changes, restore it; standard implementation may kick back, while standalone refactor maintenance must stop and create an architect candidate. It cannot be accepted by rebaselining. After a resolved standard kickback and reapproved plan, or an explicitly approved refactor reselection, `implementation-checkpoint.mjs --id <id> --reset --units .changes/active/<id>/implementation-units.json` archives prior state/reviews and initializes state for the incremented epoch and amended declaration digest. Implement-gate approval rechecks its upstream plan/refactor gate, invokes `implementation-checkpoint.mjs --check-all`, and fails for missing, incomplete, stale, unlocked, unauthorized, or undeclared evidence.

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

Every logged kickback increments `checkpoint_epoch`, including amendments. This invalidates checkpoint state even when declaration text happens not to change.

- **`defect`** — The upstream spec was incomplete; the dry-run in `specify` should have caught this. Counts against kickback frequency.
- **`amendment`** — Legitimate external requirement change or new information. Does not count against kickback frequency.

**Kickback frequency = defect kickbacks / total changes.** This is the single quality metric for the pipeline. If `architect` and `specify` are doing their job, it trends toward zero.

## ID format

`YYYY-MM-DD-<slug>` where slug is `kebab-case`, 3-6 words, derived from the change title. Example: `2026-07-01-add-rate-limiter`. IDs are unique per calendar day; add a numeric suffix if there is a collision (e.g. `2026-07-01-add-rate-limiter-2`).
