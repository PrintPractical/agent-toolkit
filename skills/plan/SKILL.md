---
name: plan
description: Use after specify approval is approved to break confirmed outcomes into a traceable implementation checklist. Produces plan.md with sections, seam-firmness test labels, acceptance-criterion traceability, and one bounded review cycle without prescribing private control flow. Do not run unless the specify approval is approved.
---

# Plan

You are running the **plan** phase of the agent-toolkit pipeline. Spine phase 3. Your job is to decompose confirmed `architecture.md` + `decisions.md` decisions into a complete, detailed task checklist in `plan.md`. No unresolved material ambiguity survives into `implement`.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Your stance

No architectural decisions are made here. If you encounter an ambiguity that should have been resolved in `specify`, flag it and tell the user to run `specify` again (kickback). Do not invent answers.

The plan must give an implementer the required context, observable outcome, constraints, and verification for each section without deciding private implementation mechanics.

The plan is a functional specification, not an implementation artifact. Describe externally relevant inputs, outputs, state transitions, validation, errors, invariants, ordering guarantees, and acceptance evidence. Do **not** prescribe private control flow, helper decomposition, local data structures, internal call sequences, source-code bodies, language-shaped pseudocode, or fenced source-code blocks. Name public/confirmed symbols and include a one-line signature only when `decisions.md` fixed that contract. The implementer selects conventional idiomatic local/private/reversible mechanics.

## Preconditions

Load `manifest.yaml`. Verify:
- `phase` is `plan` (specify approval approved).
- `approvals.plan` is `pending`.
- Both `architecture.md` and `decisions.md` exist.

If preconditions fail, tell the user what's wrong.

Load `change-brief.md` first, then open `architecture.md` and `decisions.md` only for the decisions or seams needed by the plan. Read `references/engineering-fundamentals.md`. Use the `idioms` skill for every language represented in scope when available; if a pack is unavailable, use repository conventions and tooling. Use this guidance to avoid planning against the language, not to micromanage private expression.

## Phase 1: Section breakdown

Divide the implementation into logical sections. Rules:
- Each section is independently executable. The implementer reads only the section they're working on.
- Sections map to components, features, or layers — not to arbitrary line counts.
- Each section ends at a green test baseline (no per-section refactor).
- After the last implementation section, the plan has one **review section** (independent review + behavior-preserving refactor over the whole change), then docs reconciliation (non-negotiable).

Choose the conventional section breakdown autonomously. Ask the user only if competing breakdowns cross the materiality boundary; otherwise do not seek acknowledgment for routine decomposition.

## Phase 2: Write plan.md

For each section, from `references/templates/plan.md.tmpl`:

### Test tasks
- At least one test task per **firm** seam touched by this section. Label: `[seam: <id>, firmness: firm]`
- Soft-seam test tasks as appropriate. Label: `[seam: internal, firmness: soft]`
- Test tasks come **before** implementation tasks in each section (red-green discipline).
- Include the specific assertion (what the test must verify) and the planned file path.

### Implementation tasks
- Each task is one concrete, scoped outcome. Name a file or confirmed contract, but do not invent private helpers, types, traits, or decomposition for the implementer.
- Include the target file path.
- Include enough context to identify the required outcome: target path, confirmed contract when any, observable behavior, relevant state transition, validation/error semantics, invariants, and acceptance evidence.
- Leave private helpers, local representations, control flow, and equivalent idiomatic mechanisms to `implement`.
- Give every task a stable `[T-NNN]` ID. Reference each acceptance criterion with `[AC-...]`; firm test tasks must also use `[seam: <id>] [firmness: firm]`.

For example, a persistence task states the validated input, atomicity or ordering guarantee, approved error contract, and observable result. It does not dictate private helpers, a seven-step control-flow recipe, or a function body. `implement` decides the idiomatic source expression.

### Verify task (every section)
- `[ ] Run tests — section reaches a green baseline`

### Review section tasks (once, after all sections)
- `[ ] Fresh auditor performs one broad applicable discovery pass; record one consolidated RV-NNN blocker/major batch with category, evidence, impact, and alternative`
- `[ ] Apply one behavior-preserving remediation for the complete batch (firm-seam tests stay green)`
- `[ ] Full test suite green after remediation`
- `[ ] Distinct fresh verifier checks only original RV IDs; at most one targeted correction/reverification; record approval with review-log.mjs`

## Phase 3: Traceability check

Before finalizing, verify:
1. Every acceptance criterion in `architecture.md` and `decisions.md` traces to at least one task.
2. Every firm seam has at least one firm-seam test task.
3. Every approved refactor in `architecture.md` has explicit tasks.

Regenerate the traceability summary in `plan.md`. If any criterion is uncovered, add the missing task, then run:
```
node "$SKILL_DIR/scripts/traceability-sync.mjs" --id <id> --write
```

## Phase 4: Kickback check

If planning exposes one or more missing material decisions, batch them and stop. Tell the user:

> "I found an ambiguity in the decisions that `specify` should have resolved: [description]. I cannot write a reliable plan task for this. Run `specify` to resolve it before I continue."

Log the kickback:
```
  node "$SKILL_DIR/scripts/kickback-log.mjs" --id <id> --type defect --phase plan --impact specify --missed "<description>"
```

Use `--impact specify` when a material decision is missing. Use `--impact plan` when only checklist traceability or task detail must change; that preserves the specify approval. Do not invent answers or continue until the affected artifact is resolved.

## Phase 5: Write the file

Write to: `.changes/active/<id>/plan.md`

## Phase 6: Approval

Present the section count, total task count, firm-seam test count, and traceability check results. Ask:

> "Traceability check passed. All firm seams have test tasks. The deterministic artifact validation will run before approval. Do you approve the plan approval? (This will advance to `implement`.)"

On approval:
```
node "$SKILL_DIR/scripts/manifest-approval.mjs" --id <id> --approval plan --approve
```

Tell the user: **run `implement` next.**

## Reference files

- `references/seam-and-test-taxonomy.md` — firmness model, test task labeling rules
- `references/manifest-schema.md` — kickback logging
- `references/change-lifecycle.md` — what implement expects
- `references/adversarial-review.md` — bounded review cycle and `RV-*` findings
- `references/templates/plan.md.tmpl`
- `idioms` skill — load every available pack represented in scope
- `references/engineering-fundamentals.md` — cross-language data, state, abstraction, and bounded-resource guidance
