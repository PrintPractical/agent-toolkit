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

Document source-requirement traceability including applicable project instructions, root cause, regression evidence, risks, integrations, tests, the applicable support envelope, and runnable vertical slices. Search for semantically equivalent behavior, including duplicate implementations, and record `REUSE`, `EXTEND`, `REFACTOR`, or `NEW` with evidence; parallel code requires a concrete behavior, lifecycle, or ownership difference, not just a different name or shape. Before placement or slices, decompose significant rules, mappings, capabilities, workflows, and integrations into independently meaningful authoritative owners with roles, dependencies, consumers, invariants, and existing/new status. Then map every owner to expected placement, governing constraints, and slices. Architecture is decomposed by responsibility; correction proceeds in vertical slices through shared owners without local copies. One cohesive owner and slice are enough for a simple fix. State support guarantees only where relevant, follow project instructions rather than prescribing an architecture, and avoid generic dumping grounds or abstractions without behavioral purpose. Run `agent-toolkit check` and `advance`, then present the design and plan to the developer during `developer-review`. Stop for their response; record requested changes with `agent-toolkit feedback record --verdict changes-requested --note "..."` (repeat `--note` or use `--notes <file>`), or explicit acceptance with `agent-toolkit feedback record --verdict approved`. Only then continue through design critic, remediation when requested, and a distinct verifier:

- `agent-toolkit review prepare --stage design --role critic|verifier`
- `agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> --findings <findingsPath>`
- `agent-toolkit findings resolve <id>` after each finding is actually remediated

The critic makes the cycle's one comprehensive discovery pass and must catch omitted requirements, ownerless rules, unrelated concepts collapsed together, semantic duplication, governing-instruction or boundary violations, vague placement, purposeless abstractions, and regressions. It asks whether ownership remains coherent if infrastructure changes, without rejecting a genuinely cohesive generic name. Findings need concrete contract references, evidence, and impact; zero findings is valid. The verifier is a closure check limited to supplied findings, inaccurate dispositions, and demonstrable remediation-introduced high-severity regressions. Use one fresh critic and one distinct fresh verifier, then reuse the verifier context for closure retries. After two rejections, follow explicit escalation rather than launching more reviewers or automatic remediation. Do not self-approve.

## Correct and Test

1. Enter implementation only when the CLI reports `ready-to-build`.
2. Make the smallest complete fix at the location that owns the violated rule or contract. Preserve every reviewed owner, role, abstraction, project module constraint, dependency direction, reuse decision, and slice. Do not collapse owners, add cross-boundary dependencies, duplicate authoritative behavior, or introduce a major abstraction. Support files, exact filenames, and local details may vary when reviewed constraints remain intact; explain meaningful path differences in conformance. If decomposition or architecture is materially wrong or incomplete, restart design review before deviating.
3. Add meaningful unit tests for changed nontrivial rules and integration tests for affected real boundaries.
4. Check adjacent failure modes and ensure the fix does not weaken errors, validation, consistency, or compatibility.
5. Reconcile the fix artifact and system map with the implemented evidence. If reproduction, root cause, rules, boundaries, interfaces, test strategy, or slices changed materially, run `agent-toolkit review restart --stage design`; do not silently drift.
6. Complete each runnable slice with formatting/static checks, compilation of affected targets, the regression via `agent-toolkit test --kind regression -- <command>`, and affected unit/integration evidence before continuing. Leave no placeholders or unimplemented branches on the corrected path. Do not launch unofficial blocker audits during implementation; observations outside CLI packets are advisory unless they demonstrate a required test/compile failure, explicit reviewed requirement violation, supported-use security/data loss, or material reviewed architecture violation.

## Quality and Commit

1. Implement only the next reported slice. Add its exact individual conformance record, run its acceptance command against that candidate through the CLI, and run `agent-toolkit slice complete --number N`; never combine slice numbers. After linked work, update project coverage, discoveries, decisions, and roadmap. For every ID in the milestone's `Requirements`, edit that requirement's coverage record to state `Milestone N ... complete` with current evidence, preserving any future milestone assignments. Mark the milestone complete and run `agent-toolkit project reconcile`; if reconciliation names missing IDs, update those records before retrying. Then run only distinct acceptance commands lacking current executable evidence, `check`, and `advance` to seal the baseline before review edits.
2. Prepare a fresh quality critic with `agent-toolkit review prepare --stage quality --role critic`; require it to complete the packet checklist and make one comprehensive pass over behavior, reviewed architecture, project module constraints, and expected placement, distinguishing harmless forecast-path changes from organization violations, then record its JSON verdict.
3. Make only the smallest warranted remediation, reconcile artifacts, rerun evidence invalidated by executable changes, and resolve findings through the CLI.
4. Prepare one distinct fresh verifier and reuse its context for closure retries; after two rejections, follow explicit escalation. Developer dispositions still require final verifier approval.
5. Follow the CLI to `ready-to-commit` and run `agent-toolkit check`; do not rerun unchanged-candidate evidence unless repository policy requires it.
6. Follow `agent-toolkit status`: create the inspected conventional commit when requested, or use `advance` when commit integration is inactive.
7. Confirm `agent-toolkit status` is `complete`. Never push.
