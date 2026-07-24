---
name: implement
description: Use after plan gate approval to execute plan.md through snapshot-bound green, independent review, behavior-preserving cleanup, testing, and final verification checkpoints. Enforces firm and cycle-locked tests, logs kickbacks, and reconciles CONTEXT.md. Do not run unless the plan gate is approved.
---

# Implement

You are running the **implement** stage of the agent-toolkit pipeline. Spine stage 4. Execute `plan.md` faithfully. Product, contract, scope, and architectural decisions are kickbacks. Local behavior-preserving quality decisions inside declared section files are required.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Your stance

The implementer does not improvise observable behavior, public or firm contracts, persistence formats, dependencies, security/concurrency policy, or cross-scope design. It does make bounded behavior-preserving cleanup decisions such as internal naming, simplification, deduplication, local extraction, dead-code removal, and idiomatic expression. Read `references/implementation-review.md` for the exact boundary.

The producer never certifies its own work. Every section is bound to a content snapshot and passes through a fresh read-only critic before cleanup and a fresh read-only verifier afterward.

## Preconditions

Load `manifest.yaml` and require integer `checkpoint_epoch`. There are two valid states:
- Implementation: `stage: implement`, `gates.implement: pending`, plan gate approved, and `plan.md` exists.
- Docs reconciliation re-entry: `stage: implement`, `gates.implement: approved`, and `gates.docs: pending`. Skip directly to docs reconciliation.

If `manifest.language` is set and `references/idioms/<lang>.md` exists, load it for the refactor cycles. If no matching pack exists, state that and use the repository's language conventions and tooling rather than assuming pack guidance.

## Initialize section checkpoints

Before implementation edits, read every machine-readable `Checkpoint unit` marker in `plan.md`. Its complete ID set must exactly equal the declarations in `.changes/active/<id>/implementation-units.json`: no missing, extra, or duplicate section IDs. Editable and locked path fields are exact JSON arrays in `plan.md`; they and both commands must match the canonical declaration. This exact path is the only valid declaration source for a manifest-backed workflow; do not pass inline JSON or another file.

Each JSON object requires `id`, exact `files`, `lockedTestFiles`, exact `baselineCommand`, and exact `finalCommand`, with the command values matching that plan section verbatim. Lock firm-seam tests and behavioral safety/regression tests that must not change during cleanup; leave intentionally disposable structural tests in editable `files`.

Initialize once:
```
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --init \
  --units .changes/active/<id>/implementation-units.json
```

Initialization requires Git with a valid HEAD and binds state to `manifest.checkpoint_epoch`, the plan-gate-approved contract digest, and a digest of the canonical declarations. Each path has one unit owner. The script rejects staged content that differs from the reviewed worktree and edits to another unit outside its cycle. On ordinary resume, use `--status`; never reinitialize or hand-edit `implementation-state.json`. A section is complete only when its unit is `verified`.

## The checkpointed loop: per section

Work through `plan.md` one section at a time. Give each reviewer the section contract, completed code, tests, adjacent code needed to evaluate it, relevant CONTEXT seams, and idiom pack. Do not give it the producer's rationale or ask it to edit.

### Step 1: Write firm-seam tests first

Find all test tasks labeled `[firmness: firm]` in this section. Write those tests first. They must be **red** (failing) before any implementation code is written. This is non-negotiable.

### Step 2: Implement to green

Write the implementation tasks from the plan. Work the checklist top to bottom. Check off each task in `plan.md` as you complete it (update the file with `[x]`). Goal: get firm-seam tests green.

### Step 3: Write soft-seam tests and establish green

Write any test tasks labeled `[firmness: soft]` in this section. Run the section's declared baseline command through the checkpoint script:
```
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit <section-id> \
  --baseline-test --command "<exact declared baselineCommand>"
```

The command must exactly match the declaration and pass. This binds the completed pre-cleanup implementation and locks declared safety tests. The first green lock snapshot is immutable for the epoch. If any locked test later changes, restore its baseline content or kick back; never run a new baseline to accept the changed lock.

### Step 4: Independent initial review

Launch a fresh read-only critic. It must check correctness, contract adherence, repetition, naming, unnecessary abstractions, responsibility, control flow, error handling, comments, test quality, and applicable idioms. Persist versioned JSON matching `references/implementation-review.md`, including a stable nonempty self-declared `reviewerId`, reviewer role, checks performed, file/line findings, dispositions, and the exact green snapshot.

- `blocking` correctness findings return the section to implementation. After any correction, rerun the green command and obtain a fresh review.
- `kickback` findings stop the workflow and use `kickback-log.mjs`; the checkpoint rejects a kickback marked locally resolved in review JSON.
- `cleanup` findings are carried into the refactor pass.
- No findings is valid only with substantive checks and a concrete rationale.

Bind the accepted review, then open cleanup as separate invocations:
```
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit <section-id> \
  --initial-review --review <initial-review.json>
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit <section-id> --start-refactor
```

### Step 5: Behavior-preserving cleanup

Resolve the initial cleanup findings and independently inspect for dead code, repetition, unclear responsibilities, obscured flow, idiom violations, poor error handling, and reachable placeholders. Change only declared files.

