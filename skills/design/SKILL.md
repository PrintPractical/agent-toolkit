---
name: design
description: Use when framing a project or shaping a greenfield or brownfield feature before implementation, including selecting, resuming, and designing project milestones.
---

# Design

Turn intent into a reviewed, buildable change artifact. The `agent-toolkit` CLI owns lifecycle state; never edit `.agent/.state` or infer progress from files alone.

## Project Instructions

Before planning or editing, read every applicable `AGENTS.md` in the project. Treat its instructions as binding requirements for all subsequent work. If this skill's general guidance conflicts with an `AGENTS.md` requirement, the `AGENTS.md` takes precedence; do not simplify, reinterpret, or override that requirement.

## Route the Work

When arriving from ideation in the same conversation, use its established context. Do not ask the engineer to repeat resolved information; verify it against repository evidence.

1. Run `agent-toolkit init` if `.agent/` is absent, then inspect `agent-toolkit status --json` and `agent-toolkit workflow list --json`.
2. Resume matching current work. Select explicitly named saved work with `agent-toolkit workflow select <slug>` only when its safety checks pass; never manipulate files or Git to make it pass.
3. Start a rolling project with `agent-toolkit project start --title "<title>"`; repeat `--source <path>` for supplied authoritative documents.
4. For a milestone, prefer an explicit name, matching current work, then the next unblocked `active` roadmap entry. Ask only on material ambiguity. Run `agent-toolkit start --kind feature --title "<title>" --project <slug> --milestone <number>`.
5. Start one coherent standalone feature with `agent-toolkit start --kind feature --title "<title>"`. Work needing multiple reviewed commits is a project; defects belong to fix.
6. Read repository, tests, contracts, instructions, and `.agent/SYSTEM.md`. Identify the closest existing owner; do not add parallel behavior without a concrete semantic or ownership distinction.

## Frame a Project

Read supplied sources and inspect the repository. Complete `.agent/projects/<slug>.md`, classify decisions as `observed`, `committed`, `hypothesis`, or `rejected`, and resolve material ambiguity with the engineer.

Create a provisional roadmap with the fewest independently useful milestones. Each is a normal `feature` or `fix`; split only when work cannot share one contract and review, or separate delivery is a meaningful checkpoint. Keep related behavior together; never create milestones for layers, modules, setup, or small tasks. Record dependencies and coverage, not premature architecture.

## System Map

Bootstrap the minimum relevant evidence-based `.agent/SYSTEM.md` when needed. Update changed responsibilities, dependencies, contracts, constraints, or pressure; keep unrelated areas out.

## Shape a Change

Shape `.agent/changes/<slug>.md` from repository and project evidence. Milestone design owns concrete APIs, boundaries, and placement within the reviewed project contract.

1. State the observable outcome and explicit non-goals.
2. Classify every source requirement, including project instructions, as supported now, deferred, or a non-goal, with a use case, rule, interface, test, placement constraint, or rationale. Only supported-now behavior binds the implementation; deferred behavior may record concrete compatibility pressure but must not be designed or accepted now.
3. Clarify any terms and distinctions needed to make the change unambiguous.
4. Write concrete happy, edge, and failure examples for supported-now behavior with inputs, context, and observable results. Cover demonstrated risks, not every conceivable input or future interaction.
5. Extract rules and invariants from examples. Resolve contradictions explicitly.
6. Search for equivalent behavior, including differently named duplicates. Record `REUSE`, `EXTEND`, `REFACTOR`, or `NEW` with evidence; consolidate equivalents.
7. Before placement or slicing, decompose the change into independently meaningful responsibility owners. Record the template fields and assign each capability or integration to one authoritative owner; layers, generic services, files, and slices are not owners by convenience.
8. Define the smallest viable implementation and a reviewed change budget: expected production-code growth, affected files and owners, largest source-file impact, and any new dependency or abstraction. Use repository evidence and record a concrete reassessment trigger; estimates are guardrails, not productivity targets.
9. Map every owner to expected placement and slices. Apply `AGENTS.md`, preserve sound owners, and consolidate poor placement. Paths are forecasts; ownership, roles, dependency direction, and governing constraints bind.
10. Specify changed public interfaces, errors, idempotency, consistency, and external integrations.
11. Define only relevant supported-now limits, identity, ordering, cancellation, re-registration, shutdown, concurrency, and scale guarantees. Mark irrelevant dimensions not applicable.
12. Record each needed abstraction's current behavioral purpose, consumers, expected implementations, and test strategy. Do not introduce one for a hypothetical consumer or merely to mirror one concrete implementation.
13. Trace risk-based tests to supported rules, contracts, and demonstrated failure modes.
14. Plan ordered thin vertical slices using every template field. Architecture is decomposed by responsibility; implementation proceeds by vertical slices through the reviewed owners. Each produces runnable behavior to a real boundary without inventing architecture or copying shared behavior. Give each a JSON-array acceptance command.

