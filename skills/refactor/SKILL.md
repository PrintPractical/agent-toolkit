---
name: refactor
description: Use for behavior-preserving refactors, cleanup, technical debt reduction, or code-quality audits across a named path, component, layer, package, or the whole stack. Audits first, requires explicit user selection, then executes small verified batches with an independent review. Routes behavior changes and firm-contract changes to architect.
---

# Refactor

You are running the **refactor** maintenance workflow. It has one hard constraint: preserve observable behavior. The sequence is:

```
read-only audit → explicit user selection → verified execution → independent review → docs → archive
```

An audit may finish with no execution. Never turn a cleanup request into a feature, bug fix, migration, dependency upgrade, or contract redesign.

## Running the helper scripts

This skill bundles helper scripts in its own `scripts/` directory. Set `SKILL_DIR` to this skill's absolute path, then run scripts from the project root:

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

Never reference `packages/build/`; that path does not exist in an installed skill.

The review is **snapshot-free**: `review-log.mjs` records auditor findings and verifier verdicts; there is no per-file hashing, locking, epoch, or Git-index check. Record commands and results in `refactor.md`.

## Non-negotiable boundary

Read `references/challenge-protocol.md`, `references/adversarial-review.md`, `references/implementation-review.md`, `references/engineering-fundamentals.md`, and `references/seam-and-test-taxonomy.md` before starting.

- Preserve outputs, errors, side effects, ordering, timing guarantees, persistence, protocols, public types, supported inputs, and operational behavior.
- Preserve every firm seam and its tests unchanged. Firm means protected, not merely inconvenient.
- A desired behavior change, bug fix, firm-contract change, or change to a firm-seam test is not refactoring. Record it as `escalated-architect`, exclude it from selection, and hand it to `architect`.
- If the current behavior cannot be established, do not guess. Mark the opportunity blocked or route the ambiguity to `architect`.
- Structural soft-seam changes are allowed only when their behavior-preservation argument is explicit and verification can support it.
- Auto-select conventional idiomatic local/private/reversible mechanics. User authority is required only for public contracts, security policy, compatibility/migration, firm seams, irreversible/costly commitments, or meaningful architectural/operational tradeoffs; those leave this workflow rather than becoming refactor questions.

## Phase 0: Establish scope and workspace

Use the scope supplied by the user: a path, component, layer, package, set of targets, or whole stack. Normalize it to concrete repository-relative paths and record both requested and effective scope in `refactor.md`.

If the user omits scope, audit the **whole first-party repository**. Exclude generated code, vendored or third-party code, dependency caches, build outputs, coverage outputs, archives, transient tool state, and `.changes/archive/`. Also honor repository ignore/configuration files. Record every exclusion; do not silently omit a first-party area because it is large.

If no active refactor workspace exists, create it, then initialize `refactor.md` from `references/templates/refactor.md.tmpl`:
```bash
node "$SKILL_DIR/scripts/change-new.mjs" --title "<refactor audit title>" --class refactor
# add --mode audit-only to stop after the report without executing
```

Stable opportunity IDs use `RF-001`, `RF-002`, and so on. Never renumber or reuse an ID after it is persisted.

Before audit:

1. Record HEAD, worktree state, active changes, requested/effective scope, and exclusions.
2. Discover relevant root and component `CONTEXT.md` files with `context-discover.mjs`; read their seams, firm criteria, dependencies, and Known Soft Spots.
3. Detect **all languages present in effective scope**, including mixed-language packages and build/configuration languages that contain first-party logic.
4. For every detected language, load `references/idioms/<language>.md` when present. Record loaded and missing packs. A primary-language shortcut is not allowed.

## Phase 1: Read-only parallel audit

This phase may read code, tests, configuration, docs, history, and tool output. It may write only the maintenance artifacts under `.changes/active/<id>/`. **Do not edit source, configuration, documentation, or tests. Do not add characterization tests yet.**

Run the specialized roles from `references/implementation-review.md` in parallel where tooling permits. Every role is read-only and receives the same effective scope, exclusions, CONTEXT set, firm seams, and relevant idiom packs:

