---
name: implement
description: Use after plan gate is approved to execute the task checklist in plan.md. Follows red-green-refactor discipline per section, enforces the firm-seam test tripwire, logs kickbacks on flaws, and reconciles CONTEXT.md files when done. Do not run unless the plan gate is approved.
---

# Implement

You are running the **implement** stage of the agent-toolkit pipeline. Spine stage 4. Your job is to execute `plan.md` faithfully. You make **zero decisions** here. If something requires a decision, stop — that is a kickback.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Your stance

The implementer follows the plan. It does not interpret, improvise, or "make reasonable assumptions." Any ambiguity encountered is a defect in the spec process and triggers a kickback. The plan was written to be detailed enough that you should never need to guess.

However: the refactor cycle is not optional. Code quality is part of your job. After implementing each section, you look critically at what you wrote and improve it using the idioms pack — before moving to the next section.

## Preconditions

Load `manifest.yaml`. Verify:
- `stage` is `implement` (plan gate approved).
- `gates.implement` is `pending`.
- `plan.md` exists.

If `manifest.language` is set and `references/idioms/<lang>.md` exists, load it for the refactor cycles. If no matching pack exists, state that and use the repository's language conventions and tooling rather than assuming pack guidance.

## The loop: per section

Work through `plan.md` one section at a time. For each section:

### Step 1: Write firm-seam tests first

Find all test tasks labeled `[firmness: firm]` in this section. Write those tests first. They must be **red** (failing) before any implementation code is written. This is non-negotiable.

### Step 2: Implement to green

Write the implementation tasks from the plan. Work the checklist top to bottom. Check off each task in `plan.md` as you complete it (update the file with `[x]`). Goal: get firm-seam tests green.

### Step 3: Write soft-seam tests

Write any test tasks labeled `[firmness: soft]` in this section.

### Step 4: Refactor cycle

This is mandatory. Review the section's implementation:
- Dead code, unused variables, unused imports
- Repetitive code that should be extracted into a named function
- Functions or modules carrying multiple responsibilities that would become clearer with named boundaries
- Control flow whose nesting or branching obscures invariants, error paths, or the main operation
- Idioms violations from the idioms pack (if language is set)
- Missing error handling for paths that can fail
- Reachable placeholders, unconditional failures, or suppressed errors that are not part of an approved fail-fast policy

Apply refactors. Rules during refactor:
- **Firm-seam tests must remain green at all times.** If a firm-seam test fails after a refactor, STOP. This is not a test problem — the refactor changed behavior. That means it is not a pure refactor. Kickback (see below).
- Soft-seam tests may be rewritten to match the new structure. This is expected.

### Step 5: Run tests — must pass

Run the full test suite (or the relevant subset if the project supports it). Tests must pass before moving to the next section. If they fail, fix them. If fixing requires a decision that's not in the plan, kickback.

### Step 6: Mark section complete

Check off the refactor cycle and test run tasks in `plan.md`.

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
   This records an unresolved kickback, returns the stage to `specify`, and resets the `specify` and `plan` gates to `pending`.
4. Tell the user: **run `specify` to resolve this, then re-run `plan` to update the checklist, then resume `implement`.**
5. Do not continue this session until the kickback is resolved.

## After all sections complete

### Implement gate

When all non-reconciliation tasks are checked off and tests pass:

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
- `references/idioms/<lang>.md` — refactor cycle guidance
