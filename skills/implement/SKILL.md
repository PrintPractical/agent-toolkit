---
name: implement
description: Use after plan approval is approved to execute plan.md. Implements each section to a green baseline, then runs one bounded independent RV review and behavior-preserving remediation over the whole change before the implement approval. Enforces the firm-seam tripwire, logs kickbacks, and reconciles CONTEXT.md. Do not run unless the plan approval is approved.
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

Code quality is still your job, but it is **not** reviewed per section. Each section reaches a green baseline; the single bounded review and behavior-preserving remediation happens once after all sections are green (see `references/implementation-review.md`).

## Preconditions

Load `manifest.yaml`. Verify:
- `phase` is `implement` (plan approval approved).
- `approvals.implement` is `pending`.
- `plan.md` exists.

Read `change-brief.md` first, then `references/engineering-fundamentals.md`. If `manifest.language` is set, use the `idioms` skill to load its matching pack for implementation and review. If no matching pack is installed, state that and use repository conventions and tooling.

## The loop: per section (implement → tests green)

Work through `plan.md` one section at a time. For each section:

### Step 1: Write firm-seam tests first

Find all test tasks labeled `[seam: <id>] [firmness: firm]` in this section. Write those tests first. They must be **red** (failing) before any implementation code is written. This is non-negotiable.

### Step 2: Implement to green

Write the implementation tasks from the plan. Work the checklist top to bottom. Check off each task in `plan.md` as you complete it (update the file with `[x]`). Goal: get firm-seam tests green.

### Step 3: Write soft-seam tests and reach a green baseline

Write any test tasks labeled `[seam: <id>] [firmness: soft]` in this section. Run the tests; the section must reach a green baseline before you move on. Do **not** refactor here — that happens once, below. Check off the section's verify task and repeat for the next section.

## After all sections complete

### Bounded independent review & behavior-preserving remediation (L3)

This runs **once**, over the whole change, and is required for implement approval. Full detail is in `references/implementation-review.md`.

1. **One broad discovery pass.** Launch a fresh read-only auditor in a separate context. Give it the complete diff, relevant CONTEXT/seams, and only idiom packs applicable to the effective scope. Following `references/adversarial-review.md`, it reviews deeply where applicable across data/state, data structures, interfaces/traits, errors, security, observability, simplicity, maintainability, and idioms. No mandatory `N/A` boilerplate.
2. **One consolidated batch.** Deduplicate all blocker/major findings. Record stable `RV-NNN` IDs in the plan's review table with severity `blocker|major`, category `correctness|security|simplicity|maintainability|idioms`, evidence, concrete impact, and concrete alternative. Do not emit nits or later batches. Attest with:
   ```
node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --phase implement --cycle implement-N --role auditor \
      --reviewer "<auditor label>" --verdict changes-requested \
      --finding '{"id":"RV-001","severity":"major","category":"maintainability","location":"<file:line>","impact":"<impact>","alternative":"<alternative>"}'
   ```
   If clean, record `approved` plus a brief evidence-based rationale in the plan.
3. **One remediation.** Resolve the complete batch behavior-preservingly. Auto-select local/private/reversible idiomatic fixes. Kick back any remediation crossing the materiality boundary. Change only implementation and soft-seam tests. Firm-seam tests must stay green; failure means STOP and kick back, never edit the test.
4. **Full green run.** Run the full applicable suite after remediation.
5. **Focused verification.** Launch a distinct fresh read-only verifier. It checks only the original `RV-*` IDs and preservation evidence. It does not repeat discovery, expand scope, or introduce new low/major findings:
   ```
node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --phase implement --cycle implement-N --role verifier \
      --reviewer "<distinct verifier label>" --verdict approved --resolution RV-001=resolved
   ```
   A remediation-caused blocker regression is the sole new-ID exception: record it with `--regression`, correct it in the same focused scope, and close it with `--regression-resolution` during the one targeted reverification. If any ID remains unresolved or closure needs broad review, stop and kick back rather than extending the cycle.

## Kickback protocol

When you encounter:
- An ambiguity the plan did not cover
- A decision at the materiality boundary that the artifacts do not resolve
- A firm-seam test that fails during the refactor pass (behavior change)
- A conflict between the plan and reality that requires resolving

**STOP IMMEDIATELY.** Do not proceed. Do not improvise.

1. Describe the gap clearly to the user.
2. Classify: is this a `defect` (spec should have caught it) or `amendment` (legitimate new info)?
3. Log the kickback:
```
  node "$SKILL_DIR/scripts/kickback-log.mjs" --id <id> --type defect|amendment --phase implement --impact specify|plan|implementation \
  --missed "<what the spec didn't cover>"
```
   Choose `specify` when a material decision changes, `plan` when only the checklist is stale, and `implementation` when no upstream artifact is invalidated. The script records the precise `restart_phase` and `invalidated_approvals`.
4. Tell the user to resume at the recorded phase and re-approve only invalidated approvals.
5. Do not continue this session until the kickback is resolved.

### Docs reconciliation and implement approval

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

5. Run `context-verify.mjs` after reconciliation, including firm-seam tests where applicable, and address its findings.
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
- The refactor is not a pure refactor (behavior changed) → kickback with `--impact specify`.
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
