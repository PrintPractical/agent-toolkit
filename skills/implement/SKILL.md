---
name: implement
description: Use after plan approval is approved to execute source-grounded plan.md. Records a pre-code approach, runs each section through inspect, test, implement, clean, and verify, then performs one bounded independent RV review before implement approval. Enforces the firm-seam tripwire, logs kickbacks, and reconciles CONTEXT.md. Do not run unless the plan approval is approved.
---

# Implement

You are running the **implement** phase of the agent-toolkit pipeline. Spine phase 4. Your job is to execute `plan.md` faithfully. You make no new decisions about public contracts, security policy, compatibility/migration, firm seams, irreversible/costly commitments, or meaningful architectural/operational tradeoffs. Those are kickbacks. You do select conventional idiomatic local/private/reversible implementation choices.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Your stance

The implementer follows confirmed outcomes and scope. It does not improvise behavior or contracts. Investigate uncertainty first; kick back only when evidence leaves a user-owned material decision unresolved. Private helpers, local data structures, control flow, and equivalent idiomatic mechanisms are implementation choices, not spec defects.

Code quality is still your job. Each section gets a bounded local convergence pass while its context is fresh, but no per-section formal review or broad refactor. The single independent review and behavior-preserving remediation happens once after all sections are green (see `references/implementation-review.md`).

## Preconditions

Load `manifest.yaml`. Verify:
- `phase` is `implement` (plan approval approved).
- `approvals.implement` is `pending`.
- `plan.md` exists.

For feature changes, create `implementation.md` from `references/templates/implementation.md.tmpl` now. Keep its verification and context-reconciliation evidence current; implement approval validates it.

Read `change-brief.md` first, then `plan.md`, the plan's cited `CONTEXT.md` and source anchors, and `references/engineering-fundamentals.md`. If `manifest.language` is set, use the `idioms` skill to load its matching pack for implementation and review. If no matching pack is installed, state that and use repository conventions and tooling.

## The loop: per section (inspect -> test -> implement -> clean -> verify)

Work through `plan.md` one section at a time. For each section:

### Step 1: Inspect and record the approach

Inspect the section's cited implementation, tests, dependencies, conventions, and CONTEXT before editing source. Resolve its non-binding expected touchpoints against repository reality.

Before source edits, add the section's concise approach to `implementation.md`: verified mechanisms to reuse; ownership, dependency, and representation choices; applicable standard language/library facilities; intended responsibility boundaries; and a concrete justification for custom machinery, if any. This is agent-owned and needs no user approval. Update it when evidence changes a local choice and record why; kick back if the change crosses the materiality boundary.

### Step 2: Establish test evidence

Use the standard plan labels:
- `[test: baseline]`: run the existing firm-seam safety net before implementation. It must start green and remain green.
- `[test: criterion]`: add the test for new or changed behavior and demonstrate that it fails for the intended reason before implementation.
- `[test: characterization]`: add or run a test that captures unchanged behavior. It starts green and remains green.

Do not manufacture a failing test for already-supported behavior. Do not edit an existing firm-seam test merely to produce red.

### Step 3: Implement to green

Write the implementation tasks from the plan. Work the checklist top to bottom. Check off each task in `plan.md` as you complete it (update the file with `[x]`). Goal: get all planned test evidence green.

Write soft-seam tests alongside the implementation as planned. Run the targeted tests until the section is green.

### Step 4: Clean and converge locally

While the section context is fresh, make one bounded pass over only the implemented section:
- compare custom code with applicable standard/library and established repository machinery;
- remove accidental parallel representations and duplicated domain facts that must evolve together;
- simplify avoidable nesting or indirect control flow;
- keep cohesive responsibilities together and distinct responsibilities separate;
- remove dead, debug, placeholder, or redundant code introduced by the section.

This is minor behavior-preserving convergence, not a second implementation, scope expansion, or per-section formal review. Do not revisit unrelated code. If convergence requires a material ownership, contract, compatibility, security, migration, or operational decision, kick back instead.

### Step 5: Verify a clean green baseline

Run the section's exact verification, including applicable format, lint, typecheck, build, and tests. Record first-pass lint/typecheck and test results in `implementation.md`, then record the final clean result. Check off the section's verify task and repeat for the next section.

## After all sections complete

### Bounded independent review & behavior-preserving remediation (L3)

This runs **once**, over the whole change, and is required for implement approval. Full detail is in `references/implementation-review.md`.

1. **One broad discovery pass.** Launch a fresh read-only auditor in a separate context. Give it the complete diff, relevant CONTEXT/seams, implementation approaches and deviations, verification evidence, and only idiom packs applicable to the effective scope. Always cover structure/ownership, applicable language idioms, and tests/behavior preservation. Add runtime, security, and operational lenses when the scope makes them relevant. No mandatory `N/A` boilerplate.
2. **One consolidated batch.** Deduplicate all blocker/major findings. Record stable `RV-NNN` IDs in the plan's review table with severity `blocker|major`, category `correctness|security|simplicity|maintainability|idioms`, evidence, concrete impact, and concrete alternative. Do not emit nits or later batches. Attest with:
   ```
node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --phase implement --cycle implement-N --role auditor \
      --reviewer "<auditor label>" --verdict changes-requested \
      --finding '{"id":"RV-001","severity":"major","category":"maintainability","location":"<file:line>","impact":"<impact>","alternative":"<alternative>"}'
   ```
   If clean, record `approved` plus a brief evidence-based rationale in the plan.