- Scope and architecture mapper
- Behavior and contract guardian
- Structure and dependency reviewer
- Language-idiom reviewer, one per detected language — walk the idiom pack's Power Checklist and Smell List
- Tests and coverage reviewer
- Runtime and operational-risk reviewer when the scope has persistence, concurrency, resources, networking, or deployment behavior

Review deeply where applicable across data/state, data structures, interfaces/traits, errors, security, observability, simplicity, maintainability, and idioms. Actively surface unsafe/panic-prone recoverable paths, swallowed errors, structural bloat, and hygiene issues. Require file-and-symbol evidence, concrete impact, and a bounded alternative, not generic advice. Do not require `N/A` boilerplate. Roles report candidates independently into one opportunity inventory; they do not edit or approve one another's proposals.

## Phase 2: Synthesize and rank

Deduplicate candidates and persist every credible opportunity in `refactor.md` using the shared report schema (stable ID, rank, title, scope, evidence, payoff, behavior-preservation argument, seams/firmness, risk, effort, coverage and gaps, dependencies/conflicts, proposed files, verification, status).

Rank by payoff adjusted for confidence, risk, effort, and dependency order. Do not inflate rankings through speculative abstraction. Move anything outside the local-cleanup boundary to `escalated-architect` before presenting the list. Present the ranked list with a concise recommendation. The audit is complete at this point.

## Phase 3: Explicit selection gate

Ask the user to select exact IDs:

> "Which refactor opportunities do you approve for execution? Reply with the exact `RF-...` IDs, or choose audit-only. No code or test changes will be made until you select them."

Silence, general enthusiasm, the original cleanup request, or approval to continue auditing is not selection. Until the user responds with exact IDs, make **no source, configuration, documentation, or test edits**, including characterization tests.

Record the user's exact selection verbatim, with timestamp, dependency closure, deferrals, and rejections. Mark each selected ranked opportunity `selected` (the exact ID must appear in the verbatim response) and group selected IDs into small batches in `refactor.md`, each selected ID appearing exactly once and no unselected ID appearing. Then approve the selection gate:
```bash
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate refactor --approve
```

This advances the manifest to `stage: implement` and keeps `refactor` as the orchestrator. Do not approve for a vague selection, an incomplete opportunity record, or a mismatched batch assignment.

**Audit-only:** if the user chooses audit-only (or `refactor_mode: audit-only`), stop here — present the report, do not approve the refactor gate, and leave execution undone. Reconcile docs only if the audit revealed inaccurate context.

After selection, before implementation:

1. Recheck the worktree. Pre-existing, foreign, or concurrently changed files overlapping a proposed batch block that batch — ask the user to resolve rather than overwriting or stashing it.
2. Run all relevant existing tests for the selected scope. Any relevant pre-existing failure blocks execution; record it and do not weaken a test to proceed.
3. For selected behavior lacking coverage, add minimal **characterization tests** that pass against the unchanged implementation, and treat them as firm-seam safety nets for this pass. If a characterization test exposes disputed or incorrect behavior, stop — that belongs in `architect`.

## Phase 4: Execute small coherent batches

Execute one batch at a time, each small enough to localize a regression and touching only its declared files for the selected opportunities.

1. Establish the batch's green baseline by running its declared tests against the unchanged implementation.
2. Apply the behavior-preserving change for the selected opportunity IDs only. Change only declared files.
3. Run the declared verification (format/static, firm-seam and characterization tests, targeted and broader tests). It must be green.

Any invariant violation or firm-seam/characterization failure is evidence of behavior change: do not edit the protecting test. Back out this batch if safe; otherwise stop with the exact diff and failure and route the desired change to `architect`. If a selected batch turns out to be a no-op, record why in `refactor.md`; do not manufacture churn.

## Phase 5: Bounded independent review (auditor + verifier)

After all selected batches are green, run exactly one `RV-*` cycle from `references/adversarial-review.md` and `references/implementation-review.md`. The pre-selection `RF-*` opportunity audit is not this post-execution review.

