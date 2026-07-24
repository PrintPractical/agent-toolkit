# Behavior-Preserving Implementation Review

This document defines the independent implementation-review model used by standard changes, triage, and maintenance refactors. The report schema, checkpoint phases, reviewer separation, and local-cleanup boundary apply to all three. The audit, ranking, opportunity, and explicit-selection sections apply only to `class: refactor`.

## Core rule

A refactor changes implementation structure without changing observable behavior. Review must account for more than return values: errors, side effects, ordering, timing guarantees, persistence, wire/storage formats, public types, resource ownership, logs or metrics relied on operationally, supported inputs, and compatibility surfaces can all be behavior.

For `class: refactor`, audit findings are proposals, not authorization. No source, configuration, documentation, snapshot, or test file may change before the user explicitly selects stable opportunity IDs.

## Review roles

Run roles independently and in parallel when possible. Audit roles are read-only. They may write findings only to the active maintenance artifact.

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

- Finds duplication, unnecessary coupling, misplaced responsibilities, tangled control flow, dead paths, leaky abstractions, and dependency-direction problems.
- Requires concrete file/symbol evidence and a bounded structural alternative.
- Distinguishes local cleanup from redesign or dependency migration.

### Language-idiom reviewer

- One reviewer covers each language detected in scope and loads that language's idiom pack when available.
- Finds transliteration, unsafe escape hatches, non-idiomatic resource/error/concurrency patterns, and missed language capabilities.
- Does not recommend syntax churn without a specific payoff and preservation argument.

### Tests and coverage reviewer

- Maps existing tests to behavior and seams.
- Identifies relevant baseline commands, existing failures, brittle structural tests, and behavior gaps requiring post-selection characterization.
- Never edits or creates tests during audit.

### Runtime and operational-risk reviewer

Use when scope includes persistence, concurrency, resource lifecycle, networking, deployment, or observability.

- Checks ordering, retries, cancellation, cleanup, race exposure, data compatibility, performance guarantees, and operationally consumed telemetry.
- Flags changes that look local in code but alter runtime behavior.

### Fresh final reviewer

- Must not be an audit/readiness reviewer or implementer for this workflow.
- Reviews the complete selected diff rather than relying on opportunity summaries.
- Replays preservation arguments against CONTEXT, firm seams, idiom guidance, and verification evidence.
- Reports findings; it does not silently fix them. Any fix is a new declared batch followed by another fresh review.

## Phases

### 1. Orient

Normalize scope, exclude non-first-party/tool-owned material, discover CONTEXT, enumerate firm seams, detect every scoped language, load all matching idiom packs, and record worktree/active-change state.

### 2. Audit

Run specialized read-only roles. Findings must cite evidence and name the observables that constrain a safe change. No implementation or characterization-test edits are allowed.

### 3. Synthesize

Deduplicate, apply the architect boundary, assign stable IDs, rank opportunities, and persist the complete report. Stable IDs are never renumbered or reused.

### 4. Select

The user selects exact IDs. Record the response verbatim and close dependencies explicitly. No exact selection means no execution.

### 5. Establish baseline

Check overlapping dirty work and run relevant existing tests. Overlap or a relevant pre-existing failure blocks execution. For selected behavior lacking coverage, add minimal passing characterization tests. Declare every unit in the canonical `.changes/active/<id>/implementation-units.json`; each declaration requires `id`, exact `files`, `lockedTestFiles`, exact `baselineCommand`, and exact `finalCommand`. Every path has exactly one unit owner. Standard and triage plans contain machine-readable checkpoint IDs, exact editable/locked JSON path arrays, and commands that all match the declarations. Refactor tables additionally assign every user-approved RF ID to exactly one matching batch and no unselected ID. The plan/refactor approval gate stores a normalized digest of this contract, so it cannot change between approval and initialization. Initialize `implementation-checkpoint.mjs` in a Git repository with a valid HEAD, then advance each unchanged unit from `building` to `green` with its exact declared baseline command. A unit cannot alter another unit's paths outside that unit's cycle. The first green snapshot permanently establishes the cycle-lock baseline for that epoch.

### 6. Execute batches

Each small coherent batch declares selected IDs, exact files, invariants, firm seams, cycle-locked tests, exact baseline and final commands, dependencies, and rollback boundary before edits. A snapshot-bound initial review with verdict `ready-for-refactor` advances the unit from `green` to `reviewed`; `--start-refactor` advances it to `refactoring`. After edits, `--final-test` runs the exact declared final command, verifies locks, and advances the unit to `tested`.

### 7. Verify and review

Run full applicable verification, then obtain a fresh final review. Resolve local findings through declared work; escalate behavior/contract findings. A snapshot-bound final review with verdict `behavior-preserved` advances each unit from `tested` to `verified`; `--check-all` certifies that all expected units and locks remain current.

