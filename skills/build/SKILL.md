---
name: build
description: Use when implementing a reviewed standalone or project milestone change, or completing final integration for a delivered rolling project.
---

# Build

Implement reviewed design in vertical slices. The CLI owns order and `.agent/.state`; never edit state data.

## Project Instructions

Before planning or editing, read every applicable `AGENTS.md` in the project. Treat its instructions as binding requirements for all subsequent work. If this skill's general guidance conflicts with an `AGENTS.md` requirement, the `AGENTS.md` takes precedence; do not simplify, reinterpret, or override that requirement.

## Preconditions

1. Inspect `agent-toolkit status --json` and `workflow list --json`. Resume matching work or safely select an explicit workflow; never restore or mix candidates.
2. For delivery, require a `ready-to-build` change and reviewed `.agent/changes/<slug>.md`. Before starting a provisional project milestone, select its active project and run `agent-toolkit project activate --number N`; it permits only unblocked milestones. For final project integration, require an `active` project whose roadmap milestones and completion criteria are complete. Otherwise return to design.
3. Read `.agent/SYSTEM.md`, applicable project instructions, the change artifact, affected code, tests, and repository conventions. For linked work also read the project frame, source material, requirement coverage, discoveries, and milestone link.
4. Use `agent-toolkit issue ensure` or `agent-toolkit issue link` when the workflow reports that issue association is required.
5. Before editing, extract the supported-now scope, reviewed change budget, responsibility owners, architectural roles and boundaries, expected placement, dependency direction, `REUSE|EXTEND|REFACTOR|NEW` decisions, approved abstractions, shared-owner relationships, and vertical slices. Treat them as implementation constraints, not prompts to re-derive architecture.

## Implement

1. Use `agent-toolkit advance` to enter `implementing` when permitted.
2. Follow the artifact's implementation plan in slice order. Choose the smallest direct implementation of supported-now behavior and do not build deferred capabilities. Implement only the next slice reported by `status`. Complete its entry point, core behavior, integration, and tests before starting another slice; do not implement phase-only batches.
3. Preserve reviewed rules, owners, roles, contracts, errors, dependencies, reuse decisions, abstractions, and project instructions. Do not move behavior to another owner, collapse reviewed owners, add a cross-boundary dependency, duplicate authoritative behavior, or introduce a major abstraction. Before adding a helper, recheck the documented capability and extend its owner when the contract fits instead of copying behavior.
4. Track production-code growth and the largest touched source files as each slice lands. If growth exceeds the reviewed budget or a file becomes disproportionately large, stop and first remove speculative behavior, duplication, indirection, and unnecessary edge machinery. If supported scope or the reviewed budget truly must change, run `agent-toolkit review restart --stage design` before continuing. Additional support files, exact filenames, or local details need no restart while the supported contract and reviewed constraints remain intact; explain meaningful deviations in `Implementation Conformance`.
5. Update `.agent/SYSTEM.md` only for durable system knowledge discovered or changed by the work.
6. After linked slices, update coverage, discoveries, decisions, and roadmap. Each required ID must say `Milestone N ... complete`; retain future assignments. Mark it complete, run `project reconcile`, and fix named IDs before retrying. Binding contract changes require project design review.

Treat the responsibility and architecture map, reviewed abstractions, and project instructions as acceptance criteria. When implementation reveals a material missed owner, constraint, or integration decision, stop and restart design review instead of silently improvising architecture or changing the artifact to justify a convenience-driven deviation.

## Test

Add meaningful unit tests for nontrivial rules and integration tests for real boundaries. Invoke tests through:

`agent-toolkit test --kind regression|unit|integration -- <command>`

Tests must assert supported behavior and contracts. Do not use a fake or mock as the system under test. Avoid tests for deferred behavior or tests that only restate structure, accessors, framework wiring, type declarations, or trivial delegation. Use substitutes only at boundaries when they make outcomes deterministic without replacing the behavior under test.

