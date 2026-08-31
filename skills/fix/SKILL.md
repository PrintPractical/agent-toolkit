---
name: fix
description: Use when diagnosing and correcting a defect, regression, production failure, or broken behavior that must be reproduced and guarded by an expected-failing regression test.
---

# Fix

Prove the failure, diagnose its root cause, and make the smallest durable correction. Use the CLI for lifecycle state; never edit `.agent/.state`.

## Project Instructions

Before planning or editing, read every applicable `AGENTS.md` in the project. Treat its instructions as binding requirements for all subsequent work. If this skill's general guidance conflicts with an `AGENTS.md` requirement, the `AGENTS.md` takes precedence; do not simplify, reinterpret, or override that requirement.

## Start and Diagnose

1. Run `agent-toolkit init` if needed, then inspect `agent-toolkit status --json` and `agent-toolkit workflow list --json`. Resume a matching fix or safely select one explicitly identified by the engineer; selection never restores or manipulates candidate files.
2. Otherwise start a standalone fix with `agent-toolkit start --kind fix --title "<title>"`, or a roadmap fix with `--project <slug> --milestone <number>` when the active milestone calls for `fix`.
3. Follow `status`; associate an issue with `agent-toolkit issue ensure` or `agent-toolkit issue link` when required.
4. Read `.agent/SYSTEM.md`, applicable project instructions, affected contracts, code history when useful, and nearby tests. For a linked fix also read its project frame, sources, requirement coverage, discoveries, and milestone link.
5. Shape the `.agent/changes/<slug>.md` artifact created by the CLI.
6. Describe expected versus actual behavior, impact, environment, and the narrowest reliable reproduction.
7. Trace the execution and data path. Distinguish the root cause from trigger, symptom, and contributing conditions; check sibling paths that share the faulty rule or boundary. Identify the closest existing behavior, utility, abstraction, and pattern that could own the correction; do not add parallel code unless a concrete semantic or ownership distinction prevents reuse.

Ask at most five questions, only about product behavior, project terminology, integrations, public interfaces, or consequential irreversible choices. Own reversible diagnostic and implementation choices.

If `.agent/SYSTEM.md` is absent, bootstrap the minimum relevant map using the structure created by the CLI. Update it only with durable findings. For empty adaptive sections, provide a one-line reason they do not apply.

## Lock the Failure

Before changing production behavior:

1. Add the smallest regression test that exercises the real faulty behavior at the lowest reliable level.
2. Avoid a fake or mock as the system under test. Substitute only irrelevant external boundaries.
3. Run and record the expected failure with `agent-toolkit test --kind regression --expect-fail -- <command>`.
4. Confirm it fails for the diagnosed reason, not setup, timing, or an unrelated assertion.

If no automated reproduction is technically possible, stop and record the concrete blocker; do not claim a regression test exists or proceed around a CLI gate.

## Design Review

Classify source requirements as supported, deferred, or non-goals, then document project instructions, root cause, regression evidence, risks, integrations, tests, the supported envelope, and runnable vertical slices. Define the smallest correction and a reviewed budget for production-code growth, affected files, largest source-file impact, and new dependencies or abstractions. Search for semantically equivalent behavior and record `REUSE`, `EXTEND`, `REFACTOR`, or `NEW` with evidence; parallel code requires a concrete distinction. Decompose only significant supported rules and integrations into authoritative owners, then map them to placement and slices. One cohesive owner and slice are enough. Run `agent-toolkit check` and `advance`, present the design to the developer, and stop for explicit feedback. Record requested changes or approval through `agent-toolkit feedback record`, then continue through the critic and distinct verifier commands below:

- `agent-toolkit review prepare --stage design --role critic|verifier`
- `agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> --findings <findingsPath>`
- `agent-toolkit findings resolve <id>` after each finding is actually remediated

The critic makes one bounded pass over the supported correction, affected owners, and demonstrated risks. Packet findings are blockers: each must identify a supported scenario, violated contract, observable impact, and smallest correction. Preferences, deferred hardening, and optional cleanup stay advisory and out of the packet. It must still catch semantic duplication, governing-instruction or boundary violations, purposeless abstractions, unjustified complexity growth, and regressions; zero findings is valid. The verifier is a closure check limited to supplied findings, inaccurate dispositions, and demonstrable remediation-introduced high-severity regressions. Use one fresh critic and one distinct fresh verifier, reuse the verifier context for closure retries, and follow escalation after two rejections. Do not self-approve.

## Correct and Test

1. Enter implementation only when the CLI reports `ready-to-build`.
2. Make the smallest complete fix at the location that owns the violated rule or contract. Do not implement deferred behavior. Preserve reviewed constraints without adding cross-boundary dependencies, duplicate behavior, or unbudgeted abstractions. Track production-code and source-file growth; if it exceeds the reviewed budget, first remove speculative behavior and indirection, then restart design only when supported scope or the budget truly must change.
3. Add meaningful unit tests for changed nontrivial rules and integration tests for affected real boundaries.
4. Check adjacent failure modes and ensure the fix does not weaken errors, validation, consistency, or compatibility.
5. Reconcile the fix artifact and system map with implemented evidence, including actual code growth and largest-file impact. If reproduction, supported scope, root cause, rules, boundaries, interfaces, budget, test strategy, or slices changed materially, run `agent-toolkit review restart --stage design`; do not silently drift.
6. Complete each runnable slice with formatting/static checks, compilation of affected targets, the regression via `agent-toolkit test --kind regression -- <command>`, and affected unit/integration evidence before continuing. Leave no placeholders or unimplemented branches on the corrected path. Do not launch unofficial blocker audits during implementation; observations outside CLI packets are advisory unless they demonstrate a required test/compile failure, explicit reviewed requirement violation, supported-use security/data loss, or material reviewed architecture violation.

## Quality and Commit

1. Implement only the next reported slice. Add its exact individual conformance record, run its acceptance command against that candidate through the CLI, and run `agent-toolkit slice complete --number N`; never combine slice numbers. After linked work, update project coverage, discoveries, decisions, and roadmap. For every ID in the milestone's `Requirements`, edit that requirement's coverage record to state `Milestone N ... complete` with current evidence, preserving any future milestone assignments. Mark the milestone complete and run `agent-toolkit project reconcile`; if reconciliation names missing IDs, update those records before retrying. Then run only distinct acceptance commands lacking current executable evidence, `check`, and `advance` to seal the baseline before review edits.
2. Prepare a fresh quality critic with `agent-toolkit review prepare --stage quality --role critic`; require one bounded pass over supported behavior, causally affected callers, reviewed architecture, and complexity reconciliation. Packet findings are blockers, not optional cleanup or deferred hardening, then record its JSON verdict.
3. Make only the smallest warranted remediation, reconcile artifacts, rerun evidence invalidated by executable changes, and resolve findings through the CLI.
4. Prepare one distinct fresh verifier and reuse its context for closure retries; after two rejections, follow explicit escalation. Developer dispositions still require final verifier approval.
5. Follow the CLI to `ready-to-commit` and run `agent-toolkit check`; do not rerun unchanged-candidate evidence unless repository policy requires it.
6. Follow `agent-toolkit status`: create the inspected conventional commit when requested, or use `advance` when commit integration is inactive.
7. Confirm `agent-toolkit status` is `complete`. Never push.
