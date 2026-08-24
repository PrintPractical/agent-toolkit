---
name: build
description: Use when implementing an agent-toolkit change whose reviewed design is ready to build, including tests, quality review, artifact reconciliation, and commit creation.
---

# Build

Implement the reviewed design in thin vertical slices. The CLI enforces order and owns `.agent/.state`; call it rather than editing state data.

## Preconditions

1. Run `agent-toolkit status` and `agent-toolkit check`.
2. Require state `ready-to-build` and a reviewed `.agent/changes/<slug>.md`. If either is missing, return to design.
3. Read `.agent/SYSTEM.md`, the change artifact, affected code, tests, and repository conventions.
4. Use `agent-toolkit issue ensure` or `agent-toolkit issue link` when the workflow reports that issue association is required.
5. Before editing, extract a conformance checklist from the reviewed artifact: required ports, adapters, dependency directions, composition points, transaction boundaries, module constraints, and slice completion signals. Reviewed architecture is mandatory, not advisory.

## Implement

1. Use `agent-toolkit advance` to enter `implementing` when permitted.
2. Follow the artifact's implementation plan in slice order. Complete an entry point, core behavior, real boundary integration, and tests for one runnable outcome before starting the next slice; do not implement horizontal domain, persistence, transport, or wiring phases.
3. Preserve ubiquitous language, rules, boundaries, contracts, errors, and dependency direction from the reviewed design. Implement every reviewed port and outward adapter before placing concrete infrastructure behind it; compose concrete dependencies only at the system edge.
4. Update the change artifact when implementation evidence changes a decision. For material product, domain, boundary, public-interface, or plan changes, run `agent-toolkit review restart --stage design`; this returns the revision to developer feedback before fresh review.
5. Update `.agent/SYSTEM.md` only for durable system knowledge discovered or changed by the work.

Treat reviewed abstractions as acceptance criteria. When implementation reveals a meaningful domain or infrastructure boundary that the design missed, stop and restart design review rather than coupling inward policy to a concrete dependency. Prefer a narrow consumer-owned abstraction over direct coupling when uncertain, but avoid generic CRUD repositories, pass-through wrappers, marker interfaces, and layers with no behavioral contract. Default to a shallow module tree of small cohesive, independently testable types and operations; split files that mix unrelated policy, orchestration, and infrastructure without creating file-per-type ceremony.

## Test

Add meaningful unit tests for nontrivial rules and integration tests for real boundaries. Invoke tests through:

`agent-toolkit test --kind regression|unit|integration -- <command>`

Tests must assert behavior and contracts. Do not use a fake or mock as the system under test. Avoid tests that only restate structure, accessors, framework wiring, type declarations, or trivial delegation. Use substitutes only at boundaries when they make outcomes deterministic without replacing the behavior under test.

After each slice, run formatting/static checks, compile or build every affected target, and execute the smallest relevant behavioral and boundary tests through the CLI. Do not continue while the slice's runnable path has placeholders, unimplemented branches, or compile failures. Record test traceability and any justified gap, then run the complete relevant suite against the reconciled candidate.

## Quality Gate

1. Reconcile code, tests, the change artifact, and system map. Complete `Implementation Conformance` by mapping every reviewed boundary, abstraction, dependency rule, and slice to code and verification evidence; any material deviation requires design review restart. Then rerun relevant tests against that exact candidate.
2. Run `agent-toolkit check`, then use `status` and `advance` to seal the implementation baseline. Do not make quality-review edits before the CLI reports `baseline sealed`.
3. Prepare a mandatory fresh critic with `agent-toolkit review prepare --stage quality --role critic`.
4. Ask the critic to make one comprehensive pass over the sealed diff for correctness, requirements delivery, domain clarity, and exact architecture conformance. It must map reviewed ports, adapters, dependency directions, composition and transaction boundaries to the candidate, then inspect cohesion, test quality, regressions, and design drift. Concrete infrastructure leaking into an inward layer or an omitted reviewed abstraction is a material finding. Report all findings now, not optional improvements later.
5. Save requested findings to the packet's `findingsPath` using its exact JSON schema, then record them with `agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> [--findings <file>]`. Markdown findings are invalid.
6. If warranted, remediate findings with focused refactoring or correction, reconcile artifacts, test the resulting exact candidate, and run `agent-toolkit findings resolve <id>` for each completed finding.
7. Prepare a distinct fresh verifier using `agent-toolkit review prepare --stage quality --role verifier`. It performs a closure check against supplied findings, not a second critic pass; it may only reopen one of those findings or identify a high-severity regression introduced by remediation.
8. Record the verifier verdict; follow `status`/`advance` until `ready-to-commit`.

If subagents are unavailable, send the prepared compact packet to a separate session. Critic and verifier must be fresh, distinct contexts; the implementer cannot self-approve.

## Commit

1. Run all relevant tests plus `agent-toolkit check`.
2. Ensure artifacts describe the delivered behavior without stale questions; use CLI state for review findings and lifecycle status.
3. Follow `agent-toolkit status`: run `commit prepare` and inspect its exact candidate only when requested, otherwise run `advance`.
4. When requested, run `agent-toolkit commit create` to create the conventional commit.
5. Confirm `agent-toolkit status` reaches `complete`.

Never push. Do not bypass hooks, review gates, the baseline, or CLI sequencing.
