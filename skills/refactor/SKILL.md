---
name: refactor
description: Use for behavior-preserving refactors, cleanup, technical debt reduction, or code-quality audits across a named path, component, layer, package, or the whole stack. Audits first, requires explicit user selection, then executes small verified batches. Routes behavior changes and firm-contract changes to architect.
---

# Refactor

You are running the **refactor** maintenance workflow. It has one hard constraint: preserve observable behavior. The sequence is:

```
read-only audit -> explicit user selection -> characterized execution -> final review -> docs -> archive
```

An audit may finish with no execution. Never turn a cleanup request into a feature, bug fix, migration, dependency upgrade, or contract redesign.

## Running the helper scripts

This skill bundles helper scripts in its own `scripts/` directory. Set `SKILL_DIR` to this skill's absolute path, then run scripts from the project root:

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

Never reference `packages/build/`; that path does not exist in an installed skill.

After selection, `implementation-checkpoint.mjs` owns each declared implementation unit. It enforces this phase order and treats any non-zero result as a hard stop:

```
building -> green -> reviewed -> refactoring -> tested -> verified
```

The script persists `.changes/active/<id>/implementation-state.json`. Execution requires Git with a valid HEAD and binds state to the manifest's integer `checkpoint_epoch`, the refactor-gate-approved execution-contract digest, initialization HEAD/worktree, and the canonical unit-declaration digest. Record its commands and results in `refactor.md`; do not substitute a prose claim that a checkpoint passed.

## Non-negotiable boundary

Read `references/implementation-review.md` and `references/seam-and-test-taxonomy.md` before starting.

- Preserve outputs, errors, side effects, ordering, timing guarantees, persistence, protocols, public types, supported inputs, and operational behavior.
- Preserve every firm seam and its tests unchanged. Firm means protected, not merely inconvenient.
- A desired behavior change, bug fix, firm-contract change, or change to a firm-seam test is not refactoring. Record it as `escalated-architect`, exclude it from selection, and hand it to `architect`.
- If the current behavior cannot be established, do not guess. Mark the opportunity blocked or route the ambiguity to `architect`.
- Structural soft-seam changes are allowed only when their behavior-preservation argument is explicit and verification can support it.

## Phase 0: Establish scope and workspace

Use the scope supplied by the user: a path, component, layer, package, set of targets, or whole stack. Normalize it to concrete repository-relative paths and record both requested and effective scope in `refactor.md`.

If the user omits scope, audit the **whole first-party repository**. Exclude generated code, vendored or third-party code, dependency caches, build outputs, coverage outputs, archives, transient tool state, and `.changes/archive/`. Also honor repository ignore/configuration files. Record every exclusion; do not silently omit a first-party area because it is large.

Create or resume the active maintenance workspace and initialize `refactor.md` from `references/templates/refactor.md.tmpl`. Stable opportunity IDs use `RF-001`, `RF-002`, and so on. Never renumber or reuse an ID after it is persisted.

Before audit:

1. Record HEAD, worktree state, active changes, requested/effective scope, and exclusions.
2. Discover relevant root and component `CONTEXT.md` files with `context-discover.mjs`; read their seams, firm criteria, dependencies, and Known Soft Spots.
3. Detect **all languages present in effective scope**, including mixed-language packages and build/configuration languages that contain first-party logic.
4. For every detected language, load `references/idioms/<language>.md` when present. Record loaded and missing packs. A primary-language shortcut is not allowed.

If no active refactor workspace exists, create it before writing the artifact:
```bash
node "$SKILL_DIR/scripts/change-new.mjs" --title "<refactor audit title>" --class refactor
```

## Phase 1: Read-only parallel audit

This phase may read code, tests, configuration, docs, history, and tool output. It may write only the maintenance artifacts under `.changes/active/<id>/`. **Do not edit source, configuration, documentation, snapshots, or tests. Do not add characterization tests yet.**

