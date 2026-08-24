---
name: fix
description: Use when diagnosing and correcting a defect, regression, production failure, or broken behavior that must be reproduced and guarded by an expected-failing regression test.
---

# Fix

Prove the failure, diagnose its root cause, and make the smallest durable correction. Use the CLI for lifecycle state; never edit `.agent/.state`.

## Start and Diagnose

1. Run `agent-toolkit init` if needed, then `agent-toolkit start --kind fix --title "<title>"`.
2. Run `agent-toolkit status`; associate an issue with `agent-toolkit issue ensure` or `agent-toolkit issue link` when required.
3. Read `.agent/SYSTEM.md`, affected contracts, code history when useful, and nearby tests.
4. Shape the `.agent/changes/<slug>.md` artifact created by the CLI.
5. Describe expected versus actual behavior, impact, environment, and the narrowest reliable reproduction.
6. Trace the execution and data path. Distinguish the root cause from trigger, symptom, and contributing conditions.
7. Check sibling paths that share the faulty rule or boundary.

Ask at most five questions, only about product behavior, domain meaning, boundaries, public interfaces, or consequential irreversible choices. Own reversible diagnostic and implementation choices.

If `.agent/SYSTEM.md` is absent, bootstrap the minimum relevant map using the structure created by the CLI. Update it only with durable findings. For empty adaptive sections, provide a one-line reason they do not apply.

## Lock the Failure

Before changing production behavior:

1. Add the smallest regression test that exercises the real faulty behavior at the lowest reliable level.
2. Avoid a fake or mock as the system under test. Substitute only irrelevant external boundaries.
3. Run and record the expected failure with `agent-toolkit test --kind regression --expect-fail -- <command>`.
4. Confirm it fails for the diagnosed reason, not setup, timing, or an unrelated assertion.

If no automated reproduction is technically possible, stop and record the concrete blocker; do not claim a regression test exists or proceed around a CLI gate.

## Design Review

Document root cause, regression evidence, proposed correction, risks, tests, and slices. Run `agent-toolkit check`, then follow `status`/`advance` through design critic, remediation when requested, and a distinct verifier:

- `agent-toolkit review prepare --stage design --role critic|verifier`
- `agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> [--findings <file>]`
- `agent-toolkit findings resolve <id>` after each finding is actually remediated

Critic and verifier must use fresh, separate contexts. If subagents are unavailable, send each prepared compact packet to a separate session. Do not self-approve.

## Correct and Test

1. Enter implementation only when the CLI reports `ready-to-build`.
2. Make the smallest fix at the level that owns the violated rule or contract; avoid symptom patches and unrelated cleanup.
3. Add meaningful unit tests for changed nontrivial rules and integration tests for affected real boundaries.
4. Check adjacent failure modes and ensure the fix does not weaken errors, validation, consistency, or compatibility.
5. Reconcile the fix artifact and system map with the implemented evidence. If reproduction, root cause, rules, boundaries, interfaces, test strategy, or slices changed materially, run `agent-toolkit review restart --stage design`; do not silently drift.
6. Run the regression normally with `agent-toolkit test --kind regression -- <command>` and other tests with `--kind unit|integration`, then run the complete relevant suite against that exact candidate.

## Quality and Commit

1. Run `agent-toolkit check`; follow `status`/`advance` to seal the baseline before review edits.
2. Prepare a fresh quality critic with `agent-toolkit review prepare --stage quality --role critic`; record its verdict.
3. Remediate warranted correctness or refactoring findings, reconcile artifacts, rerun relevant tests against that exact candidate, and resolve findings through the CLI.
4. Prepare a distinct fresh verifier with `agent-toolkit review prepare --stage quality --role verifier`; record its verdict.
5. Follow the CLI to `ready-to-commit`, run final relevant tests and `agent-toolkit check`.
6. Follow `agent-toolkit status`: create the inspected conventional commit when requested, or use `advance` when commit integration is inactive.
7. Confirm `agent-toolkit status` is `complete`. Never push.
