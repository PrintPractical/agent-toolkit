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

Read every supplied source fully and inspect the repository. Normalize requirements into `.agent/projects/<slug>.md` without copying sources: record fingerprints, outcomes, users, non-goals, acceptance, constraints, quality attributes, risks, questions, and completion criteria. Mark decisions `observed`, `committed`, `hypothesis`, or `rejected`; resolve material ambiguity with the engineer.

Create a provisional roadmap of independent milestones. Each is a normal `feature` or `fix` with its own full lifecycle and commit; split work too broad for one design and quality review. Record dependencies and coverage, not APIs, schemas, or architecture that milestone design should discover. Without sources, frame conversationally over as many rounds as needed.

## System Map

If `.agent/SYSTEM.md` is absent or empty, bootstrap only the minimum relevant map using the structure created by the CLI. Record evidence, not aspirations. Update it when discovery changes language, responsibilities, dependencies, contracts, constraints, or known pressure. Keep unrelated areas out.

## Shape a Change

Shape `.agent/changes/<slug>.md`. For a milestone, read its project frame, sources, coverage, discoveries, system map, and earlier evidence. Milestone design owns concrete APIs, schemas, boundaries, and placement; do not reinterpret sources outside the reviewed project contract.

1. State the observable outcome and explicit non-goals.
2. Enumerate every explicit source requirement, including applicable project instructions, and trace it to a use case, rule, interface, test, placement constraint, or non-goal. Then identify actors and desired outcomes across now, next, and later horizons without designing speculative features.
3. Clarify any terms and distinctions needed to make the change unambiguous.
4. Write concrete happy, edge, and failure examples with inputs, context, and observable results.
5. Extract rules and invariants from examples. Resolve contradictions explicitly.
6. Identify relevant responsibilities, dependencies, ownership, integration points, and failure behavior. Follow applicable project instructions for architecture and module layout.
7. Translate responsibilities and `AGENTS.md` organization rules into a compact placement plan. Name expected file/module actions, responsibilities, and slices; use globs when premature. Paths are forecasts, while constraints, ownership, and dependency direction bind.
8. Specify changed public interfaces, errors, idempotency, consistency, and external integrations.
9. Define the applicable support envelope for risky behavior: supported inputs and limits, identity, ordering, cancellation, re-registration, shutdown, concurrency, and scale guarantees. Mark irrelevant dimensions as not applicable rather than inventing guarantees.
10. Record the closest existing capability and reuse decision. Extend its owner when the contract fits; parallel code needs a concrete semantic or ownership distinction.
11. Trace risk-based tests to rules, contracts, and failure modes.
12. Plan ordered thin vertical slices using every template field. Each produces runnable behavior from entry point through policy to a real boundary; layer-only phases are invalid. Give each one a JSON-array acceptance command for its observable path.

Choose architecture, module layout, and abstractions from the project's existing patterns and applicable project instructions. Add abstractions only for a clear behavioral purpose or known variation; avoid generic layers, pass-through wrappers, and parallel code without a concrete distinction. Explain every inapplicable template section in one line.

## Questions and Decisions

Own local, reversible implementation choices. Ask at most five material questions at once, and only when answers change outcomes, project terminology, an integration boundary, a public interface, or a consequential irreversible choice. Project framing may use multiple rounds. Record decisions and blockers in the applicable artifact; do not turn preferences into user questions.

## Design Review

1. Reconcile the artifact and run `agent-toolkit check`.
2. Run `agent-toolkit advance` to enter `developer-review`. Present the completed project frame or change design to the developer and explicitly invite corrections, omissions, and alternative decisions. Stop for their response; never infer approval.
3. For requested changes, record their comments with repeatable `--note "..."` flags or `--notes <file>` using `agent-toolkit feedback record --verdict changes-requested`, revise the artifact, and repeat the developer review. When the developer explicitly accepts it, run `agent-toolkit feedback record --verdict approved`.
4. Prepare a fresh critic with `agent-toolkit review prepare --stage design --role critic`.
5. A separate context completes the checklist and one comprehensive pass. For projects, review framing, source traceability, constraints, decisions, coverage, dependencies, and completion criteria without treating hypotheses as fact. For changes, review support envelope, rules, boundaries, abstractions, placement, risks, and slices. Findings need contract references, evidence, and impact; zero is valid.
6. Write every response directly to the packet's `findingsPath` using its exact JSON schema, including `{"findings":[]}` for approval. Do not create review scratch files elsewhere in the project. Record it with `agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> --findings <findingsPath>`. Markdown findings are invalid.
7. If changes are requested, remediate each finding, run `agent-toolkit findings resolve <id>`, reconcile the artifacts, and follow `status`/`advance`.
8. Prepare one distinct fresh verifier with `agent-toolkit review prepare --stage design --role verifier`, then reuse that verifier context for closure retries. It may only reopen supplied findings, reject inaccurate dispositions, or identify a demonstrable high-severity regression introduced by remediation.
9. After two closure rejections, follow the explicit `review-escalation` decision instead of launching another reviewer or automatic remediation cycle. Continue still requires reasoned dispositions and final verifier approval.
10. Record verifier approval. A project frame exits at `active`; design its next milestone when requested. A change exits at `ready-to-build`, then ends this workflow. Do not run `agent-toolkit advance` from `ready-to-build`; the build skill owns the transition to `implementing`.

When subagents are unavailable, use the prepared review packet as the complete compact prompt for a separate session. The author must not impersonate either fresh reviewer.

## Exit

Before handoff, run `agent-toolkit check` and `agent-toolkit status`. Blocking questions must be closed. Stop at `active` for a reviewed project frame or `ready-to-build` for a reviewed change; hand buildable changes to the build skill.
