---
name: design
description: Use when framing a project or shaping a greenfield or brownfield feature before implementation, including selecting, resuming, and designing project milestones.
---

# Design

Turn intent into a reviewed, buildable change artifact. The `agent-toolkit` CLI owns lifecycle state; never edit `.agent/.state` or infer progress from files alone.

## Project Instructions

Before planning or editing, read every applicable `AGENTS.md` in the project. Treat its instructions as binding requirements for all subsequent work. If this skill's general guidance conflicts with an `AGENTS.md` requirement, the `AGENTS.md` takes precedence; do not simplify, reinterpret, or override that requirement.

## Route the Work

When the engineer arrives from ideation in the same conversation, treat its established goal, use cases, decisions, rejected alternatives, constraints, and unresolved questions as source context. Do not ask them to repeat resolved information; verify it against repository evidence while shaping the managed artifact.

1. Run `agent-toolkit init` if `.agent/` is absent, then inspect `agent-toolkit status --json` and `agent-toolkit workflow list --json`.
2. Resume matching current work. Select explicitly named saved work with `agent-toolkit workflow select <slug>` only when its safety checks pass; never manipulate files or Git to make it pass.
3. Start a rolling project with `agent-toolkit project start --title "<title>"`; repeat `--source <path>` for supplied authoritative documents.
4. For a milestone, prefer an explicit name, matching current work, then the next unblocked `active` roadmap entry. Ask only on material ambiguity. Run `agent-toolkit start --kind feature --title "<title>" --project <slug> --milestone <number>`.
5. Start one coherent standalone feature with `agent-toolkit start --kind feature --title "<title>"`. Work needing multiple reviewed commits is a project; defects belong to fix.
6. Read repository, tests, contracts, instructions, and `.agent/SYSTEM.md`. Identify the closest existing owner; do not add parallel behavior without a concrete semantic or ownership distinction.

## Frame a Project

Read every supplied source and inspect the repository. Normalize it into `.agent/projects/<slug>.md`: record fingerprints, outcomes, users, non-goals, acceptance, constraints, quality attributes, risks, questions, and completion criteria. Mark decisions `observed`, `committed`, `hypothesis`, or `rejected`; resolve material ambiguity with the engineer.

Create a provisional roadmap with the fewest independently useful milestones. Each is a normal `feature` or `fix` with its own lifecycle and commit; split only when work cannot share one coherent contract and review, or a separate delivery provides a meaningful user, operational, or risk-reduction checkpoint. Keep related behavior together and use vertical slices for implementation; never create milestones for layers, modules, setup, or small tasks. Record dependencies and coverage, not architecture that milestone design should discover. Without sources, frame conversationally.

## System Map

If `.agent/SYSTEM.md` is absent or empty, bootstrap the minimum relevant evidence-based map. Update it when discovery changes language, responsibilities, dependencies, contracts, constraints, or known pressure. Keep unrelated areas out.

## Shape a Change

Shape `.agent/changes/<slug>.md`. For a milestone, read its project frame, sources, coverage, discoveries, system map, and earlier evidence. Milestone design owns concrete APIs, schemas, boundaries, and placement; do not reinterpret sources outside the reviewed project contract.

1. State the observable outcome and explicit non-goals.
2. Trace every source requirement, including project instructions, to a use case, rule, interface, test, placement constraint, or non-goal. Identify actors and outcomes across now, next, and later without designing speculative features.
3. Clarify any terms and distinctions needed to make the change unambiguous.
4. Write concrete happy, edge, and failure examples with inputs, context, and observable results.
5. Extract rules and invariants from examples. Resolve contradictions explicitly.
6. Search for semantically equivalent rules, workflows, mappings, capabilities, and integrations, including duplicates under different names or syntax. Record `REUSE`, `EXTEND`, `REFACTOR`, or `NEW` with evidence; consolidate equivalent implementations.
7. Before placement or slicing, decompose the change into independently meaningful responsibility owners. Record each owner's behavior/state/rules, decisions, architectural role or boundary, dependencies, consumers, existing/new status, and reuse decision. Assign each significant capability or integration to one authoritative owner. A layer, generic service, nearby file, or slice is not an owner merely because it is convenient.
8. Map every owner to expected placement and slices. Apply `AGENTS.md` organization and dependency rules, preserve sound owners, create cohesive modules, and consolidate poor placement when required. Paths are forecasts; ownership, roles, dependency direction, and governing constraints bind. Generic components are valid only when cohesive.
9. Specify changed public interfaces, errors, idempotency, consistency, and external integrations.
10. Define relevant support limits, identity, ordering, cancellation, re-registration, shutdown, concurrency, and scale guarantees. Mark irrelevant dimensions not applicable.
11. Record each needed abstraction's behavioral purpose, consumers, expected implementations, and test strategy. Do not introduce an abstraction merely to mirror one concrete implementation.
12. Trace risk-based tests to rules, contracts, and failure modes.
13. Plan ordered thin vertical slices using every template field. Architecture is decomposed by responsibility; implementation proceeds by vertical slices through the reviewed owners. Each produces runnable behavior through its named owners to a real boundary. Slices cannot invent architecture or copy shared behavior; layer-only phases are invalid. Give each a JSON-array acceptance command.

