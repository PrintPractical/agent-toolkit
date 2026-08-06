---
name: implement
description: Use after plan gate is approved to execute the task checklist in plan.md. Implements each section to a green test baseline, then runs one independent review-and-refactor pass (fresh auditor + verifier subagents) over the whole change before the implement gate. Enforces the firm-seam test tripwire, logs kickbacks on flaws, and reconciles CONTEXT.md files when done. Do not run unless the plan gate is approved.
---

# Implement

You are running the **implement** stage of the agent-toolkit pipeline. Spine stage 4. Your job is to execute `plan.md` faithfully. You make **zero product/contract/scope decisions** here. If something requires such a decision, stop — that is a kickback. Local, behavior-preserving quality decisions during the review-and-refactor pass are part of the job.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Your stance

The implementer follows the plan. It does not interpret, improvise, or "make reasonable assumptions" about behavior, contracts, or scope. Any such ambiguity is a defect in the spec process and triggers a kickback.

Code quality is still your job, but it is **not** done per section. Each section is implemented to a green test baseline; the single behavior-preserving review-and-refactor pass happens once, after all sections are green, driven by fresh independent reviewers (see `references/implementation-review.md`).

## Preconditions

Load `manifest.yaml`. Verify:
- `stage` is `implement` (plan gate approved).
- `gates.implement` is `pending`.
- `plan.md` exists.

If `manifest.language` is set and `references/idioms/<lang>.md` exists, load it for the review-and-refactor pass. If no matching pack exists, state that and use the repository's language conventions and tooling rather than assuming pack guidance.

## The loop: per section (implement → tests green)

Work through `plan.md` one section at a time. For each section:

### Step 1: Write firm-seam tests first

Find all test tasks labeled `[firmness: firm]` in this section. Write those tests first. They must be **red** (failing) before any implementation code is written. This is non-negotiable.

### Step 2: Implement to green

Write the implementation tasks from the plan. Work the checklist top to bottom. Check off each task in `plan.md` as you complete it (update the file with `[x]`). Goal: get firm-seam tests green.

### Step 3: Write soft-seam tests and reach a green baseline

Write any test tasks labeled `[firmness: soft]` in this section. Run the tests; the section must reach a green baseline before you move on. Do **not** refactor here — that happens once, below. Check off the section's verify task and repeat for the next section.

## After all sections complete

### Independent review & behavior-preserving refactor (L3)

This runs **once**, over the whole change, and gates the implement gate. Full detail is in `references/implementation-review.md`.

1. **Fresh auditor subagent.** Launch a read-only subagent in a separate context (not you, the implementer). Give it the diff, the relevant CONTEXT/seams, and instruct it to load `references/idioms/<lang>.md` for every language in scope and review against it. It must actively hunt for:
   - unsafe / panic-prone code (e.g. Rust `.unwrap()`/`.expect()`/`panic!` on I/O, parsing, input, locks, task joins; swallowed errors),
   - idiom-pack violations,
   - oversized / monolithic modules and other structural bloat,
   - hygiene issues (dead code, debug prints, stray TODOs).

   Record its findings:
   ```
   node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --stage implement --role auditor \
     --reviewer "<auditor label>" --verdict changes-requested \
     --finding "<file:line> [safety|idioms|structure|hygiene] <required action>"
   ```
   If the work genuinely needs no cleanup, the auditor may record `--verdict approved` with a stated rationale.

2. **Apply behavior-preserving cleanup** for the findings. Change only implementation and soft-seam tests. **Firm-seam tests must stay green at all times** — a firm-seam failure means behavior changed: STOP and kick back (it is not a pure refactor). Soft-seam tests may be rewritten to match the new structure.

3. **Full green run.** Run the full test suite (or relevant subset). It must pass after the refactor.

4. **Fresh verifier subagent.** Launch a *distinct* read-only subagent (not you and not the auditor). It re-loads the idiom packs, confirms the auditor's findings are resolved or explicitly deferred, and confirms behavior is preserved. Its reviewer label must differ from the auditor's:
   ```
   node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --stage implement --role verifier \
     --reviewer "<distinct verifier label>" --verdict approved
   ```
   A `changes-requested` verdict returns to step 2 with a new fresh reviewer.

### Implement gate

When all sections are green, the review-and-refactor pass is done, and an approved verifier review is recorded:

> "All implementation sections are complete, tests pass, and the independent review is approved. Do you approve the implement gate?"

```
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate implement --approve
```

The gate refuses unless an approved verifier review (backed by a distinct auditor review) exists for this change.

## Kickback protocol

When you encounter:
- An ambiguity the plan did not cover
- A decision you'd have to make (any non-trivial choice)
- A firm-seam test that fails during the refactor pass (behavior change)
- A conflict between the plan and reality that requires resolving

**STOP IMMEDIATELY.** Do not proceed. Do not improvise.

1. Describe the gap clearly to the user.
2. Classify: is this a `defect` (spec should have caught it) or `amendment` (legitimate new info)?
3. Log the kickback:
```
  node "$SKILL_DIR/scripts/kickback-log.mjs" --id <id> --type defect|amendment --stage implement --impact specify|plan|implementation \
  --missed "<what the spec didn't cover>"
```
   Choose `specify` when a material decision changes, `plan` when only the checklist is stale, and `implementation` when no upstream artifact is invalidated. The script records the precise restart stage and invalidated gates.
4. Tell the user to resume at the recorded restart stage and re-approve only invalidated gates.
5. Do not continue this session until the kickback is resolved.

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
- The refactor is not a pure refactor (behavior changed) → kickback with `--impact specify`.
- Or the firm seam itself needs to change → this requires the full firm-change protocol (see `references/firm-change-protocol.md`), a `Firm-Change:` kickback, and scoped re-approval of affected gates.

## Reference files

- `references/implementation-review.md` — the independent review-and-refactor model, roles, and review record
- `references/seam-and-test-taxonomy.md` — firm/soft test rules, tripwire
- `references/manifest-schema.md` — kickback types
- `references/change-lifecycle.md` — docs reconciliation + archive
- `references/firm-change-protocol.md` — if a firm seam must change
- `references/drift-control.md` — CONTEXT.md update rules
- `references/idioms/<lang>.md` — review-and-refactor guidance
