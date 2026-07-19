---
name: plan
description: Use after specify gate is approved to break implementation decisions into a detailed, traceable task checklist. Produces plan.md with sections, test tasks labeled by seam firmness, traceability from acceptance criteria to tasks, and refactor cycles. Detailed enough for a cost-optimized model to execute. Do not run unless the specify gate is approved.
---

# Plan

You are running the **plan** stage of the agent-toolkit pipeline. Spine stage 3. Your job is to decompose `architecture.md` + `decisions.md` into a complete, detailed task checklist in `plan.md`. No ambiguity survives into `implement`.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Your stance

No architectural decisions are made here. If you encounter an ambiguity that should have been resolved in `specify`, flag it and tell the user to run `specify` again (kickback). Do not invent answers.

The plan must be detailed enough for a cost-optimized model (smaller, cheaper) to execute correctly without any additional context. Assume the implementer will read *only* the section they're working on.

## Preconditions

Load `manifest.yaml`. Verify:
- `stage` is `plan` (specify gate approved).
- `gates.plan` is `pending`.
- Both `architecture.md` and `decisions.md` exist.

If preconditions fail, tell the user what's wrong.

Load `architecture.md` and `decisions.md` fully.

## Phase 1: Section breakdown

Divide the implementation into logical sections. Rules:
- Each section is independently executable. The implementer reads only the section they're working on.
- Sections map to components, features, or layers — not to arbitrary line counts.
- Each section ends with a refactor cycle + green test check.
- The final section is always docs reconciliation (non-negotiable).

Present the proposed section breakdown to the user before writing the full plan. Get acknowledgment.

## Phase 2: Write plan.md

For each section, from `references/templates/plan.md.tmpl`:

### Test tasks
- At least one test task per **firm** seam touched by this section. Label: `[seam: <id>, firmness: firm]`
- Soft-seam test tasks as appropriate. Label: `[seam: internal, firmness: soft]`
- Test tasks come **before** implementation tasks in each section (red-green discipline).
- Include the specific assertion (what the test must verify) and the planned file path.

### Implementation tasks
- Each task is one concrete action: create a file, add a function, modify a struct, implement a trait, etc.
- Include the target file path.
- Include enough detail that a cheap model can execute it without context: what to add, what signature, what the function does, which error types to use.
- Reference the decision or acceptance criterion being implemented: `(implements [SEAM-<id>])` or `(per decisions.md Q<n>)`.

### Refactor cycle tasks (required for every section)
- `[ ] Review <section> implementation: identify poor choices, repetitive code, deep functions, idioms violations`
- `[ ] Apply refactors (soft-seam tests may be rewritten; firm-seam tests must remain green)`
- `[ ] Run tests — must pass before moving to next section`

## Phase 3: Traceability check

Before finalizing, verify:
1. Every acceptance criterion in `architecture.md` and `decisions.md` traces to at least one task.
2. Every firm seam has at least one firm-seam test task.
3. Every approved refactor in `architecture.md` has explicit tasks.

Fill the traceability table in `plan.md`. If any criterion is uncovered, add the missing task.

## Phase 4: Kickback check

If during planning you find a decision that was not made (a real ambiguity), you must stop and tell the user:

> "I found an ambiguity in the decisions that `specify` should have resolved: [description]. I cannot write a reliable plan task for this. Run `specify` to resolve it before I continue."

Log the kickback:
```
node "$SKILL_DIR/scripts/kickback-log.mjs" --id <id> --type defect --stage plan --missed "<description>" --resolution "pending"
```

Do not invent answers. Do not continue until the ambiguity is resolved.

## Phase 5: Write the file

Write to: `.changes/active/<id>/plan.md`

## Phase 6: Gate

Present the section count, total task count, firm-seam test count, and traceability check results. Ask:

> "Traceability check passed. All firm seams have test tasks. Do you approve the plan gate? (This will advance to `implement`.)"

On approval:
```
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate plan --approve
```

Tell the user: **run `implement` next.**

## Reference files

- `references/seam-and-test-taxonomy.md` — firmness model, test task labeling rules
- `references/manifest-schema.md` — kickback logging
- `references/change-lifecycle.md` — what implement expects
- `references/templates/plan.md.tmpl`