3. **One remediation.** Resolve the complete batch behavior-preservingly. Auto-select local/private/reversible idiomatic fixes. Kick back any remediation crossing the materiality boundary. Change only implementation, soft-seam tests, and new characterization tests that pin unchanged behavior before cleanup. Never modify an existing firm-seam test; it must stay green, and failure means STOP and kick back. A major structural rewrite indicates the implementation context or pre-code approach failed upstream; record it in `implementation.md` as a quality signal rather than treating final review as normal design generation.
4. **Full green run.** Run the full applicable suite after remediation.
5. **Focused verification.** Launch a distinct fresh read-only verifier. It checks only the original `RV-*` IDs and preservation evidence. It does not repeat discovery, expand scope, or introduce new low/major findings:
   ```
node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --phase implement --cycle implement-N --role verifier \
      --reviewer "<distinct verifier label>" --verdict approved --resolution RV-001=resolved
   ```
    A remediation-caused blocker regression is the sole new-ID exception: record it with `--regression`, correct it in the same focused scope, and close it with `--regression-resolution` during the one targeted reverification. If any ID remains unresolved or closure needs broad review, stop and kick back rather than extending the cycle.

Record final blocker/major counts by category, post-review remediation diff size, recurring categories, unplanned ownership/representation changes, and orchestrator-reported model/cost data in `implementation.md`. These are measurement signals, not approval heuristics. Recurring major structural repair after prospective planning is evidence that the selected model or route may have reached a capability ceiling; routing a future approach or implementation to a stronger model does not change this generic workflow.

## Kickback protocol

When you encounter:
- An ambiguity the plan did not cover
- A decision at the materiality boundary that the artifacts do not resolve
- A firm-seam test that fails during local cleanup or final remediation (behavior change)
- A conflict between the plan and reality that requires resolving

**STOP IMMEDIATELY.** Do not proceed. Do not improvise.

1. Describe the gap clearly to the user.
2. Classify: is this a `defect` (spec should have caught it) or `amendment` (legitimate new info)?
3. Log the kickback:
```
  node "$SKILL_DIR/scripts/kickback-log.mjs" --id <id> --type defect|amendment --phase implement --impact specify|plan|implementation|epic-specify \
  --missed "<what the spec didn't cover>"
```
    Choose `specify` when a material decision changes, `plan` when only the checklist is stale, and `implementation` when no upstream artifact is invalidated. A child uses `epic-specify` only when an epic cross-cutting contract is wrong. The script records the precise `restart_phase` and `invalidated_approvals`.
4. Tell the user to resume at the recorded phase and re-approve only invalidated approvals.
5. Do not continue this session until the kickback is resolved.

### Docs reconciliation and implement approval

Load `manifest.context_targets` from `manifest.yaml`. For each target CONTEXT.md:
1. Run `context-verify.mjs` for baseline:
```
node "$SKILL_DIR/scripts/context-verify.mjs" --path <context-file> --run-tests
```
2. Diff `architecture.md` + `decisions.md` against the CONTEXT.md. What changed?
3. Update the CONTEXT.md to reflect this change:
   - New seams with firmness tags
   - Updated interfaces/contracts
   - New glossary terms
   - New acceptance criteria for modified seams; durable enforcement citations remain required for firm seams
   - Updated `Known-soft-spots` (add any tech debt introduced; remove any addressed)
   - Re-stamp provenance: `Provenance: validated-at: <current HEAD sha>`
4. Run a verifier subagent:
> "Compare these CONTEXT.md files against the implementation. Do the claims match the code? List any discrepancy."

5. In Git, commit the reconciled scope, then update only each final provenance footer with the resulting full HEAD SHA. Outside Git, retain `<not-in-git-repo>`. Run `context-verify.mjs --run-tests` after reconciliation and address its findings.
6. Present the reconciliation summary. Address any verifier findings.

When all sections are green, the bounded review/remediation is done, and documentation is reconciled and verified, ask the user:
> "All implementation sections are complete, tests pass, the independent review is approved, and CONTEXT.md is reconciled. Do you approve the implement approval?"

On approval:
```
node "$SKILL_DIR/scripts/manifest-approval.mjs" --id <id> --approval implement --approve
```

The approval refuses unless an approved verifier review (backed by a distinct auditor review) exists and `context-verify.mjs` passes for every context target.

### Archive-ready and verified archive

```
node "$SKILL_DIR/scripts/change-archive.mjs" --id <id>
```

Run this only after the implement approval has moved the change to `archive-ready`. The change is terminal only once archive verification succeeds and the zip is in `.changes/archive/<id>.zip`.

To cancel instead, record a concrete `archive.reason` in `manifest.yaml` and archive the current artifacts rather than deleting them.

## Firm-seam tripwire (summary)

**Never edit a firm-seam test to make a refactor pass.** That is the tripwire. It means:
- The refactor is not a pure refactor (behavior changed) → record an escalation with `--impact architect`, then hand off to a new architect-class change.
- Or the firm seam itself needs to change → this requires the full firm-change protocol (see `references/firm-change-protocol.md`), a `Firm-Change:` kickback, and scoped re-approval of affected approvals.

## Reference files

- `references/implementation-review.md` — bounded independent implementation review and review record
- `references/adversarial-review.md` — bounded cycle, review dimensions, and `RV-*` finding contract
- `references/seam-and-test-taxonomy.md` — firm/soft test rules, tripwire
- `references/manifest-schema.md` — kickback types
- `references/change-lifecycle.md` — docs reconciliation + archive
- `references/firm-change-protocol.md` — if a firm seam must change
- `references/drift-control.md` — CONTEXT.md update rules
- `idioms` skill — matching implementation and review guidance
- `references/engineering-fundamentals.md` — cross-language data, state, abstraction, and bounded-resource guidance