Checkpoint state binds the manifest's integer `checkpoint_epoch`, gate-approved contract digest, initialization HEAD/worktree, and a digest of the canonical declarations. For refactors, the contract digest includes each selected opportunity's complete ranked record as well as its batch assignment, paths, locks, and commands, so an approved opportunity cannot be redefined afterward. It rejects index/worktree divergence, undeclared committed or uncommitted changes, and cross-unit path drift. A kickback or upstream authorization-gate reset increments the epoch, clears downstream authorization, and makes prior state stale. After a standard kickback is resolved and its amended plan is re-approved, or after a refactor reselection is approved, reset only with `implementation-checkpoint.mjs --id <id> --reset --units .changes/active/<id>/implementation-units.json`; this archives prior state and reviews and initializes state for the new epoch and declaration digest.

A locked test that changes after its first green snapshot cannot be rebaselined in the same epoch. Restore the locked content or kick back; never accept the changed lock by running another baseline.

### 8. Reconcile and archive

Reconcile CONTEXT Known Soft Spots and soft structural prose, update relevant developer docs, verify provenance, obtain docs approval, and archive the complete artifact. Firm criteria do not change in this phase.

## Opportunity report schema

Every persisted opportunity contains:

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
| `files` | Proposed file set; final batches declare exact allowed files |
| `verification` | Targeted and broader commands |
| `sources` | Audit roles that independently support the finding |
| `disposition` | Selection/completion evidence, blocker, deferral, rejection, or handoff reason |

An opportunity missing evidence or a behavior-preservation argument is not executable.

## Final review report schema

Checkpoint reviews are JSON objects with this shape:

```json
{
  "version": 1,
  "unitId": "B-001",
  "stage": "initial",
  "snapshot": "<lowercase-sha256>",
  "reviewerId": "<stable-self-declared-id>",
  "reviewerRole": "read-only-initial-reviewer",
  "checks": ["correctness and contracts", "structure and idioms", "test quality"],
  "verdict": "ready-for-refactor",
  "findings": [
    {
      "id": "FR-001",
      "category": "blocking",
      "severity": "high",
      "status": "unresolved",
      "file": "src/example.ts",
      "line": 42,
      "summary": "Concrete evidence and required action",
      "disposition": "Correct before accepting this review"
    }
  ],
  "noFindingsRationale": null
}
```

`version` is `1`. `reviewerId` is a stable, nonempty, self-declared identity for the reviewer; initial and final IDs differ and an ID cannot be reused across implementation units, even after accepted evidence is invalidated or checkpoint state is reset. This does not prove real-world identity or the producer's identity, so the orchestrator must still launch genuinely fresh read-only reviewers; the script blocks accidental declared-identity reuse. The `stage`/`verdict`/`reviewerRole` combination is `initial`/`ready-for-refactor`/`read-only-initial-reviewer` or `final`/`behavior-preserved`/`fresh-final-reviewer`. `checks` must name substantive work performed. Finding categories are `blocking`, `kickback`, or `cleanup`; severities are `critical`, `high`, `medium`, or `low`; statuses are `unresolved` or `resolved`. Every finding cites a repository-relative file and positive line and records its disposition. `blocking` prevents safe local progress and `cleanup` is local follow-up. A `kickback` crosses the architect boundary and is never accepted as locally resolved in review JSON: standard changes must use `kickback-log.mjs`, while refactor behavior/contract findings become separate architect work. The snapshot must match the checkpointed unit exactly. If `findings` is empty, `noFindingsRationale` must concretely explain why the reviewed code needs no action.

In addition to the machine-readable per-unit reports, the fresh final reviewer records:

- Stable nonempty self-declared `reviewerId`, session, and independence statement
- Baseline SHA and worktree assumptions
- Selected IDs, declared batches, and complete changed-file list
- Inputs reviewed: diff, CONTEXT, seams, idiom packs, invariants, and command results
- One stable finding ID per issue, with severity, checkpoint category, evidence, behavior/firm impact, required action, and status
- Unexplained files, opportunity drift, lock changes, skipped checks, and residual risks
- Verdict: `pass`, `revise`, or `architect`

A `pass` requires no unexplained file, no failed or modified protection, no selected opportunity left partially implemented, no unresolved `blocking` or `kickback` finding, and no behavior ambiguity. The script accepting a report is necessary but does not override this stricter review rule.

## Local cleanup boundary

Local refactor execution is allowed when all of these hold:

- The outcome is strictly behavior-preserving.
- Firm seams and firm-seam tests remain unchanged.
- The structural change is bounded to selected opportunities and declared files.
- Existing tests or post-selection characterization can establish the current behavior.
- The change does not require a product, domain, architecture, compatibility, data-migration, or operational-policy decision.
- Relevant baseline and batch verification are green.

Examples include bounded extraction/inline operations, renaming internals, removing proven dead private code, consolidating equivalent private logic, simplifying control flow, and replacing a private mechanism with an equivalent idiomatic one.

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
