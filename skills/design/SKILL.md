---
name: design
description: Use when shaping a greenfield or brownfield feature, change, or fix before implementation, especially when domain rules, boundaries, contracts, risks, or slices need clarification.
---

# Design

Turn intent into a reviewed, buildable change artifact. The `agent-toolkit` CLI owns lifecycle state; never edit `.agent/.state` or infer progress from files alone.

## Start

1. Run `agent-toolkit init` if `.agent/` is absent.
2. Run `agent-toolkit start --kind feature --title "<title>"` for a feature or change. For a defect, hand off to the fix skill.
3. Run `agent-toolkit status`; follow the CLI's required next action.
4. Read the repository, tests, nearby contracts, and existing `.agent/SYSTEM.md` before proposing structure.

## System Map

If `.agent/SYSTEM.md` is absent or empty, bootstrap only the minimum relevant map using the structure created by the CLI. Record evidence, not aspirations. Update it when discovery changes language, responsibilities, dependencies, contracts, constraints, or known pressure. Keep unrelated areas out.

## Shape the Change

Shape the `.agent/changes/<slug>.md` artifact created by the CLI.

1. State the observable outcome and explicit non-goals.
2. Identify actors and desired outcomes. Catalog now, next, and later use cases without designing speculative features.
3. Establish ubiquitous language and use it consistently in prose, interfaces, and tests.
4. Write concrete happy, edge, and failure examples with inputs, context, and observable results.
5. Extract rules and invariants from examples. Resolve contradictions explicitly.
6. Locate domain, application, infrastructure, and external responsibilities only where those distinctions clarify ownership.
7. Specify public interfaces, boundary contracts, errors, idempotency, consistency, and dependency direction where relevant.
8. Trace risk-based tests to rules, contracts, and failure modes.
9. Write the implementation plan as ordered thin vertical slices. For each slice include its outcome, likely code areas, boundary or data changes, tests, dependencies, and completion signal.

Apply DDD tactically, not ceremonially. Introduce entities, value objects, aggregates, repositories, domain services, events, or bounded contexts only when behavior and language justify them.

Create an abstraction only when at least one is true:

- Shared variation exists across two or more known use cases.
- It has an independent behavioral contract.
- It forms a meaningful boundary.
- Retrofitting it later would be unusually costly.

Otherwise choose the direct design and record the extension pressure that would justify change later. For every empty adaptive template section, write a one-line reason it does not apply.

## Questions and Decisions

Own local, reversible implementation choices. Ask at most five questions total, and only when the answer changes product behavior, domain meaning, a system boundary, a public interface, or a consequential irreversible choice. Record decisions and remaining blockers in the artifact; do not turn preferences into user questions.

## Design Review

1. Reconcile the artifact and run `agent-toolkit check`.
2. Run `agent-toolkit advance` to enter `developer-review`. Present the completed design and implementation plan to the developer and explicitly invite corrections, omissions, and alternative decisions. Stop for their response; never infer approval.
3. For requested changes, record their comments with repeatable `--note "..."` flags or `--notes <file>` using `agent-toolkit feedback record --verdict changes-requested`, revise the artifact, and repeat the developer review. When the developer explicitly accepts it, run `agent-toolkit feedback record --verdict approved`.
4. Prepare a fresh critic with `agent-toolkit review prepare --stage design --role critic`.
5. Have a separate context inspect examples, omissions, domain rules, contracts, abstraction claims, risks, and plan viability.
6. Record it with `agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> [--findings <file>]`.
7. If changes are requested, remediate each finding, run `agent-toolkit findings resolve <id>`, reconcile the artifacts, and follow `status`/`advance`.
8. Prepare a distinct fresh verifier with `agent-toolkit review prepare --stage design --role verifier`; it must verify the remediated artifact rather than reuse the critic's conclusion.
9. Record the verifier verdict and advance only when the CLI permits `ready-to-build`.

When subagents are unavailable, use the prepared review packet as the complete compact prompt for a separate session. The author must not impersonate either fresh reviewer.

## Exit

Before handoff, run `agent-toolkit check` and `agent-toolkit status`. The artifact must be reviewed, questions that block implementation must be closed, and state must be `ready-to-build`.