After each slice, run formatting/static checks and compile or build every affected target. Update one exact `#### Slice N: <reviewed title>` conformance record, then execute the reviewed acceptance command against that reconciled candidate through `agent-toolkit test --kind acceptance -- <command>` and run `agent-toolkit slice complete --number N`. Do not continue while the slice's runnable path has placeholders, empty binaries, unimplemented branches, unsupported entry points, warnings treated as defects by repository policy, or compile failures. Never combine slice numbers or claim later slices from partial foundations. Before sealing, run each distinct reviewed acceptance command only when no current executable fingerprint evidence already covers it.

During `implementing`, do not launch independent critic, audit, or blocker-review contexts. Slice acceptance, affected tests, formatting, and static checks are the implementation feedback loop. Informal observations are advisory and cannot create workflow blockers outside CLI-prepared review packets; continue when reviewed acceptance passes unless there is a compile/test failure, an explicit reviewed requirement violation, supported-use security or data-loss behavior, or a material reviewed architecture violation.

## Quality Gate

1. Reconcile code, tests, the change artifact, and system map. Complete `Implementation Conformance`, including actual production-code growth, largest source-file impact, added dependencies or abstractions, and whether the candidate stayed within the reviewed budget. Map every reviewed owner and slice to code and evidence. Explain acceptable differences; supported-scope, budget, ownership, or architecture changes require design review restart. Run missing relevant evidence only; reuse current executable-fingerprint evidence when the candidate is unchanged.
2. Run `agent-toolkit check`, then use `status` and `advance` to seal the implementation baseline. Do not make quality-review edits before the CLI reports `baseline sealed`.
3. Prepare a mandatory fresh critic with `agent-toolkit review prepare --stage quality --role critic`.
4. Ask the critic to make one bounded pass over the sealed diff, supported-now contract, causally affected callers, and demonstrated integration risks. It must catch regressions, incomplete delivery, reviewed-contract violations, unused scaffolding, and unexplained or disproportionate code and source-file growth. Packet findings are blockers and must name the supported scenario, violated contract, observable impact, and smallest required correction. Preferences, optional cleanup, speculative hardening, and deferred behavior stay advisory and out of the packet. Zero findings is valid.
5. Write every response directly to the packet's `findingsPath` using its exact JSON schema, including `{"findings":[]}` for approval. Do not create review scratch files elsewhere in the project. Record it with `agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> --findings <findingsPath>`. Markdown findings are invalid.
6. If warranted, make the smallest focused remediation, without adjacent hardening. Reconcile artifacts, run only evidence invalidated by executable changes, and use `agent-toolkit findings resolve <id>` for completed findings.
7. Prepare one distinct fresh verifier using `agent-toolkit review prepare --stage quality --role verifier`. Reuse that same verifier context for closure retries. It may only reopen supplied findings, reject inaccurate developer dispositions, or identify a demonstrable high-severity regression introduced by remediation.
8. After two closure rejections, stop automatic remediation and follow `review-escalation`. Developer continuation requires reasoned dispositions and final approval from the same verifier; it never waives explicit requirements, required acceptance, or verifier approval.

For final integration, run `project finalize`, execute every exact command with `test --kind integration`, and seal the baseline. The fresh quality critic reviews the full repository, reconciled milestones, cross-milestone behavior, outcomes, criteria, and assessment; normal verifier and escalation rules apply. Project approval creates no aggregate commit.

If subagents are unavailable, send the prepared compact packet to a separate session. Critic and verifier must be distinct contexts, and verifier closure packets return to the same verifier session; the implementer cannot self-approve.

## Commit

1. Run `agent-toolkit check`; rerun tests only if the executable candidate changed or repository policy explicitly requires it.
2. Ensure artifacts describe the delivered behavior without stale questions; use CLI state for review findings and lifecycle status.
3. Follow `agent-toolkit status`: run `commit prepare` and inspect its exact candidate only when requested, otherwise run `advance`.
4. When requested, run `agent-toolkit commit create` to create the conventional commit.
5. Confirm `agent-toolkit status` reaches `complete`.

Never push. Do not bypass hooks, review gates, the baseline, or CLI sequencing.