Run the specialized roles from `references/implementation-review.md` in parallel where tooling permits. Every role is read-only and receives the same effective scope, exclusions, CONTEXT set, firm seams, and relevant idiom packs:

- Scope and architecture mapper
- Behavior and contract guardian
- Structure and dependency reviewer
- Language-idiom reviewer, one per detected language
- Tests and coverage reviewer
- Runtime and operational-risk reviewer when the scope has persistence, concurrency, resources, networking, or deployment behavior

Require file-and-symbol evidence, not generic advice. Roles report candidates independently; they do not edit and do not approve one another's proposals.

## Phase 2: Synthesize and rank

Deduplicate candidates and persist every credible opportunity in `refactor.md` using the shared report schema. Each opportunity must include:

- Stable ID, rank, title, scope, and concrete evidence
- Payoff and why it matters now
- Behavior-preservation argument, including observables that remain invariant
- Seams touched with firmness and CONTEXT references
- Risk, effort, current coverage, and coverage gaps
- Dependencies or conflicts with other opportunities
- Proposed files and verification commands
- Status: `proposed`, `selected`, `deferred`, `rejected`, `blocked`, `complete`, or `escalated-architect`

Rank by payoff adjusted for confidence, risk, effort, and dependency order. Do not inflate rankings through speculative abstraction benefits. Move anything outside the local-cleanup boundary to `escalated-architect` before presenting the list.

Present the ranked list with a concise recommendation. The audit is complete at this point.

## Phase 3: Explicit selection gate

Ask the user to select exact IDs:

> "Which refactor opportunities do you approve for execution? Reply with the exact `RF-...` IDs, or choose audit-only. No code or test changes will be made until you select them."

Silence, general enthusiasm, the original cleanup request, or approval to continue auditing is not selection. Until the user responds with exact IDs or explicitly chooses audit-only, make **no source, configuration, documentation, snapshot, or test edits**, including characterization-test edits. Audit-only authorizes artifact closure and documentation reconciliation, never code or test changes.

Record the user's exact selection as a JSON array, timestamp, dependency closure, deferrals, and rejections. Audit-only still requires an explicit gate transition after recording the user's response verbatim:
```bash
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate refactor --audit-only
```

This requires completed read-only audit roles plus a ranked inventory or explicit `no-actionable-opportunities` conclusion. It captures a one-time repository HEAD/content baseline and authorizes only documentation reconciliation and the docs gate, never characterization, source, or test edits. It cannot be rerun to absorb later changes; reset the refactor gate before a new selection. Do not skip directly from prose selection to docs approval.

For exact selected IDs, first mark each complete ranked opportunity record `selected`; the exact ID must appear explicitly in the verbatim user response. Group every selected ID into one small proposed batch. Persist the complete implementation-unit table and matching `### B-...` headings in `refactor.md` with selected IDs, editable files, and locked files as JSON arrays inside code spans. Every selected ID must appear exactly once and no unselected ID may appear. This planning is artifact-only: do not create characterization tests or edit source before approval.

Then ask the user to approve the persisted exact IDs and batches, and record the gate before characterization or implementation edits:
```bash
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate refactor --approve
```

The refactor gate validates and records the exact selected IDs and complete batch contract, binds each selected opportunity's evidence, payoff, behavior-preservation argument, and invariants in its normalized digest, advances the manifest to `stage: implement`, and keeps `refactor` as the orchestrator. Do not approve this gate for a vague selection, incomplete opportunity, or mismatched batch assignment.

After selection, but before implementation:

1. Check the worktree again. Pre-existing, foreign, or concurrently changed files overlapping a proposed batch block that batch. Do not overwrite, revert, stash, or absorb overlapping work. Ask the user to resolve it or narrow/reorder the batch.
2. Run all relevant existing tests and checks for the selected scope. Any relevant pre-existing failure blocks execution. Record the command and failure; do not claim a refactor caused it and do not weaken a test to proceed.
3. Identify selected behavior without adequate coverage. Only now add the already-declared minimal characterization tests and make them pass against the unchanged implementation.
4. Run those tests against the unchanged implementation and classify their seams. A test becomes cycle-locked when its path is declared in an implementation unit's `lockedTestFiles` and the first green baseline snapshot is recorded. That lock baseline is immutable: if the locked file later changes, restore it or route the required behavior/contract decision to `architect`; never rebaseline the changed lock.
5. Persist the approved declarations only at `.changes/active/<id>/implementation-units.json`, with one stable unit ID per batch, and initialize checkpoint state:

```bash
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --init \
  --units .changes/active/<id>/implementation-units.json
```

Each declaration requires `id`, exact `files`, `lockedTestFiles`, exact `baselineCommand`, and exact `finalCommand`. Inline JSON and alternate declaration paths are invalid. IDs, paths, locks, commands, and per-batch selected IDs must match the user-approved table and `### <unit-id>` headings exactly. Include all characterization and touched firm-seam test files in `lockedTestFiles`; never include them in editable `files`. Consolidate batches that would declare the same editable file. On resume, inspect existing state with `--status` rather than reinitializing it.

If a characterization test exposes disputed or apparently incorrect behavior, stop. Refactoring preserves what exists; changing it belongs in `architect`.

## Phase 4: Execute small coherent batches

Execute one batch at a time. A batch must be independently reviewable and small enough that a behavioral regression can be localized.

Before touching a batch, its entry in `refactor.md` and corresponding checkpoint unit must declare:

- Selected opportunity IDs and batch ID
- Exact files allowed to change
- Observable invariants to preserve
- Firm seams and cycle-locked tests protecting them
- Exact declared baseline and final commands, including targeted and broader verification
- Dependencies and rollback boundary

Recheck overlapping dirty work immediately before editing. Workflow-owned characterization files already declared for locking are expected; any other dirty or concurrent overlap blocks execution. Every path has one batch owner; do not change a future or completed batch's paths outside its own checkpoint cycle. Change only declared files and only for selected opportunities. If selected behavior-preserving scope must change, reset the refactor gate, update the selection/batches, obtain explicit approval again, then use checkpoint `--reset`; this increments the epoch and archives prior evidence. Behavior or contract changes still create a separate `architect` change. Never hand-edit `implementation-state.json`.

Advance the unit to `refactoring` before implementation:

1. Run the exact declared `baselineCommand` against the unchanged implementation:
   ```bash
   node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit <batch-id> \
     --baseline-test --command "<exact declared baselineCommand>"
   ```
2. Have a read-only readiness reviewer inspect the green snapshot and write the script's `initial` review JSON with a stable nonempty self-declared `reviewerId` and verdict `ready-for-refactor`. Unresolved `blocking` findings block the unit. Any `kickback` category is rejected because behavior/contract work must become a separate `architect` change, not be resolved inside this refactor.
3. Bind the review and open implementation:
   ```bash
   node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit <batch-id> \
     --initial-review --review <review-json>
   node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit <batch-id> \
     --start-refactor
   ```

After each batch:

1. Run formatting/static checks relevant to changed languages.
2. Inspect the diff against the batch's declared files and invariants.
3. Advance the unit to `tested` by running the exact declared `finalCommand`, which must include cycle-locked characterization tests, touched firm-seam tests, targeted tests, and the declared broader set:
   ```bash
   node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit <batch-id> \
     --final-test --command "<exact declared finalCommand>"
   ```
4. Persist the result. If the command or lock check fails, mark the batch blocked and stop. Keep the opportunity selected until final review verifies the unit.

If the selected batch produces no implementation change, the script requires a substantive `--no-change-rationale`. Record why the opportunity became a no-op; do not manufacture churn to advance the phase.

Any invariant violation or firm-seam failure is evidence of behavior change. Do not edit the protecting test. Back out only this workflow's batch changes if safe; otherwise stop with the exact diff and failure. If the change is desired, route it to `architect`.

