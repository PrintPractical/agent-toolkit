---
name: fix
description: Use when diagnosing and correcting a defect, regression, production failure, or broken behavior that must be reproduced and guarded by an expected-failing regression test.
---

# Fix

Prove the failure, diagnose its root cause, and make the smallest durable correction. Use the CLI for lifecycle state; never edit `.agent/.state`.

## Project Instructions

Before planning or editing, read every applicable `AGENTS.md` in the project. Treat its instructions as binding requirements for all subsequent work. If this skill's general guidance conflicts with an `AGENTS.md` requirement, the `AGENTS.md` takes precedence; do not simplify, reinterpret, or override that requirement.

## Start and Diagnose

1. Run `agent-toolkit init` if needed, then `agent-toolkit start --kind fix --title "<title>"`.
2. Run `agent-toolkit status`; associate an issue with `agent-toolkit issue ensure` or `agent-toolkit issue link` when required.
3. Read `.agent/SYSTEM.md`, the projects AGENTS.md file if exists, affected contracts, code history when useful, and nearby tests.
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

Document source-requirement traceability including applicable project instructions, root cause, regression evidence, proposed correction, risks, boundary contracts, tests, and an implementation plan of runnable vertical slices. Add a compact file/module placement plan covering expected changes, responsibilities, project constraints, boundaries, and slices; paths are a reviewed forecast, not an exhaustive manifest. Give every slice a JSON-array acceptance command for its observable corrected path. At meaningful storage, transport, time, identity, messaging, or external-system boundaries, prefer a narrow inward-owned contract and outward adapter even with one implementation; avoid only contract-free wrappers and generic CRUD. Logical boundaries still apply inside one crate or package. Where project instructions do not prescribe module layout, prefer shallow cohesive modules over files mixing policy, orchestration, and infrastructure. Run `agent-toolkit check` and `advance`, then present the design and plan to the developer during `developer-review`. Stop for their response; record requested changes with `agent-toolkit feedback record --verdict changes-requested --note "..."` (repeat `--note` or use `--notes <file>`), or explicit acceptance with `agent-toolkit feedback record --verdict approved`. Only then continue through design critic, remediation when requested, and a distinct verifier:

- `agent-toolkit review prepare --stage design --role critic|verifier`
- `agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> --findings <findingsPath>`
- `agent-toolkit findings resolve <id>` after each finding is actually remediated

The critic completes every item in the prepared packet's checklist before writing findings, making one comprehensive discovery pass rather than stopping at the first defect. Every reviewer writes its response directly to the packet's `findingsPath` using its JSON schema, including `{"findings":[]}` for approval, and creates no review scratch files elsewhere in the project; Markdown findings are invalid. The verifier is a closure check, not another critic: it may only reopen a supplied finding or identify a high-severity regression introduced by remediation. Critic and verifier must use fresh, separate contexts. If subagents are unavailable, send each prepared compact packet to a separate session. Do not self-approve.

## Correct and Test

1. Enter implementation only when the CLI reports `ready-to-build`.
2. Make the smallest complete fix at the level that owns the violated rule or contract. Preserve every reviewed abstraction, project module constraint, and dependency direction. Support files or adjusted forecast paths are acceptable when those constraints remain intact; explain meaningful placement differences in conformance. If a boundary or module constraint was missed, restart design review rather than coupling policy to concrete infrastructure.
3. Add meaningful unit tests for changed nontrivial rules and integration tests for affected real boundaries.
4. Check adjacent failure modes and ensure the fix does not weaken errors, validation, consistency, or compatibility.
5. Reconcile the fix artifact and system map with the implemented evidence. If reproduction, root cause, rules, boundaries, interfaces, test strategy, or slices changed materially, run `agent-toolkit review restart --stage design`; do not silently drift.
6. Complete each runnable slice with formatting/static checks, compilation of affected targets, the regression via `agent-toolkit test --kind regression -- <command>`, and relevant unit/integration evidence before continuing. Leave no placeholders or unimplemented branches on the corrected path, then run the complete relevant suite against that exact candidate.

## Quality and Commit

1. Implement only the next reported slice. Add its exact individual conformance record, run its acceptance command against that candidate through the CLI, and run `agent-toolkit slice complete --number N`; never combine slice numbers. After all slices, rerun every slice acceptance command against the final candidate, run `agent-toolkit check`, and follow `status`/`advance` to seal the baseline before review edits.
2. Prepare a fresh quality critic with `agent-toolkit review prepare --stage quality --role critic`; require it to complete the packet checklist and make one comprehensive pass over behavior, reviewed architecture, project module constraints, and expected placement, distinguishing harmless forecast-path changes from organization violations, then record its JSON verdict.
3. Remediate warranted correctness or refactoring findings, reconcile artifacts, rerun relevant tests against that exact candidate, and resolve findings through the CLI.
4. Prepare a distinct fresh verifier with `agent-toolkit review prepare --stage quality --role verifier`; require a closure review limited to supplied findings and remediation-introduced high-severity regressions, then record its verdict.
5. Follow the CLI to `ready-to-commit`, run final relevant tests and `agent-toolkit check`.
6. Follow `agent-toolkit status`: create the inspected conventional commit when requested, or use `advance` when commit integration is inactive.
7. Confirm `agent-toolkit status` is `complete`. Never push.
