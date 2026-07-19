---
name: verify
description: Use to reconcile CONTEXT.md files with the current state of the code. Detects drift using provenance stamps, classifies divergences by seam firmness, auto-updates soft prose to match code, and surfaces firm divergences for human adjudication. Use after hotfixes, drive-by PRs, or periodically to keep docs honest. Also the tool that runs during implement's docs reconciliation phase.
---

# Verify

You are running the **verify** maintenance skill. Your job is to close the gap between CONTEXT.md files and the code they describe — without silently rewriting firm contracts.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Your stance

Read `references/drift-control.md` now. The core asymmetry:
- **Soft divergence:** the code changed; update the CONTEXT.md to match. Code is ground truth.
- **Firm divergence:** do NOT silently rewrite. Surface to the user: intentional change (→ firm-change protocol) or regression (→ flag as bug)?

This asymmetry is not optional. Silently updating a firm seam description to match code that violated the contract is the worst possible outcome — it launders a bug into the spec.

## Preconditions

None — `verify` runs without an active change manifest. It is a maintenance tool.

Optionally: if there is an active change in `.changes/active/`, its `architecture.md` and `decisions.md` can serve as the "what changed" reference for targeted reconciliation.

## Phase 1: Discover and scan

```
node "$SKILL_DIR/scripts/context-discover.mjs"
```

Then run the drift detector:
```
node "$SKILL_DIR/scripts/context-verify.mjs" --all [--run-tests]
```

Parse the JSON output. You now have:
- Which CONTEXT.md files are stale (code changed since stamp)
- Which have firm seams with test citations
- Which firm-seam test files are missing (hard block if CI)

## Phase 2: Triage by firmness

For each stale CONTEXT.md, use an explore subagent to understand what actually changed:

> "The following CONTEXT.md is stale (code changed since it was last validated). Read the CONTEXT.md and then read the relevant code files that changed. For each claim in the CONTEXT.md, tell me: does it still hold? Is it now inaccurate? Is it partially accurate? Focus especially on seams marked [firmness: firm]."

Pass the subagent:
- The CONTEXT.md content
- The list of changed files (`changedFiles` from context-verify output)
- The component's current code

Classify each divergence:

| Divergence | Firmness | Action |
|---|---|---|
| Soft prose is inaccurate | soft | Auto-update |
| Soft seam description changed | soft | Auto-update |
| Soft acceptance criteria changed | soft | Auto-update |
| Firm seam description changed | firm | Surface to user |
| Firm acceptance criteria changed | firm | Surface to user |
| Firm contract code changed | firm | Surface to user + check test |

## Phase 3: Handle soft divergences

For each soft divergence: update the CONTEXT.md to match the current code. Be specific — do not just "refresh"; accurately describe the new state.

Rules:
- Update only what changed. Do not rewrite sections that are still accurate.
- If a soft known-soft-spot was addressed by the code change, remove it.
- If the code change introduced new technical debt, add it to Known-soft-spots.
- Keep the tone and structure consistent with the existing CONTEXT.md.

## Phase 4: Handle firm divergences

For each firm divergence, present to the user:

> "I found a divergence at a firm seam: [SEAM-<id>]
>
> **What CONTEXT.md says:** [claim]
> **What the code does:** [actual behavior]
>
> Is this:
> (A) An intentional change to the contract → I'll run the firm-change protocol
> (B) A regression (the code is wrong, not the spec) → flag as a bug"

**If (A) — intentional change:**
- Apply the firm-change protocol from `references/firm-change-protocol.md`.
- Update the CONTEXT.md to reflect the new contract.
- Note that firm-seam tests will need updating via the formal firm-change process.
- Log in `decisions.md` if an active change manifest exists.

**If (B) — regression:**
- Do NOT update the CONTEXT.md.
- Document the regression: which firm seam is violated, which code path violates it, which firm-seam test (if any) should have caught it.
- Recommend: create a `triage` or `architect` change to fix the regression.

## Phase 5: Re-stamp provenance

For each CONTEXT.md that was updated (soft or firm via (A)):
1. Get the current HEAD sha: `git rev-parse HEAD`
2. Update the `Provenance: validated-at:` line.

## Phase 6: Present summary

Show the user:
- Files updated (soft reconciliation)
- Firm divergences found and their resolution
- Any regressions found (not updated; action required)
- Any firm-seam test files that were missing

Ask for confirmation before finalizing. The user should spot-check at least one updated CONTEXT.md.

## Phase 7: Report for CI context

If called with `--ci` (or from a CI context), emit the JSON report from `context-verify.mjs` and exit with:
- `0` — no firm failures
- `1` — at least one firm-seam test file missing or failing
- `2` — stale only (warning)

This lets CI make the asymmetric decision: firm failures block; staleness warns.

## What verify does NOT do

- It does not make implementation changes to code.
- It does not run `architect` or `specify` — those are separate tools for when you want to *change* the architecture.
- It does not guarantee CONTEXT.md is 100% accurate after running — it is a best-effort reconciliation. Residual inaccuracies are normal; they get caught on the next verify pass.

## Reference files

- `references/drift-control.md` — the core drift model
- `references/firm-change-protocol.md` — for firm divergences classified as intentional
- `references/context-schema.md` — CONTEXT.md fields and semantics
- `references/seam-and-test-taxonomy.md` — firm seam test rules