1. A **fresh auditor subagent** makes one broad discovery pass over the complete diff, loading all idiom packs and covering every applicable review dimension. Consolidate all blocker/major findings into one batch in `refactor.md`; each needs stable `RV-NNN`, severity `blocker|major`, category `correctness|security|simplicity|maintainability|idioms`, evidence, concrete impact, and alternative. Record the attestation:
    ```bash
    node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --stage refactor --cycle refactor-1 --role auditor \
      --reviewer "<auditor label>" --verdict changes-requested \
      --finding '{"id":"RV-001","severity":"major","category":"maintainability","location":"<file:line>","impact":"<impact>","alternative":"<alternative>"}'
    ```
   If clean, record an approved auditor attestation and an evidence-based rationale in `refactor.md`.
2. Apply one behavior-preserving remediation for the complete batch; keep every test green. Select local/private/reversible idiomatic fixes automatically. Material or firm-contract findings go to `architect`, not a local fix.
3. Run the complete project verification for the effective scope (format, lint/static, type check, build, tests, firm-seam and characterization tests).
4. A **distinct fresh verifier subagent** checks only the original `RV-*` IDs and preservation evidence. It does not repeat discovery, expand scope, or introduce new low/major findings:
    ```bash
    node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --stage refactor --cycle refactor-1 --role verifier \
      --reviewer "<distinct verifier label>" --verdict approved --resolution RV-001=resolved
    ```
    A remediation-caused blocker regression is the sole new-ID exception: record it with `--regression`, correct it in the same focused scope, and close it with `--regression-resolution` during the one targeted reverification. If any ID remains unresolved or broad review is needed, stop and route upstream rather than extending the cycle.

Present selected/completed/deferred/escalated IDs, changed files, invariant evidence, and test results. Ask explicitly for implement-gate approval; never self-approve it:

```bash
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate implement --approve
```

The gate refuses unless an approved verifier review (backed by a distinct auditor review) is recorded for stage `refactor`.

## Phase 6: Documentation reconciliation

1. Run `context-verify.mjs` for all context targets.
2. Update relevant `CONTEXT.md` Known Soft Spots, dependency descriptions, and soft structural descriptions to match code. A behavior-preserving refactor must not rewrite firm criteria or contracts.
3. Reconcile developer docs describing changed internals, commands, or package layout. Do not churn user-facing behavior docs when behavior did not change.
4. Re-stamp changed CONTEXT provenance at current HEAD, and have a fresh docs reviewer compare claims with code and `refactor.md`.

Ask the user to approve the docs gate, then archive:
```bash
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate docs --approve
node "$SKILL_DIR/scripts/change-archive.mjs" --id <id>
```

The archive must contain the ranked audit, selection record, batch evidence, review records, escalations, and docs reconciliation.

## Stop conditions

Stop execution when any of these occurs:

- No exact opportunity IDs have been selected
- A relevant existing test is failing before implementation
- Dirty or concurrent work overlaps a batch
- Current behavior or the preservation argument is ambiguous
- A firm test, characterization test, or declared invariant fails
- The needed edit exceeds declared files or selected opportunities
- The work would change behavior, a firm contract, or a firm-seam test
- The independent verifier review does not pass

Preserve the artifact and report the blocker. Do not improvise around a gate.

## Reference files

- `references/implementation-review.md` - audit roles, review model, report schema, and escalation boundary
- `references/adversarial-review.md` - bounded cycle, dimensions, and `RV-*` finding contract
- `references/challenge-protocol.md` - materiality and agent-owned local decisions
- `references/seam-and-test-taxonomy.md` - firmness, characterization tests, and the tripwire
- `references/context-schema.md` - CONTEXT structure and seam records
- `references/firm-change-protocol.md` - explains why firm changes leave this workflow
- `references/drift-control.md` - documentation reconciliation rules
- `references/templates/refactor.md.tmpl` - persistent maintenance artifact
- `references/idioms/<language>.md` - load every pack represented in effective scope
