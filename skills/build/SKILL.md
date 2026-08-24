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

## Implement

1. Use `agent-toolkit advance` to enter `implementing` when permitted.
2. Follow the artifact's implementation plan in slice order, keeping each slice observable and integrated.
3. Preserve ubiquitous language, rules, boundaries, contracts, errors, and dependency direction from the reviewed design.
4. Update the change artifact when implementation evidence changes a decision. For material product, domain, boundary, public-interface, or plan changes, run `agent-toolkit review restart --stage design`; this returns the revision to developer feedback before fresh review.
5. Update `.agent/SYSTEM.md` only for durable system knowledge discovered or changed by the work.

Prefer direct code until the design's abstraction criteria are met. Do not add speculative layers, generic repositories, events, factories, or interfaces merely to resemble a pattern.

## Test

Add meaningful unit tests for nontrivial rules and integration tests for real boundaries. Invoke tests through:

`agent-toolkit test --kind regression|unit|integration -- <command>`

Tests must assert behavior and contracts. Do not use a fake or mock as the system under test. Avoid tests that only restate structure, accessors, framework wiring, type declarations, or trivial delegation. Use substitutes only at boundaries when they make outcomes deterministic without replacing the behavior under test.

Run the smallest relevant checks after each slice. Record test traceability and any justified gap in the change artifact, then run the complete relevant suite against the reconciled candidate.

## Quality Gate

1. Reconcile code, tests, the change artifact, and system map, then rerun the relevant tests against that exact candidate.
2. Run `agent-toolkit check`, then use `status` and `advance` to seal the implementation baseline. Do not make quality-review edits before the CLI reports `baseline sealed`.
3. Prepare a mandatory fresh critic with `agent-toolkit review prepare --stage quality --role critic`.
4. Ask the critic to inspect the sealed diff for correctness, simplification, duplication, domain clarity, boundary integrity, test quality, regressions, and design drift.
5. Record its verdict with `agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> [--findings <file>]`.
6. If warranted, remediate findings with focused refactoring or correction, reconcile artifacts, test the resulting exact candidate, and run `agent-toolkit findings resolve <id>` for each completed finding.
7. Prepare a distinct fresh verifier using `agent-toolkit review prepare --stage quality --role verifier`. It verifies the final code and tests against the design and findings.
8. Record the verifier verdict; follow `status`/`advance` until `ready-to-commit`.

If subagents are unavailable, send the prepared compact packet to a separate session. Critic and verifier must be fresh, distinct contexts; the implementer cannot self-approve.

## Commit

1. Run all relevant tests plus `agent-toolkit check`.
2. Ensure artifacts describe the delivered behavior without stale questions; use CLI state for review findings and lifecycle status.
3. Follow `agent-toolkit status`: run `commit prepare` and inspect its exact candidate only when requested, otherwise run `advance`.
4. When requested, run `agent-toolkit commit create` to create the conventional commit.
5. Confirm `agent-toolkit status` reaches `complete`.

Never push. Do not bypass hooks, review gates, the baseline, or CLI sequencing.