Choose the simplest implementation that correctly delivers supported-now behavior and repository constraints. Add owners, files, abstractions, dependencies, compatibility paths, or edge machinery only for a concrete current consumer, constraint, or demonstrated risk. Do not preserve poor placement for local consistency. Avoid dumping grounds, pass-through wrappers, and parallel code without a concrete distinction. One cohesive owner and slice are valid. Explain inapplicable sections briefly.

## Questions and Decisions

Own reversible choices. Ask at most five material questions at once, only when answers change outcomes, terminology, a boundary, a public interface, or an irreversible choice. Record decisions and blockers; do not turn preferences into questions.

## Design Review

1. Reconcile the artifact and run `agent-toolkit check`.
2. Enter `developer-review` with `agent-toolkit advance`, present the artifact, invite corrections and alternatives, and stop for an explicit response.
3. Record requested changes with `feedback record --verdict changes-requested`, revise, and repeat. Record explicit acceptance with `feedback record --verdict approved`.
4. Prepare a fresh critic with `agent-toolkit review prepare --stage design --role critic`.
5. A separate context completes one bounded pass over the supported-now contract, its owners and dependencies, and demonstrated risks. For projects, review framing, source traceability, constraints, decisions, coverage, dependencies, and completion criteria without treating hypotheses as fact. For changes, reject missing owners, governing-instruction violations, duplicated authoritative behavior, purposeless abstractions, an unjustified change budget, unclear composition or dependency direction, and placement too vague for build. Packet findings are blockers: each must demonstrate a supported scenario, violated contract, observable impact, and smallest required correction. Preferences, speculative hardening, deferred behavior, and optional cleanup stay advisory and out of the packet. Zero findings is valid.
6. Write the exact JSON schema to `findingsPath`, including `{"findings":[]}` for approval; create no review scratch files. Record with `review record --packet <id> --verdict approved|changes-requested --reviewer <id> --findings <findingsPath>`.
7. If changes are requested, remediate each finding, run `agent-toolkit findings resolve <id>`, reconcile the artifacts, and follow `status`/`advance`.
8. Prepare one distinct fresh verifier with `agent-toolkit review prepare --stage design --role verifier`, then reuse that verifier context for closure retries. It may only reopen supplied findings, reject inaccurate dispositions, or identify a demonstrable high-severity regression introduced by remediation.
9. After two closure rejections, follow `review-escalation`; continuation requires reasoned dispositions and verifier approval.
10. Record verifier approval. A project frame exits at `active`; design its next milestone when requested. A change exits at `ready-to-build`, then ends this workflow. Do not run `agent-toolkit advance` from `ready-to-build`; the build skill owns the transition to `implementing`.

When subagents are unavailable, use the prepared review packet as the complete compact prompt for a separate session. The author must not impersonate either fresh reviewer.

## Exit

Before handoff, run `agent-toolkit check` and `agent-toolkit status`. Blocking questions must be closed. Stop at `active` for a reviewed project frame or `ready-to-build` for a reviewed change; hand buildable changes to the build skill.
