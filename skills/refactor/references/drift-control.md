# Drift Control

This document describes how the toolkit keeps CONTEXT.md files from silently diverging from the code they describe.

## The fundamental honesty about drift

You cannot keep all prose perfectly synchronized with all code at all times. Systems that promise this rot — prose staleness accumulates until the docs become actively misleading.

The toolkit makes a narrower, defensible promise:

> **Firm contracts are test-enforced.** Soft prose carries a freshness stamp. Drift is detected, classified by severity, and routed to the appropriate response.

## Drift surface by firmness

The firmness model partitions the drift problem:

| What drifted | Severity | Response |
|---|---|---|
| Soft seam description | Low | Auto-update CONTEXT.md to match code; re-stamp provenance |
| Soft acceptance criteria | Low | Auto-update; soft tests may need rewrite |
| Firm seam description | Medium | Surface to user: intentional change or regression? |
| Firm acceptance criteria | High | Run `context-verify`; if tests fail → hard block |
| Firm contract, tests pass | Medium | Verifier subagent confirms; may indicate test gap |

## Detection: context-verify.mjs

`context-verify.mjs` is the drift detection engine. It runs:
- During `implement` docs reconciliation (mandatory)
- In CI on every PR (automated)
- On demand via the `verify` skill (conversational)

What it does for each CONTEXT.md:
1. Read `Provenance: validated-at: <sha>`.
2. Run `git diff --name-only <sha>..HEAD -- <component-dir>` → list of changed files since stamp.
3. If changed files exist: mark CONTEXT as stale.
4. For each firm seam with `enforced-by` test citations: run those tests.
5. Emit a drift report: `{ path, stale, firmSeamResults: [{seamId, testPath, passed}] }`.

## CI asymmetry

The CI response mirrors the firmness model:

```
firm-seam test failing  → hard block (must fix before merge)
firm-seam test missing  → hard block (firm seam must have a test)
soft prose stale        → warning + required PR trailer ack
                          (Reviewer adds: Context-Reviewed: src/gateway/CONTEXT.md)
```

This means:
- Hotfixes that change code covered by firm seams will fail CI if they break the contract.
- Hotfixes that change soft areas get a warning, not a block — practical for urgent work.

## Out-of-band drift (the hard problem)

The biggest drift risk is not the toolkit pipeline — it's contributors who bypass the pipeline (hotfixes, drive-by PRs, external patches). For these:

- Provenance stamp detects staleness automatically.
- Firm-seam tests catch behavioral regressions.
- `verify` skill provides conversational reconciliation on demand.
- The `Context-Reviewed:` PR trailer creates an explicit human acknowledgment trail.

## Seam IDs enable precise tracking

Every firm seam carries a stable ID (`[SEAM-<component>-<name>-<seq>]`). This ID appears in:
- `CONTEXT.md`: seam definition
- `decisions.md`: any decision that changes the seam
- Tests: `// [SEAM-gw-rl-01]` comment
- `manifest.yaml` context_targets (implicit)

When `context-verify.mjs` or `verify` detects firm drift, it reports by seam ID — making blast-radius analysis and the firm-change protocol easier to execute precisely.

## What CONTEXT.md does NOT try to do

- Track change history (that's `decisions.md` and the archive)
- Explain every line of code (that's inline comments)
- Serve as user documentation (that's the project README / docs)
- Remain perfectly current for soft fields at all times (that's impossible)

Scope creep in CONTEXT.md is itself a form of rot. Keep it lean.