Choose architecture, layout, and abstractions from repository evidence and project instructions, not a toolkit style. Do not preserve poor placement for local consistency. Avoid dumping grounds, pass-through wrappers, and parallel code without a concrete distinction. One cohesive owner and slice are valid. Explain inapplicable sections briefly.

## Questions and Decisions

Own reversible choices. Ask at most five material questions at once, only when answers change outcomes, terminology, a boundary, a public interface, or an irreversible choice. Record decisions and blockers; do not turn preferences into questions.

## Design Review

1. Reconcile the artifact and run `agent-toolkit check`.
2. Run `agent-toolkit advance` to enter `developer-review`. Present the completed project frame or change design to the developer and explicitly invite corrections, omissions, and alternative decisions. Stop for their response; never infer approval.
3. For requested changes, record their comments with repeatable `--note "..."` flags or `--notes <file>` using `agent-toolkit feedback record --verdict changes-requested`, revise the artifact, and repeat the developer review. When the developer explicitly accepts it, run `agent-toolkit feedback record --verdict approved`.
4. Prepare a fresh critic with `agent-toolkit review prepare --stage design --role critic`.
5. A separate context completes the checklist and one comprehensive pass. For projects, review framing, source traceability, constraints, decisions, coverage, dependencies, and completion criteria without treating hypotheses as fact. For changes, reject missing owners, unrelated concepts collapsed into a generic component, governing-instruction violations, prohibited boundary leakage, duplicated authoritative behavior, purposeless abstractions, unclear composition or dependency direction, and placement too vague for build. Ask whether ownership still makes sense if infrastructure changes; shared owners across slices are expected, while private copies are not. Do not reject a generic name when it genuinely names one cohesive responsibility. Findings need contract references, evidence, and impact; zero is valid.
6. Write every response directly to the packet's `findingsPath` using its exact JSON schema, including `{"findings":[]}` for approval. Do not create review scratch files elsewhere in the project. Record it with `agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> --findings <findingsPath>`. Markdown findings are invalid.
7. If changes are requested, remediate each finding, run `agent-toolkit findings resolve <id>`, reconcile the artifacts, and follow `status`/`advance`.
8. Prepare one distinct fresh verifier with `agent-toolkit review prepare --stage design --role verifier`, then reuse that verifier context for closure retries. It may only reopen supplied findings, reject inaccurate dispositions, or identify a demonstrable high-severity regression introduced by remediation.
9. After two closure rejections, follow the explicit `review-escalation` decision instead of launching another reviewer or automatic remediation cycle. Continue still requires reasoned dispositions and final verifier approval.
10. Record verifier approval. A project frame exits at `active`; design its next milestone when requested. A change exits at `ready-to-build`, then ends this workflow. Do not run `agent-toolkit advance` from `ready-to-build`; the build skill owns the transition to `implementing`.

When subagents are unavailable, use the prepared review packet as the complete compact prompt for a separate session. The author must not impersonate either fresh reviewer.

## Exit

Before handoff, run `agent-toolkit check` and `agent-toolkit status`. Blocking questions must be closed. Stop at `active` for a reviewed project frame or `ready-to-build` for a reviewed change; hand buildable changes to the build skill.
