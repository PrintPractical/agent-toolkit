# agent-toolkit

<p align="center">
  <img src="image.png" width="350" />
</p>

Opinionated, spec-driven planning and development skills for greenfield and brownfield projects. Built on the [skills.sh](https://skills.sh) ecosystem.

## Install

```bash
# All skills (recommended) 
npx skills add PrintPractical/agent-toolkit --all

# Single skill
npx skills add PrintPractical/agent-toolkit --skill architect
```

Manual: copy any `skills/<name>/` folder into `~/.claude/skills/`, `~/.agents/skills/`, or `~/.config/opencode/skills/`.

---

## Quick orientation

Not sure what to do? Say **"what now"** at any time. The `what-now` skill reads your active change state and tells you the next step.

Active phases are `architect`, `specify`, `plan`, `implement`, `refactor`, `decomposed`, and `archive-ready`. `archive-ready` is not terminal: a change is complete only after its archive is verified. Cancellation records a concrete reason and archives the current artifacts rather than deleting them.

---

## Choosing your starting point

| Your situation | Start with |
|---|---|
| Early idea or competing solution directions | `brainstorm` |
| Existing repo where current code context would help | `map` (optional) |
| You have a PoC you want to rebuild from scratch | `reforge` |
| Bug or small isolated fix | `triage` |
| Behavior-preserving cleanup, technical debt audit, or accumulated sloppiness | `refactor` |
| New feature, new project, or substantial change | `architect` |

---

## Intake first

Before a manifest, seed, context discovery, map scan, subagent, or bulk reference read, establish:

- Goal and observable outcome
- Affected area
- Constraints and anti-goals
- Whether requirements are formed, partially formed, or unformed

Each active change records this in `change-brief.md`. Use `map` only when repository context is needed; missing `CONTEXT.md` files are not a prerequisite for `architect` or `triage`.

---

## Flow 1 — Optional brownfield map

**Use when:** you have an existing codebase and need a derived CONTEXT.md hierarchy to support the work.

```
map
 └─ derives CONTEXT.md hierarchy from existing code
 └─ root CONTEXT.md (system architecture, glossary, tech requirements)
 └─ per-component CONTEXT.md files
 └─ stamps provenance on each file

  → use architect, triage, or verify with the new context
```

**What `map` produces:**
- `CONTEXT.md` at the repo root
- `CONTEXT.md` in each major component directory
- All seams tagged `soft` by default (conservative — easy to earn `firm` later)
- `Known-soft-spots` section: explicit debt and candidates for improvement

`map` is optional. After intake, use `architect` for new features or `triage` for bugs whether or not a map exists.

---

## Flow 2 — Standard feature (the full pipeline)

**Use when:** new feature, non-trivial change, or anything that touches more than one component.

```
brainstorm (optional)
 └─ frames the problem, evidence, constraints, and anti-goals
 └─ explores distinct approaches and their tradeoffs
 └─ optionally produces: architect-seed.md (provisional input only)

  → architect challenges and formalizes the direction

architect
  └─ gathers relevant CONTEXT.md files
  └─ batched architectural-topic confirmation with explicit user responses
  └─ bounded adversarial discussion: material seams, decisions, refactors, engineering fundamentals, idioms
 └─ validity-check subagent tests material risks within the change scope
 └─ produces: .changes/active/<id>/architecture.md
  └─ approves: architect approval

specify
  └─ batched material-decision confirmation with explicit user responses
 └─ defines material interface changes, error paths, and edge cases
 └─ implement-as-if dry-run subagent: finds unresolved material blockers within scope
 └─ produces: .changes/active/<id>/decisions.md
 └─ reconciles architecture.md
  └─ approves: specify approval

plan
 └─ decomposes into detailed task checklist
 └─ applies engineering fundamentals and the target-language idiom pack to concrete task choices
 └─ test tasks labeled by seam firmness (firm = safety net, soft = disposable)
 └─ traceability: every acceptance criterion → at least one task
 └─ produces: .changes/active/<id>/plan.md
  └─ approves: plan approval

implement
 └─ per section: write firm-seam tests (red) → implement (green) → verify green baseline
 └─ after full implementation: fresh auditor reviews → behavior-preserving refactor → tests stay green → distinct fresh verifier
 └─ refactor targets: unsafe/panic-prone code, idiom violations, oversized modules, repetition, deep functions
 └─ firm-seam tests must stay green — failure = kickback, not a test edit
 └─ independent review recorded via review-log.mjs (no per-file snapshot tracking)
 └─ live checklist: checks off tasks as they complete
   └─ on completion: record implementation evidence, reconcile CONTEXT.md files, commit/re-stamp provenance in Git, run context-verify.mjs --run-tests
    └─ reconciles docs before the implement approval → archive-ready → verified archive
```

`brainstorm` is useful when an idea is not yet ready for architecture. It creates no manifest or approval; its optional `architect-seed.md` records facts, hypotheses, preferences, alternatives, and open questions for `architect` to challenge.

**Kickback protocol:** if `implement` hits a gap the spec did not cover, it stops and logs a kickback to `manifest.yaml`. The entry records `restart_phase` and `invalidated_approvals`; resolve the gap, then re-approve only those approvals. No improvising. Kickback frequency is the toolkit's quality metric.

---

## Flow 3 — Epic (large change spanning multiple child changes)

**Use when:** the work is too large for a single implementation cycle or naturally decomposes into independent deliverables.

```
architect (epic)
 └─ high-level design: overall seams, major decisions
 └─ identifies child changes — documented in architecture.md
 └─ does NOT create child manifests yet
  └─ approves: architect approval

specify (epic)
 └─ cross-cutting contracts ONLY: shared interfaces between children
 └─ which child owns/produces each shared interface
 └─ ordering constraints between children
 └─ dry-run: "can all children be implemented without inter-child gaps?"
 └─ produces: .changes/active/<id>/decisions.md
  └─ approves: specify approval
 └─ AUTO-RUNS epic-split: creates child change manifests
    └─ each child gets architect-seed.md seeded from the epic's context

  For each child (in dependency order, or parallel if independent):
  architect (child)
   └─ loads epic's architecture.md + decisions.md as parent context
   └─ does NOT re-litigate epic-level decisions
   └─ focuses on child-specific design
    └─ approves: architect approval

   specify (child) → plan (child) → implement (child) → archive-ready (child held by epic)
   [standard pipeline per child]

    When all children are archive-ready: run epic → reconcile and verify epic context → docs approval → epic archive-ready → coordinated verified archive.
```

**Key rule:** epics never run plan or implement directly. Epics plan; children implement.

**Execution order — depth-first, one child at a time.** Take each child to `archive-ready` (architect → specify → plan → implement → archive-ready) before starting the next, in dependency order. Do **not** archive an archive-ready child independently: the epic holds it for the coordinated verified archive. Do **not** architect/specify all children up front. This is safe because the epic's `specify` already locked the cross-cutting contracts *between* children. Independent children may run in parallel, but each still goes through its full spine start-to-finish — never batched by phase.

If implementing a child reveals that a cross-cutting contract was wrong, log an `epic-specify` kickback to the **epic's** `specify` (firm-change protocol). It propagates revalidation to active children, including completed children. This should be rare — its frequency is a quality signal for the epic-level specify.

**Checking epic progress:** ask the agent **"what now"** — the `what-now` skill reads the epic manifest and reports child progress and the next step.

---

## Flow 4 — Bug / small change

**Use when:** bug, small isolated fix, single-component change with no interface changes.

```
triage
 └─ classifies: is this actually small? (escalates to architect if not)
 └─ root cause analysis
  └─ writes failing test first (red), then fix (green)
  └─ quick refactor pass
   └─ records implementation evidence, reconciles CONTEXT.md, and runs context-verify.mjs --run-tests
  └─ docs reconciliation → implement approval → archive-ready → verified archive
```

**Triage escalates to `architect` when:**
- Touches more than one component
- Adds or removes a seam
- Changes an interface (even slightly)
- Root cause reveals a deeper architectural issue

---

## Flow 5 — Behavior-preserving cleanup (refactor)

**Use when:** several features have accumulated duplication, tangled control flow, weak naming, dead private paths, unsafe/panic-prone code, non-idiomatic code, or oversized modules. Scope may be a path, component, layer, package, or the whole first-party stack.

```
refactor
 └─ read-only parallel audit across architecture, behavior, tests, and idioms
 └─ produces a ranked inventory with stable RF-... opportunity IDs
  └─ asks you to select exact IDs for execution; audit-only approves and archives the report
 └─ blocks on relevant failing baseline tests or overlapping active work
 └─ adds minimal characterization tests when current behavior lacks coverage
 └─ executes selected work in small batches: baseline green → apply → tests stay green
 └─ fresh auditor records findings, then a distinct fresh verifier confirms (review-log.mjs)
   └─ execute mode records verification evidence, reconciles and verifies CONTEXT.md, then reaches archive-ready
  └─ audit-only: refactor approval → archive-ready → verified audit archive
  └─ execute mode: refactor approval → documentation reconciliation → implement approval → archive-ready → verified archive
```

`refactor` preserves observable behavior. Bug fixes, product changes, public or firm contract changes, migrations, dependency upgrades, and cross-scope redesign are recorded as architect candidates and must follow the `architect` flow. Firm-seam tests remain immutable; a firm-seam failure during cleanup is a kickback, not a test edit. The independent review is recorded via `review-log.mjs` — no per-file snapshot tracking.

---

## Flow 6 — PoC to production

**Use when:** you built a prototype and want to rebuild the production version from scratch with proper architecture.

```
reforge (run on the PoC repo)
 └─ comprehend: what does the PoC actually do (ignoring how)
 └─ extract: functional intent, domain complexity, lessons learned
 └─ identify: capabilities to preserve, anti-goals, anti-patterns to avoid
 └─ produces: reforge-seed.md

  → create a new repo
  → run architect on the new repo, seeded with reforge-seed.md
  → follow the standard pipeline from there
```

**What `reforge` discards:** all implementation code, all PoC-specific patterns, all shortcuts.
**What it keeps:** the *why*, the domain knowledge, the hard-won lessons.

---

## Flow 7 — Keeping docs current (verify)

**Use when:** code changed outside the pipeline (hotfixes, external PRs, time has passed).

```
verify
 └─ runs context-verify.mjs: finds stale CONTEXT.md files (provenance stamps)
 └─ for each stale file:
    └─ soft divergence → auto-update CONTEXT.md to match code
    └─ firm divergence → asks: intentional change (firm-change protocol)
                                or regression (flag as bug)?
 └─ re-stamps provenance on all updated files
```

**CI behavior:**
- Firm-seam test failing → hard block
- Soft prose stale → warning + `Context-Reviewed: <path>` PR trailer ack

---

## Key concepts

### CONTEXT.md

Every component carries a `CONTEXT.md`. It is the living architecture document — not full documentation, but a lean decision record:

- **Purpose** — what this component does and does NOT do
- **Architecture & Seams** — structural divisions, each tagged `firm` or `soft`
- **Interfaces/Contracts** — public API surface
- **Glossary** — domain terms as used in the code
- **Technical Requirements** — hard constraints (performance, platform, regulatory)
- **Acceptance/Behavioral Criteria** — the "definition of done" for this scope
- **Known-soft-spots** — explicit debt and improvement candidates
- **Provenance** — `validated-at: <git-sha>` (used by `verify` for staleness detection)

### Firmness

Every seam carries a firmness tag:

- **`soft`** (default) — open for challenge and improvement. The agent is expected to propose better solutions. Tests at soft seams are disposable — they churn with structure changes.
- **`firm`** (earned) — a hard contract. The user must argue the case; the agent challenges it; justification is recorded inline. Tests at firm seams are the **safety net** — never edited to make a refactor pass.

**Firm ≠ frozen.** Firm things can change through the firm-change protocol. The designation protects against *accidental* change, not *intentional* change.

### Kickback frequency

The single quality metric for the toolkit. A kickback occurs when `implement` must stop and return to `specify` due to a gap the spec didn't cover.

- `defect` kickback: the spec was wrong/incomplete. Counts against quality.
- `amendment` kickback: legitimate new information. Does not count.

If kickback frequency trends to zero, `architect` and `specify` are working. Every kickback teaches you something about the gap in your spec process.

### Change artifacts

```
.changes/
  active/<id>/
    manifest.yaml       # phase, class, approvals, kickbacks — source of truth
    change-brief.md     # intake: outcome, area, constraints, readiness
    architecture.md     # architect output
    decisions.md        # specify output
    plan.md             # plan output (live checklist, updated by implement)
    refactor.md         # ranked audit, selection, batches, and evidence (refactor class)
    implementation.md   # completed work, test, context, and approval evidence (non-refactor)
    epic-docs.md        # epic reconciliation and docs approval evidence
    reviews.json        # independent review records (auditor + verifier verdicts)
  archive/<id>.zip      # zipped on completion — agent won't read; humans can
```

`<id>` format: `YYYY-MM-DD-<slug>` (e.g. `2026-07-01-add-rate-limiter`).

### Idioms packs

Consulted by `architect`, `specify`, `plan`, `implement`, `triage`, `reforge`, and `refactor` based on `manifest.language` or the selected target language. Whole-stack refactor audits detect every scoped language and load every matching pack. Each pack is a power-checklist + smell-list for writing idiomatic code and rejecting language-specific anti-patterns. Shipped packs: **Rust**, **C**, **C++**, **Python**, **Go**, **Swift**, **JavaScript**, and **TypeScript**.

The core principle: **use the language's own power; flag transliteration from another paradigm as a smell.** To add a pack, create `_idioms/<lang>.md` using a lowercase kebab-case filename and run `npm run build`; the build discovers and distributes canonical packs automatically. The filename stem is the `manifest.language` value.

### Engineering review

The shared engineering fundamentals guide workload-based data structure choices, asymptotic and resource bounds, legal state transitions, abstraction selection, standard algorithms, equality/hash/order contracts, and material domain duplication. Reviews are intentionally bounded to the requested change, affected seams, acceptance criteria, and credible workload or failure risks. They require evidence and concrete alternatives for material findings rather than an unbounded search for hypothetical issues.

---

## Development

Canonical authored sources live in `_shared/`, `_templates/`, `_idioms/`, and `packages/build/`. Files under `skills/*/references/` and `skills/*/scripts/` are generated copies; do not edit them directly.

```bash
npm install
npm run build       # sync _shared/_templates/_idioms into each skill's references/
npm test            # run script unit tests
```

See `AGENTS.md` for authoring conventions when contributing skills.
