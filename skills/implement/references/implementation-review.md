# Behavior-Preserving Implementation Review

This document applies the bounded cycle in `adversarial-review.md` to completed standard implementation and refactor execution. It is snapshot-free: no per-file hashes, locks, epochs, or Git-index state are tracked.

## Core rule

A refactor changes implementation structure without changing observable behavior. Behavior includes outputs, errors, side effects, ordering and timing guarantees, persistence and wire formats, public types, resource ownership, operationally consumed telemetry, supported inputs, and compatibility surfaces.

For `class: refactor`, audit opportunities are proposals, not authorization. No source, configuration, documentation, or test file changes before the user selects exact `RF-NNN` IDs.

## Lifecycle

- **Standard implementation:** complete every plan section to a green baseline, then run one `RV-*` cycle over the whole change. Do not refactor per section.
- **Refactor execution:** execute selected opportunities to green, then run one `RV-*` cycle over the complete diff.
- **Triage:** excluded. It uses its lightweight self-check and no formal review log.

The formal cycle is:

```
all scoped work green
  -> fresh AUDITOR performs one broad discovery pass
  -> one consolidated RV blocker/major finding batch
  -> one behavior-preserving remediation
  -> tests green
  -> distinct fresh VERIFIER checks only original RV IDs
  -> at most one targeted correction and focused reverification
   -> implement approval
```

The auditor and verifier are distinct fresh read-only subagents, neither of which implemented the work. The verifier performs closure, not a second broad review.

## Discovery coverage

The auditor receives only idiom packs applicable to the effective scope and reviews deeply where applicable across data/state, data structures, interfaces/traits, errors, security, observability, simplicity, maintainability, and idioms. No mandatory `N/A` report is required. The pass must also catch unsafe or panic-prone recoverable paths, swallowed errors, wrong ownership or dependency direction, monolithic responsibilities, duplication, leaky abstractions, dead/debug/placeholder code, and operational risks from persistence, concurrency, resources, networking, or deployment.

Specialized lenses may run in parallel as one coordinated discovery pass:

- Scope, architecture, and contract mapping
- Structure, dependency, state, and data review
- Language idioms and error/safety review
- Tests and preservation coverage
- Runtime, security, and operational risk when applicable

They report to one consolidator. They do not produce later batches.

## Findings and bounded closure

Use the `RV-NNN` finding contract from `adversarial-review.md`: severity `blocker|major`; category `correctness|security|simplicity|maintainability|idioms`; concrete evidence, impact, and alternative. Record all findings in one artifact table. A clean pass records a brief evidence-based rationale.

Resolve the complete batch once. Local/private/reversible idiomatic choices are agent-owned. Escalate decisions at the materiality boundary. Firm-seam tests stay green; a firm-seam failure is a kickback, never a test edit.

After tests are green, the verifier checks only the original `RV-*` IDs and records each as resolved or unresolved. Verification must not repeat discovery, expand scope, or introduce new low/major findings. A remediation-caused blocker regression is the only new-ID exception: record it with `--regression`, correct it within the same focused scope, and close it with `--regression-resolution` during the one targeted reverification. If any ID remains unresolved or safety requires broad review, stop and kick back.

## Review log

`review-log.mjs` records the structured approval attestation. Use cycle `implement-1` for a feature or `refactor-1` for refactor execution. Put the same `RV-*` details in `plan.md` or `refactor.md`:

```
node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --phase <implement|refactor> --cycle <implement-1|refactor-1> \
  --role auditor --reviewer "<fresh label>" --verdict changes-requested \
  --finding '{"id":"RV-001","severity":"blocker","category":"correctness","location":"src/io.rs:42","impact":"request panic","alternative":"return a typed error"}'

node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --phase <implement|refactor> --cycle <implement-1|refactor-1> \
  --role verifier --reviewer "<distinct fresh label>" --verdict approved \
  --resolution RV-001=resolved
```

If focused verification detects a blocker regression caused by remediation, the initial verifier records `--regression '<structured blocker finding JSON>'`; the fresh targeted verifier records `--regression-resolution RV-NNN=resolved`. Verifiers never record new major or low findings.

The auditor may record `approved` with no `--finding` when there are no findings, with the rationale in the artifact. The final entry still must be an approved verifier backed by a differently labeled auditor. This label is an attestation, not identity proof; the orchestrator must launch genuinely fresh contexts.

## Refactor opportunity audit

The pre-selection refactor audit is an opportunity inventory, separate from the post-execution `RV-*` cycle. It may use the discovery lenses above, remains read-only, and produces stable `RF-*` opportunities. It does not authorize implementation.

Every persisted opportunity in `refactor.md` contains:

| Field | Requirement |
|---|---|
| `id` | Stable `RF-NNN`; never renumbered or reused |
| `rank` | Explicit ordering after risk/effort/dependency adjustment |
| `title` | Concrete structural outcome |
| `status` | `proposed`, `selected`, `deferred`, `rejected`, `blocked`, `complete`, or `escalated-architect` |
| `scope` | Paths, symbols, component/layer/package, and languages |
| `evidence` | File/symbol/line, tool output, or measured observation |
| `payoff` | Specific maintenance, clarity, safety, or cost benefit |
| `behavior_argument` | Why all named observables remain invariant |
| `invariants` | Assertions implementation and review will check |
| `seams` | IDs/names, firmness, CONTEXT sources, and interaction |
| `risk` | `low`, `medium`, or `high`, with reason |
| `effort` | `small`, `medium`, or `large`, with reason |
| `coverage` | Existing protection, commands, and gaps |
| `dependencies` | Other IDs and external prerequisites |
| `conflicts` | Other IDs, active work, or file overlap |
| `files` | Proposed file set |
| `verification` | Targeted and broader commands |
| `sources` | Audit lenses supporting the opportunity |
| `disposition` | Selection/completion evidence, blocker, deferral, rejection, or handoff reason |

An opportunity missing evidence or a behavior-preservation argument is not executable.

## Local cleanup boundary

Local execution is allowed only when behavior and firm seams remain unchanged, scope is bounded to selected opportunities or the change's files, tests can establish current behavior, no material product/domain/architecture/compatibility/security/data-migration/operational-policy decision is needed, and verification is green.

Examples include bounded extraction or inline operations, splitting private monolithic responsibilities, renaming internals, removing proven dead private code, consolidating equivalent private logic, simplifying private control flow, replacing panic-prone handling with equivalent typed propagation, and choosing an equivalent idiomatic private mechanism.

## Architect boundary

Record a refactor opportunity as `escalated-architect`, or kick standard implementation upstream, when observable behavior or a firm seam would change; behavior is disputed or cannot be characterized; a public API, protocol, storage format, error semantic, timing/ordering guarantee, side effect, or compatibility policy changes; a consequential seam is created or removed; or dependency migration, security policy, performance, data migration, or operational policy needs a material decision.

The handoff includes the finding/opportunity ID, evidence, desired outcome, affected seams, contract delta, risks, and dependencies.