## Phase 5: Full verification and fresh review

After all selected batches reach `tested`:

1. Run the complete project verification expected for the effective scope: formatting, lint/static analysis, type checking, builds, tests, integration/system tests, and supported-runtime checks as applicable.
2. Run all touched firm-seam tests and all cycle-locked characterization tests again.
3. Use a **fresh reviewer** that did not perform the audit, readiness review, or implementation. Give it the baseline, selected IDs, complete diff, CONTEXT files, firm seams, idiom packs, invariants, and test results. It must follow the final-review schema in `references/implementation-review.md` and produce snapshot-bound `final` review JSON for every unit with verdict `behavior-preserved`. Each report has a stable nonempty self-declared `reviewerId` that differs from that unit's initial reviewer ID; identity is self-declared, but accidental reuse is blocked.
4. Resolve local findings with another declared pass. Route behavior or firm-contract findings to `architect`. Rerun final tests and fresh review after any implementation change.
5. Bind each accepted review, then require every unit to be verified and current:
   ```bash
   node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit <batch-id> \
     --final-review --review <review-json>
   node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --check-all
   ```

`--check-all` must pass before the implement gate is offered.

Present selected/completed/deferred/escalated IDs, changed files, invariant evidence, test results, and residual risk. Ask explicitly for implement-gate approval; never self-approve it.

```bash
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate implement --approve
```

## Phase 6: Documentation reconciliation

Reconcile documentation after implementation approval, or after an explicit audit-only selection where the audit revealed inaccurate maintenance context:

1. Run `context-verify.mjs` for all context targets.
2. Update relevant `CONTEXT.md` Known Soft Spots, dependency descriptions, and soft structural descriptions to match code. A behavior-preserving refactor must not rewrite firm criteria or contracts.
3. Reconcile developer documentation that describes changed internals, commands, package layout, or extension points. Do not churn user-facing behavior docs when behavior did not change.
4. Re-stamp changed CONTEXT provenance at current HEAD.
5. Have a fresh docs reviewer compare claims with code and `refactor.md`.
6. Record reconciled files and findings in `refactor.md`.

Ask the user to approve the docs gate. This is required after either implementation approval or the explicit `--audit-only` refactor gate. On approval:

```bash
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate docs --approve
node "$SKILL_DIR/scripts/change-archive.mjs" --id <id>
```

For executed refactors the docs gate reruns checkpoint freshness while allowing only declared `context_targets` to differ; index and worktree content must still agree for those targets. For audit-only work it compares HEAD, index/worktree consistency, and repository contents against the one-time baseline captured at selection. Source, lock, index, or undeclared-file drift blocks approval.

Archive only after all required gates are approved. The archive must contain the ranked audit, selection record, applicable batch/checkpoint and final-review evidence, escalations, and docs reconciliation.

## Stop conditions

Stop execution when any of these occurs:

- No exact opportunity IDs have been selected
- A relevant existing test is failing before implementation
- Dirty or concurrent work overlaps a batch
- Current behavior or the preservation argument is ambiguous
- A firm test, cycle-locked test, or declared invariant fails
- The needed edit exceeds declared files or selected opportunities
- The work would change behavior, a firm contract, or a firm-seam test
- A checkpoint transition, `--check-all`, or fresh review does not pass

Preserve the artifact and report the blocker. Do not improvise around a gate.

## Reference files

- `references/implementation-review.md` - audit roles, phases, report schema, and escalation boundary
- `references/seam-and-test-taxonomy.md` - firmness, characterization tests, and cycle locks
- `references/context-schema.md` - CONTEXT structure and seam records
- `references/firm-change-protocol.md` - explains why firm changes leave this workflow
- `references/drift-control.md` - documentation reconciliation rules
- `references/templates/refactor.md.tmpl` - persistent maintenance artifact
- `references/idioms/<language>.md` - load every pack represented in effective scope
