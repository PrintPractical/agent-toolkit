---
name: design
description: Use when shaping a greenfield or brownfield feature, change, or fix before implementation, especially when domain rules, boundaries, contracts, risks, or slices need clarification.
---

# Design

Turn intent into a reviewed, buildable change artifact. The `agent-toolkit` CLI owns lifecycle state; never edit `.agent/.state` or infer progress from files alone.

## Project Instructions

Before planning or editing, read every applicable `AGENTS.md` in the project. Treat its instructions as binding requirements for all subsequent work. If this skill's general guidance conflicts with an `AGENTS.md` requirement, the `AGENTS.md` takes precedence; do not simplify, reinterpret, or override that requirement.

## Start

1. Run `agent-toolkit init` if `.agent/` is absent.
2. Run `agent-toolkit start --kind feature --title "<title>"` for a feature or change. For a defect, hand off to the fix skill.
3. Run `agent-toolkit status`; follow the CLI's required next action.
4. Read the repository, tests, nearby contracts, the projects AGENTS.md file if exists, and existing `.agent/SYSTEM.md` before proposing structure.

## System Map

If `.agent/SYSTEM.md` is absent or empty, bootstrap only the minimum relevant map using the structure created by the CLI. Record evidence, not aspirations. Update it when discovery changes language, responsibilities, dependencies, contracts, constraints, or known pressure. Keep unrelated areas out.

## Shape the Change

Shape the `.agent/changes/<slug>.md` artifact created by the CLI.

1. State the observable outcome and explicit non-goals.
2. Enumerate every explicit source requirement and trace it to a use case, rule, interface, test, or non-goal. Then identify actors and desired outcomes across now, next, and later horizons without designing speculative features.
3. Establish ubiquitous language and use it consistently in prose, interfaces, and tests.
4. Write concrete happy, edge, and failure examples with inputs, context, and observable results.
5. Extract rules and invariants from examples. Resolve contradictions explicitly.
6. Locate domain, application, infrastructure, and external responsibilities. Name dependency direction, ownership, composition, and transaction boundaries wherever behavior crosses them.
7. Specify public interfaces and inward-owned boundary contracts, including errors, idempotency, consistency, and outward adapters.
8. Trace risk-based tests to rules, contracts, and failure modes.
9. Write the implementation plan as ordered thin vertical slices using the template fields. Every slice must produce runnable behavior from an entry point through core policy to a real boundary where applicable; layer-only phases are not slices. Give each slice one JSON-array acceptance command that executes its observable path, not merely compilation or isolated unit tests.

Apply DDD tactically, not ceremonially. Introduce entities, value objects, aggregates, repositories, domain services, events, or bounded contexts when behavior, language, or a meaningful boundary justifies them. Where project instructions do not prescribe module layout, prefer a shallow module tree of small cohesive, independently testable concepts over layer-wide files or deeply nested ceremony.

Create an abstraction only when at least one is true:

- A domain or application capability crosses into storage, transport, time, identity, messaging, or another external system.
- Shared variation exists across two or more known use cases.
- It has an independent behavioral contract.
- It forms a meaningful boundary.
- Retrofitting it later would be unusually costly.

At a meaningful boundary, prefer a narrow contract owned by the inward consumer and an outward adapter even when only one implementation exists. Shape repositories and ports around behavior, transactions, and consistency rather than generic CRUD. Direct coupling is acceptable only for local, private mechanism with no policy boundary; justify it explicitly. Do not invent pass-through layers or interfaces without contracts. For every empty adaptive template section, write a one-line reason it does not apply.

Logical dependency boundaries are independent of packaging. A single crate, package, or deployable may still require domain, application, port, adapter, and composition responsibilities; never treat package count as a substitute for dependency direction.

## Questions and Decisions

Own local, reversible implementation choices. Ask at most five questions total, and only when the answer changes product behavior, domain meaning, a system boundary, a public interface, or a consequential irreversible choice. Record decisions and remaining blockers in the artifact; do not turn preferences into user questions.

## Design Review

1. Reconcile the artifact and run `agent-toolkit check`.
2. Run `agent-toolkit advance` to enter `developer-review`. Present the completed design and implementation plan to the developer and explicitly invite corrections, omissions, and alternative decisions. Stop for their response; never infer approval.
3. For requested changes, record their comments with repeatable `--note "..."` flags or `--notes <file>` using `agent-toolkit feedback record --verdict changes-requested`, revise the artifact, and repeat the developer review. When the developer explicitly accepts it, run `agent-toolkit feedback record --verdict approved`.
4. Prepare a fresh critic with `agent-toolkit review prepare --stage design --role critic`.
5. Have a separate context make one comprehensive pass over requirements traceability, examples, domain rules, dependency direction, boundary contracts, abstraction decisions, risks, and whether every plan slice is truly vertical. It must report every material finding now, without demanding exhaustive detail for agent-owned reversible implementation choices.
6. Save requested findings to the packet's `findingsPath` using its exact JSON schema, then record them with `agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> [--findings <file>]`. Markdown findings are invalid.
7. If changes are requested, remediate each finding, run `agent-toolkit findings resolve <id>`, reconcile the artifacts, and follow `status`/`advance`.
8. Prepare a distinct fresh verifier with `agent-toolkit review prepare --stage design --role verifier`. This is a closure check, not another critic: it may only reopen a supplied finding or identify a high-severity regression introduced by remediation, using the packet's JSON schema.
9. Record the verifier verdict. Its approval moves the change to `ready-to-build`. Run `agent-toolkit status` to confirm it, then end the design workflow. Do not run `agent-toolkit advance` from `ready-to-build`; the build skill owns the transition to `implementing`.

When subagents are unavailable, use the prepared review packet as the complete compact prompt for a separate session. The author must not impersonate either fresh reviewer.

## Exit

Before handoff, run `agent-toolkit check` and `agent-toolkit status`. The artifact must be reviewed, questions that block implementation must be closed, and state must be `ready-to-build`. Stop there and hand off to the build skill.