Apply refactors. Rules during refactor:
- **Firm-seam tests must remain green at all times.** If a firm-seam test fails after a refactor, STOP. This is not a test problem — the refactor changed behavior. That means it is not a pure refactor. Kickback (see below).
- Cycle-locked tests are equally immutable until verification. Soft-seam tests not locked may be rewritten to match new structure.
- Never force churn. If review proves no cleanup is warranted, record a substantive no-change rationale.

### Step 6: Final tests and fresh verification

Run the section's exact declared targeted and broader checks through `--final-test`. Then launch a fresh read-only final reviewer, distinct from the producer and initial critic. Its stable nonempty self-declared `reviewerId` must differ from the unit's initial reviewer ID; identity is self-declared, but accidental reuse is blocked. It compares the tested snapshot to the section contract and green baseline and must return `behavior-preserved` with no unresolved blocking or kickback findings.
```
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit <section-id> \
  --final-test --command "<exact declared finalCommand>" [--no-change-rationale "<why no edit was warranted>"]
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit <section-id> \
  --final-review --review <final-review.json>
```

Any edit after final testing or review invalidates the snapshot. Correct local findings, retest, and obtain another fresh review. If fixing requires a decision, kick back.

### Step 7: Mark section complete

Only after the unit reaches `verified`, check off its independent review, cleanup, test, and final verification tasks in `plan.md`.

Repeat for each section.

## Kickback protocol

When you encounter:
- An ambiguity the plan did not cover
- A decision you'd have to make (any non-trivial choice)
- A firm-seam test that fails during a refactor (behavior change)
- A conflict between the plan and reality that requires resolving

**STOP IMMEDIATELY.** Do not proceed. Do not improvise.

1. Describe the gap clearly to the user.
2. Classify: is this a `defect` (spec should have caught it) or `amendment` (legitimate new info)?
3. Log the kickback:
```
node "$SKILL_DIR/scripts/kickback-log.mjs" --id <id> --type defect|amendment --stage implement \
  --missed "<what the spec didn't cover>"
```
   This records an unresolved kickback, increments `manifest.checkpoint_epoch`, returns the stage to `specify`, and resets `specify`, `plan`, `implement`, and `docs` to `pending`. Existing checkpoint state and the old approved contract digest are now stale.
4. Tell the user: **run `specify` to resolve this, then re-run `plan` to update the checklist, then resume `implement`.**
5. Do not continue this session until the kickback is resolved.

After the kickback has a resolution and the amended specify and plan gates are re-approved, ensure every amended `Checkpoint unit` marker matches the canonical declarations, then reset through the only supported recovery path:
```
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --reset \
  --units .changes/active/<id>/implementation-units.json
```

`--reset` archives prior checkpoint state and reviews and initializes amended state bound to the incremented epoch and new declaration digest. Never delete, overwrite, or hand-edit state/reviews to resume. A cycle lock changed before the kickback cannot be rebaselined as ordinary cleanup; restore it unless the approved amendment explicitly changes its declaration.

## After all sections complete

### Implement gate

Require script-backed evidence before asking for approval:
```
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --check-all
```

When all non-reconciliation tasks are checked off and every unit is verified and current:

> "All implementation sections are complete and tests pass. Do you approve the implement gate?"

```
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate implement --approve
```

### Docs reconciliation (docs gate)

Load `manifest.context_targets` from `manifest.yaml`. For each target CONTEXT.md:
1. Run `context-verify.mjs` for baseline:
```
node "$SKILL_DIR/scripts/context-verify.mjs" --path <context-file>
```
2. Diff `architecture.md` + `decisions.md` against the CONTEXT.md. What changed?
3. Update the CONTEXT.md to reflect this change:
   - New seams with firmness tags
   - Updated interfaces/contracts
   - New glossary terms
   - New acceptance criteria (if firm seams were added)
   - Updated `Known-soft-spots` (add any tech debt introduced; remove any addressed)
   - Re-stamp provenance: `Provenance: validated-at: <current HEAD sha>`
4. Run a verifier subagent:
> "Compare these CONTEXT.md files against the implementation. Do the claims match the code? List any discrepancy."

5. Present the reconciliation summary. Address any verifier findings.

Ask the user:
> "CONTEXT.md files have been updated and verified. Are you happy with this change? (Approving the docs gate will archive the change.)"

On approval:
```
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate docs --approve
```

The docs gate reruns checkpoint freshness and permits post-implementation changes only to manifest `context_targets`. Any source, lock, index, or undeclared-file drift must return to the implementation cycle.

### Archive

```
node "$SKILL_DIR/scripts/change-archive.mjs" --id <id>
```

The change is done. The archive zip is in `.changes/archive/<id>.zip`.

## Firm-seam tripwire (summary)

**Never edit a firm-seam test to make a refactor pass.** That is the tripwire. It means:
- The refactor is not a pure refactor (behavior changed) → kickback to `specify`.
- Or the firm seam itself needs to change → this requires the full firm-change protocol (see `references/firm-change-protocol.md`), a `Firm-Change:` kickback, and re-approval of the specify + plan gates.

## Reference files

- `references/seam-and-test-taxonomy.md` — firm/soft test rules, tripwire
- `references/manifest-schema.md` — kickback types
- `references/change-lifecycle.md` — docs reconciliation + archive
- `references/firm-change-protocol.md` — if a firm seam must change
- `references/drift-control.md` — CONTEXT.md update rules
- `references/implementation-review.md` — checkpoint phases, reviewer roles, and report schema
- `references/idioms/<lang>.md` — refactor cycle guidance
