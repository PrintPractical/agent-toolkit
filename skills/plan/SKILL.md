---
name: plan
description: Use after specify approval is approved to inspect relevant source and break confirmed outcomes into a traceable implementation checklist. Produces source-grounded plan.md sections, implementation context, seam-firmness test labels, acceptance-criterion traceability, and prospective implementability review without prescribing private control flow. Do not run unless the specify approval is approved.
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

Before drafting sections, inspect the relevant existing implementation, tests, dependency manifests and lockfiles, nearby conventions, and every applicable `CONTEXT.md`. Record exact source anchors under `Source reconnaissance`. Do not plan from architecture prose alone, and do not treat inspected or expected paths as an allowed-files list.

## Phase 1: Section breakdown

Divide the implementation into logical sections. Rules:
- Each section is independently executable. The implementer reads only the section they're working on.
- Sections map to components, features, or layers — not to arbitrary line counts.
- Each section follows inspect -> test -> implement -> clean -> verify and ends at a clean green baseline. The clean step is bounded local convergence, not a broad refactor or formal review.
- After the last implementation section, the plan has one **review section** (independent review + behavior-preserving refactor over the whole change), then docs reconciliation (non-negotiable).

Choose the conventional section breakdown autonomously. Ask the user only if competing breakdowns cross the materiality boundary; otherwise do not seek acknowledgment for routine decomposition.

## Phase 2: Write plan.md

For each section, from `references/templates/plan.md.tmpl`:

### Implementation context
- State the observable section outcome and `AC-*` IDs.
- State canonical ownership and dependency direction, including any representations intentionally kept distinct.
- Name verified existing mechanisms, types, utilities, standard facilities, and nearby patterns that can be reused.
- Identify domain facts that must evolve together and responsibilities that must remain distinct.
- List expected touchpoints as non-binding orientation, never an allowlist.
- State errors, invariants, and exact verification commands with expected observations.
- Do not prescribe private helpers, exact control flow, exhaustive file lists, or code recipes.

### Test tasks
- Every test task uses separate labels: `[test: baseline|criterion|characterization] [seam: <id>|internal] [firmness: firm|soft]`.
- `baseline` identifies an existing firm-seam safety net that starts and remains green.
- `criterion` covers new or changed behavior and must demonstrate red before implementation.
- `characterization` pins unchanged behavior and starts green.
- At least one test task per **firm** seam touched by this section. Soft-seam test tasks are added as appropriate.
- Test tasks come **before** implementation tasks in each section (red-green discipline).
- Include the specific assertion (what the test must verify) and the planned file path.

### Implementation tasks
- Each task is one concrete, scoped outcome. Name a file or confirmed contract, but do not invent private helpers, types, traits, or decomposition for the implementer.
- Include the target file path.
- Include enough context to identify the required outcome: target path, confirmed contract when any, observable behavior, relevant state transition, validation/error semantics, invariants, and acceptance evidence.
- Leave private helpers, local representations, control flow, and equivalent idiomatic mechanisms to `implement`.
- Give every task a stable `[T-NNN]` ID. Reference each acceptance criterion with `[AC-...]`; firm test tasks must use the standard separate test, seam, and firmness labels.

For example, a persistence task states the validated input, atomicity or ordering guarantee, approved error contract, and observable result. It does not dictate private helpers, a seven-step control-flow recipe, or a function body. `implement` decides the idiomatic source expression.

### Verify task (every section)
- `[ ] Run exact applicable format/lint/typecheck/build/tests — section reaches a clean green baseline`

### Review section tasks (once, after all sections)
- `[ ] Fresh auditor performs one broad applicable discovery pass; record one consolidated RV-NNN blocker/major batch with category, evidence, impact, and alternative`
- `[ ] Apply one behavior-preserving remediation for the complete batch (firm-seam tests stay green)`
- `[ ] Full test suite green after remediation`
- `[ ] Distinct fresh verifier checks only original RV IDs; at most one targeted correction/reverification; record approval with review-log.mjs`

## Phase 3: Prospective implementability review

After drafting all sections, launch one fresh read-only reviewer in a separate context. Give it the plan, governing artifacts, relevant source, tests, dependencies, conventions, CONTEXT, and applicable idiom guidance. It walks each section against source and checks:
- canonical ownership and dependency direction are clear;
- existing standard/repository machinery is surfaced where relevant;
- the plan does not invite accidental parallel representations;
- domain facts that must change together are coordinated;
- distinct responsibilities remain distinct;
- the implementer has enough evidence for an idiomatic implementation without a private code recipe.

Incorporate local findings directly. If review exposes a material ambiguity, use the kickback protocol and involve the user only there. Record the reviewer, source walked, findings incorporated, unresolved material findings, and passed status in `plan.md`. This is one prospective agent-owned review, not a separate user approval or formal `review-log.mjs` cycle.

## Phase 4: Traceability check

Before finalizing, verify:
1. Every soft- and firm-seam acceptance criterion in `architecture.md` and `decisions.md` traces to at least one task.
2. Every firm seam has at least one firm-seam test task.
3. Every approved refactor in `architecture.md` has explicit tasks.
4. Every declared seam has at least one behavioral acceptance criterion and the change has at least one observable completion criterion.

Regenerate the traceability summary in `plan.md`. If any criterion is uncovered, add the missing task, then run:
```
node "$SKILL_DIR/scripts/traceability-sync.mjs" --id <id> --write
```

## Phase 5: Kickback check

If planning exposes one or more missing material decisions, batch them and stop. Tell the user:

> "I found an ambiguity in the decisions that `specify` should have resolved: [description]. I cannot write a reliable plan task for this. Run `specify` to resolve it before I continue."

Log the kickback:
```
  node "$SKILL_DIR/scripts/kickback-log.mjs" --id <id> --type defect --phase plan --impact specify --missed "<description>"
```

Use `--impact specify` when a material decision is missing. Use `--impact plan` when only checklist traceability or task detail must change; that preserves the specify approval. Do not invent answers or continue until the affected artifact is resolved.

## Phase 6: Write the file

Write to: `.changes/active/<id>/plan.md`

## Phase 7: Approval

Present the section count, total task count, firm-seam test count, source-reconnaissance summary, prospective-review result, and traceability results. Ask:

> "Traceability and prospective implementability review passed. Every seam has behavioral criteria and all firm seams have durable test tasks. The deterministic artifact validation will run before approval. Do you approve the plan approval? (This will advance to `implement`.)"

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
