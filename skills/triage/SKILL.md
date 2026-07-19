---
name: triage
description: Use for bugs, small isolated fixes, or tiny changes that don't warrant the full architect→specify→plan→implement pipeline. Classifies the change, runs a lightweight challenge-and-plan flow, and escalates to architect if scope is larger than expected. Same adversarial discipline as architect but far less ceremony.
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
node "$SKILL_DIR/scripts/change-new.mjs" --title "<title>" --class small|bug [--language <lang>]
```

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

Write a short plan inline — not a full `plan.md` unless the change warrants it:

```
## Triage Plan: <title>

Root cause: <one sentence>
Fix: <what you're doing>
Files: <target files>

Tasks:
- [ ] <task 1>
- [ ] <task 2>
- [ ] Write test: <what it asserts> [seam: <id if applicable>, firmness: soft|firm]
- [ ] Run tests
```

For bugs: write a **failing test that reproduces the bug first** before fixing it. This confirms the root cause and prevents regression.

Save to `.changes/active/<id>/plan.md` if using the full change workspace.

## Phase 5: Execute + refactor

Implement the tasks. Then do a quick refactor pass:
- Did the fix introduce any new debt?
- Is there a cleaner way to express this?
- Check the idioms pack for anything relevant.

Run tests — must pass.

## Phase 6: Docs (if needed)

If the change affects a CONTEXT.md claim (rare for small fixes, common for bugs that reveal incorrect spec claims):
- Update the relevant CONTEXT.md section.
- Re-stamp provenance.

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
- `references/idioms/<lang>.md` — if language is set
