# Behavior-Preserving Implementation Review

This document defines the independent implementation-review model used by standard changes, triage fixes, and maintenance refactors. The review roles, the two-reviewer separation, the report record, and the local-cleanup boundary apply to all of them. The audit, ranking, opportunity, and explicit-selection sections apply only to `class: refactor`.

The review is deliberately **snapshot-free**. It tracks no per-file content hashes, locks, epochs, or Git-index state. What it enforces is a simple, hard-to-skip cycle: a fresh reviewer looks at the finished work, records findings, the work is cleaned up, tests stay green, and a distinct fresh reviewer approves. `review-log.mjs` records that cycle and `manifest-gate.mjs` refuses the gate until it is satisfied.

## Core rule

A refactor changes implementation structure without changing observable behavior. Review must account for more than return values: errors, side effects, ordering, timing guarantees, persistence, wire/storage formats, public types, resource ownership, logs or metrics relied on operationally, supported inputs, and compatibility surfaces can all be behavior.

For `class: refactor`, audit findings are proposals, not authorization. No source, configuration, documentation, or test file may change before the user explicitly selects stable opportunity IDs.

## Where review runs in the lifecycle

- **Standard / triage (`implement`):** implement each plan section to a green test baseline (L2: `implement → tests green`, per section, no per-section refactor). After **all** sections are green, run **one** independent review-and-refactor pass (L3) over the whole change. The L3 review gates the `implement` gate.
- **Refactor class:** there is no L2 — the change *is* the L3 pass applied to the user-selected opportunities. The review gates the `implement` (execution) gate.

L3 always has the same shape:

```
all work green
  → fresh AUDITOR subagent records findings   (review-log.mjs, role=auditor)
  → behavior-preserving refactor applied
  → full test suite green (firm-seam failure = kickback, never a test edit)
  → fresh VERIFIER subagent approves           (review-log.mjs, role=verifier)
  → implement gate
```

The auditor and verifier are **two distinct fresh subagents**, each launched in its own context, neither of which produced the implementation. `review-log.mjs` refuses an `approved` verifier verdict unless a prior auditor review from a *different* reviewer label exists for the stage.

## What every reviewer must do

Both the auditor and the verifier are read-only and MUST, for the code in scope:

1. **Load the idiom pack for every language detected in scope** (`references/idioms/<lang>.md`) and review the code against its Power Checklist and Smell List. The idiom pack — not a separate checklist maintained here — is the source of truth for language quality. If no pack exists for a language, say so and use the repository's conventions and tooling.
2. **Hunt for unsafe and panic-prone code.** Flag `unsafe`/FFI without a stated safety contract, and reachable panics on recoverable conditions (in Rust: `.unwrap()`/`.expect()`/`panic!`/`todo!`/`unreachable!`/panicking indexing on I/O, parsing, input, env, locks, channels, task joins; the equivalent in other languages). Swallowed or ignored errors count.
3. **Judge structure.** Flag oversized, multi-responsibility, or monolithic modules (for example, most of a crate's logic living in `src/lib.rs`/`src/main.rs` instead of focused modules composed by higher-level ones), duplication, leaky abstractions, tangled control flow, and wrong dependency direction.
4. **Check hygiene.** Dead code, commented-out code, debug prints, stray placeholders/TODOs, and inconsistent naming.

A reviewer that finds nothing must say why the code is already sound, not stay silent. `review-log.mjs` requires at least one finding when the verdict is `changes-requested`.

## Review roles

Run roles independently and in parallel when possible. Audit roles are read-only; they may write findings only to the active maintenance artifact and the review log. For small standard changes a single auditor subagent may cover all roles; for a refactor, prefer separate role coverage.

### Scope and architecture mapper

- Maps requested scope to concrete first-party paths and records exclusions.
- Reads relevant CONTEXT files, seams, dependencies, and Known Soft Spots.
- Identifies cross-component effects, active-change overlap, generated ownership, and likely batch boundaries.
- Does not infer that an undocumented boundary is safe to change.

### Behavior and contract guardian

- Enumerates observables and invariants for each candidate.
- Locates firm seams, public contracts, compatibility surfaces, and enforcing tests.
- Rejects behavior-changing candidates from local execution.
- Treats ambiguity as a blocker, not permission.

### Structure and dependency reviewer

- Finds duplication, unnecessary coupling, misplaced responsibilities, tangled control flow, dead paths, leaky abstractions, oversized/monolithic modules, and dependency-direction problems.
- Requires concrete file/symbol evidence and a bounded structural alternative.
- Distinguishes local cleanup from redesign or dependency migration.

### Language-idiom reviewer

- One reviewer covers each language detected in scope and loads that language's idiom pack.
- Finds transliteration, unsafe escape hatches, panic-prone and non-idiomatic resource/error/concurrency patterns, and missed language capabilities.
- Does not recommend syntax churn without a specific payoff and preservation argument.

### Tests and coverage reviewer

- Maps existing tests to behavior and seams.
- Identifies relevant baseline commands, existing failures, brittle structural tests, and behavior gaps requiring characterization before cleanup.
- Never edits or creates tests during audit.

### Runtime and operational-risk reviewer

Use when scope includes persistence, concurrency, resource lifecycle, networking, deployment, or observability.

- Checks ordering, retries, cancellation, cleanup, race exposure, data compatibility, performance guarantees, and operationally consumed telemetry.
- Flags changes that look local in code but alter runtime behavior.

### Fresh verifier (final reviewer)

- Must not be the implementer or the auditor for this workflow. A distinct self-declared reviewer label is required.
- Reviews the complete refactored diff rather than relying on opportunity summaries.
- Confirms every auditor finding was resolved or explicitly deferred with a rationale, replays preservation arguments against CONTEXT/firm seams/idiom guidance, and confirms tests are green.
- Reports findings; it does not silently fix them. Any new fix is another refactor pass followed by another fresh verifier review.

## Phases

### 1. Orient

Normalize scope, exclude non-first-party/tool-owned material, discover CONTEXT, enumerate firm seams, detect every scoped language, and load all matching idiom packs.

### 2. Audit (fresh auditor subagent)

Run the specialized read-only roles. Findings must cite evidence (`file:line`) and name the observables that constrain a safe change, covering idioms, unsafe/panics, structure, and hygiene as above. Record the outcome:

```
node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --stage <implement|refactor> \
  --role auditor --reviewer "<self-declared label>" \
  --verdict changes-requested \
  --finding "src/io.rs:42 [safety] .expect() on I/O — return Result" \
  --finding "src/lib.rs [structure] split monolith into focused modules"
```

Use `--verdict approved` only if the finished work genuinely needs no cleanup; state that rationale in the skill narrative.

### 3. Select (refactor class only)

The user selects exact opportunity IDs. Record the response verbatim and close dependencies explicitly. No exact selection means no execution.

### 4. Refactor (behavior-preserving)

Resolve auditor findings and independently remove dead code, duplication, unclear responsibilities, obscured flow, idiom violations, panic-prone and unsafe patterns, and poor error handling. Do not change observable behavior. Firm-seam tests must stay green throughout; a firm-seam test that goes red means behavior changed — stop and kick back, never edit the test to pass.

### 5. Verify (fresh verifier subagent)

Run the full applicable test suite; it must be green. Then launch a distinct fresh verifier subagent that re-loads the idiom packs, confirms the four review areas, and confirms every auditor finding is resolved or deferred:

```
node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --stage <implement|refactor> \
  --role verifier --reviewer "<distinct self-declared label>" --verdict approved
```

`changes-requested` from the verifier returns to phase 4 with a new fresh reviewer. A behavior/contract concern is escalated, not resolved locally.

### 6. Gate

`manifest-gate.mjs --gate implement --approve` reads the review log and refuses unless the latest entry for the stage is an `approved` verifier verdict backed by a distinct prior auditor review. There is no separate certification step, snapshot, or index check.

### 7. Reconcile and archive

Reconcile CONTEXT Known Soft Spots and soft structural prose, update relevant developer docs, verify provenance, obtain docs approval, and archive the complete artifact. Firm criteria do not change in this phase.

## Review record schema

Each `review-log.mjs record` appends one entry to `.changes/active/<id>/reviews.json`:

```json
{
  "version": 1,
  "stage": "implement",
  "role": "auditor",
  "reviewer": "<self-declared nonempty label>",
  "verdict": "changes-requested",
  "findings": [
    "src/io.rs:42 [safety] .expect() on I/O — return Result or handle"
  ],
  "at": "<iso-8601>"
}
```

`stage` is `implement` (standard/triage) or `refactor` (refactor class). `role` is `auditor` or `verifier`. `verdict` is `approved` or `changes-requested`; a `changes-requested` entry requires at least one finding. Each finding is a short `"<file[:line]> [category] <required action>"` string, where category is `safety`, `idioms`, `structure`, or `hygiene`. The reviewer label is self-declared and does not prove real-world identity — the orchestrator must still launch genuinely fresh subagents — but the log blocks an approved verifier from reusing the auditor's label, so the two reviewers are at least distinct.

## Opportunity report schema (refactor class)

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
| `invariants` | Assertions the implementation and reviewer will check |
| `seams` | IDs/names, firmness, CONTEXT sources, and interaction |
| `risk` | `low`, `medium`, or `high`, with reason |
| `effort` | `small`, `medium`, or `large`, with reason |
| `coverage` | Existing protection, commands, and gaps |
| `dependencies` | Other IDs and external prerequisites |
| `conflicts` | Other IDs, active work, or file overlap |
| `files` | Proposed file set |
| `verification` | Targeted and broader commands |
| `sources` | Audit roles that independently support the finding |
| `disposition` | Selection/completion evidence, blocker, deferral, rejection, or handoff reason |

An opportunity missing evidence or a behavior-preservation argument is not executable.

## Local cleanup boundary

Local refactor execution is allowed when all of these hold:

- The outcome is strictly behavior-preserving.
- Firm seams and firm-seam tests remain unchanged.
- The structural change is bounded to selected opportunities (refactor class) or the change's own files (standard).
- Existing tests or added characterization can establish the current behavior.
- The change does not require a product, domain, architecture, compatibility, data-migration, or operational-policy decision.
- Relevant verification is green.

Examples include bounded extraction/inline operations, splitting a monolithic module into focused ones, renaming internals, removing proven dead private code, consolidating equivalent private logic, simplifying control flow, replacing a panic-prone path with proper error handling, and replacing a private mechanism with an equivalent idiomatic one.

## Architect boundary

Record the candidate as `escalated-architect` and do not execute it here when any of these is true:

- Any observable behavior is intended to change, including a bug fix.
- A firm seam, firm contract, firm criterion, or firm-seam test would change.
- Current behavior is disputed, unknowable, or cannot be safely characterized.
- Public API, protocol, storage format, supported input, error semantics, ordering/timing guarantee, side effect, or compatibility policy would change.
- The work creates/removes a consequential seam or needs a cross-component architectural decision rather than a bounded structural substitution.
- A dependency upgrade, data migration, security policy, performance tradeoff, or operational policy needs approval.
- Safe execution requires expanding beyond selected scope and the user has not approved a new audit/selection record.

The handoff includes the opportunity ID, evidence, desired outcome, affected seams, behavior/contract delta, risks, and dependencies. Refactor does not invoke the firm-change protocol itself; `architect` owns that deliberation.
