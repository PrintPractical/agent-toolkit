---
name: triage
description: Use for bugs, small isolated fixes, or tiny changes that do not warrant the full architect→specify→plan→implement pipeline. Classifies scope, runs a lightweight plan, then requires snapshot-bound independent review and cleanup before approval. Escalates larger work to architect.
---

# Triage

You are running the **triage** entry ramp. Use this for bugs, small fixes, and changes that touch a single component with no new seams and no interface changes. If you discover the change is larger, escalate to `architect`.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Your stance

Same adversarial discipline as `architect` — read `references/challenge-protocol.md`. Triage is not a shortcut for skipping thought. It is a shorter path when the thought genuinely does not take long.

## Preconditions

Check for an active change:
```
node "$SKILL_DIR/scripts/change-status.mjs"
```

If no active change, create one:
```
node "$SKILL_DIR/scripts/change-new.mjs" --title "<title>" --class bug [--language <lang>]
# Use --class small instead for a bounded non-bug change.
```

Load the active `manifest.yaml`. If `manifest.language` is set and `references/idioms/<lang>.md` exists, load it for the challenge and refactor passes. If no matching pack exists, state that and use the repository's language conventions and tooling rather than assuming pack guidance.

## Phase 1: Classify

Answer these questions before doing anything else:

1. **Is this isolated to a single component?** If it touches multiple components or crosses component boundaries → escalate to `architect`.
2. **Does it introduce a new seam or change an existing interface?** If yes → escalate to `architect`.
3. **Does it touch a firm seam?** If yes: is the change *within* the firm contract (implementation change, not contract change) or does it *alter* the contract? If it alters the contract → escalate to `architect` and apply the firm-change protocol.
4. **Is the fix clear and bounded?** If not → escalate to `architect`.

If escalating:
> "This change is larger than triage scope because: [reason]. I'll start an architect session instead."

Create a new manifest with `--class feature` and proceed with `architect`.

## Phase 2: Quick context

Read only what's necessary:
- The component's `CONTEXT.md` (if it exists)
- The relevant source files (not the whole codebase)
- Any firm seam the change touches (confirm we're not changing the contract)

Note any `Known-soft-spots` in the CONTEXT that are relevant. If the fix touches a known soft spot and a better solution exists, surface it — but get explicit approval before scope-expanding.

## Phase 3: Challenge and confirm

One or two focused questions — not a full interview, but enough to confirm the fix is right:
- What is the root cause? (Not just the symptom)
- Is this the right fix, or a workaround for a deeper issue?
- Are there other callers or consumers affected?
- If touching an idiom smell: is there a cleaner approach in the idioms pack?

## Phase 4: Quick plan

Write a short plan and persist it to `.changes/active/<id>/plan.md`:

```
## Triage Plan: <title>

Root cause: <one sentence>
Fix: <what you're doing>
Files: <target files>
> **Checkpoint unit:** T-001
> **Editable files:** `["<exact implementation path>", "<disposable soft-test path>"]`
> **Locked test files:** `["<exact behavioral or firm test path>"]`
> **Observable invariants:** <behavior the cleanup must preserve>
> **Baseline command:** `<exact command>`
> **Final command:** `<exact command>`

Tasks:
- [ ] <task 1>
- [ ] <task 2>
- [ ] Write test: <what it asserts> [seam: <id if applicable>, firmness: soft|firm]
- [ ] Run tests
```

For bugs: write a **failing test that reproduces the bug first** before fixing it. This confirms the root cause and prevents regression.

The plan's machine-readable `Checkpoint unit: T-001` marker must exactly match its one declaration in `.changes/active/<id>/implementation-units.json`. This exact path is the only valid source; do not pass inline JSON or another file. The plan's editable and locked path fields are exact JSON arrays inside code spans. The JSON object requires `id`, exact `files`, `lockedTestFiles`, exact `baselineCommand`, and exact `finalCommand`, and every value must match the plan. Initialize before implementation edits:
```
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --init \
  --units .changes/active/<id>/implementation-units.json
```

Initialization requires Git with a valid HEAD. Because triage begins with a preapproved plan gate, initialization captures and binds that plan's execution-contract digest, then binds the manifest's integer `checkpoint_epoch`, initialization HEAD/worktree, and canonical declaration digest. A path may be shared across units (e.g., a central file modified per section). A file cannot be both editable and locked across units. On resume, inspect `--status`; do not reinitialize or hand-edit checkpoint state.

## Phase 5: Execute + independent review + cleanup

Implement the tasks. For bugs, the regression test is red before the fix and green afterward. Once implementation is complete, establish the green snapshot:
```
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit T-001 \
  --baseline-test --command "<exact declared baselineCommand>"
```

The first green snapshot makes every declared cycle lock immutable. If a locked test changes, restore it or kick back; escalate to `architect` when resolving it exceeds triage scope. Do not rebaseline the changed lock.

Launch a fresh read-only critic with the plan, green code, adjacent context, CONTEXT seams, tests, and idiom pack, but not the producer's rationale. Require the structured initial report from `references/implementation-review.md`, including a stable nonempty self-declared `reviewerId`. Correctness blockers require implementation correction, a new green snapshot, and fresh review. Contract, scope, or architectural findings escalate to `architect`.

Bind the accepted report and open cleanup:
```
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit T-001 \
  --initial-review --review <initial-review.json>
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit T-001 --start-refactor
```

Resolve local cleanup findings and check whether the fix introduced debt or missed an idiomatic simplification. Preserve behavior established by the completed fix; firm and cycle-locked regression tests cannot change during cleanup. Then run final checks and obtain a fresh read-only final review whose stable nonempty self-declared `reviewerId` differs from the initial reviewer's ID:
```
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit T-001 \
  --final-test --command "<exact declared finalCommand>" [--no-change-rationale "<concrete reason>"]
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --unit T-001 \
  --final-review --review <final-review.json>
node "$SKILL_DIR/scripts/implementation-checkpoint.mjs" --id <id> --check-all
```

Any edit after testing or review invalidates the evidence and requires retest/re-review. Do not approve implementation unless `--check-all` passes.

## Phase 6: Docs (if needed)

If the change affects a CONTEXT.md claim (rare for small fixes, common for bugs that reveal incorrect spec claims):
- Update the relevant CONTEXT.md section.
- Re-stamp provenance.

Docs approval reruns checkpoint freshness. Only manifest-declared CONTEXT targets may change after implementation approval; source, lock, index, or unrelated-path drift blocks the gate.

## Phase 7: Archive

Approve the docs gate (even if no CONTEXT changes — the gate is always required):
```
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate implement --approve
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate docs --approve
node "$SKILL_DIR/scripts/change-archive.mjs" --id <id>
```

## Escalation conditions (summary)

Escalate to `architect` when any of these are true:
- Touches more than one component
- Adds or removes a seam
- Changes an interface (even slightly)
- Touches a firm seam's contract
- Fix requires a refactor of meaningful scope
- Root cause analysis reveals a deeper architectural issue

Do not be heroic about keeping something in triage. A legitimate escalation is not failure — it is honest scoping.

## Reference files

- `references/challenge-protocol.md`
- `references/context-schema.md` — for reading CONTEXT.md
- `references/seam-and-test-taxonomy.md`
- `references/firm-change-protocol.md` — if a firm seam is involved
- `references/implementation-review.md` — reviewer separation, phases, and report schema
- `references/idioms/<lang>.md` — if language is set
