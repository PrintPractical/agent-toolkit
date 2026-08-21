# CONTEXT.md Schema

Every component in a project using this toolkit must have a `CONTEXT.md` file. The repo root gets one (system-level); each logical component gets one (component-level). They are the living architecture document for that scope.

## Purpose

CONTEXT.md files serve two audiences simultaneously:
- **Humans:** the canonical "why are things the way they are" for this scope.
- **Agents:** the minimal, high-signal context needed to reason about changes without reading all the code.

They are **not** exhaustive documentation. Exhaustive docs rot. CONTEXT.md is a **decision record + contract surface** — lean, tagged for trust level, and verifiable.

## Fields

### Required

**Purpose** — One paragraph. What does this component/system do, and what does it explicitly *not* do? Helps agents avoid scope creep.

**Architecture & Seams** — The major structural divisions and their boundaries. Each seam carries a `firmness` tag:
```
### Seam: <name>  [firmness: soft|firm]
Description: what crosses this boundary and what doesn't.
Criteria:
  - [SEAM-<id>] [AC-<id>] <behavioral assertion> → enforced-by: <repository-root-relative test path>; command: <exact test command>
```
Every soft and firm seam has at least one behavioral criterion with an acceptance-criterion ID. Every firm seam criterion additionally has a repository-root-relative enforcing test path, exact executable command, and matching `[SEAM-<id>]` marker in that test. Soft seams do not require durable enforcement citations.

**Interfaces/Contracts** — Public API, message formats, file layouts, or protocol surface. Firm interfaces carry a seam ID. Soft interfaces are described with the expectation they will evolve.

**Glossary** — Domain terms that have precise meanings in this codebase. One line each. Use consistent terminology across all CONTEXT.md files.

**Technical Requirements** — Hard constraints: performance budgets, platform targets, security requirements, regulatory obligations. Each is firm by definition. State *why* where the reason isn't obvious.

**Acceptance/Behavioral Criteria** — The "definition of done" for this scope. Seeded from firm seams. Format:
```
- [AC-<id>] <scenario> → traces-to: [SEAM-<id>]
```
These become the source for firm-seam test generation.

**Provenance** — Last line of every CONTEXT.md, always present, always updated:
```
Provenance: validated-at: <full-git-sha>
```
Agents and CI use this to detect staleness via `context-verify.mjs`.
Outside a Git repository, `context-scaffold.mjs` writes `Provenance: validated-at: <not-in-git-repo>` instead. It is valid while Git is unavailable and becomes stale after Git is initialized; replace it with the current HEAD SHA during reconciliation.

### Recommended

**Observability** — What is instrumented, what traces exist, what metrics are emitted. Helps `architect` and `specify` check that new work is observable.

**Dependencies** — External services, libraries, or sibling components this scope depends on. Helps blast-radius analysis.

**Known-soft-spots** — Explicit debt, areas where the implementation is known to be suboptimal, candidates for future refactor. This field is the **anti-anchoring surface**: it signals to agents that these areas are open for improvement, counteracting the tendency for agents to treat existing code as correct by default.

**Children** — Links to component-level CONTEXT.md files (root only):
```
- [component-name](./path/CONTEXT.md): one-line description
```

## Firmness rules

1. **Default is `soft`.** Soft means: open to challenge, candidates for improvement, expected to evolve.
2. **`firm` must be earned.** User argues the case; agent challenges; justification is recorded inline. A firm designation without a justification is invalid.
3. **Firm ≠ frozen.** Firm things can change through the firm-change protocol. The designation protects against *accidental* change, not *intentional* change.
4. **Soft prose does not require test enforcement.** Only firm seam criteria carry enforcing tests.
5. **Known-soft-spots should never be marked firm.** They are explicitly unearned code.

## Lean authoring rules

- No essays. Every field should fit in a few lines of dense prose or a short list.
- No history. History goes in `decisions.md` or the archive. CONTEXT.md reflects current state.
- No justification essays for firm items — one sentence is required, one paragraph is too much.
- No orphaned seam IDs. If a test cited in `enforced-by` is deleted, the seam must be reviewed.

## Staleness and provenance

CONTEXT.md is stamped with the full HEAD SHA at the moment it is validated. In a Git repository, commit the reconciled context first, then update only its final provenance footer to that commit's full HEAD SHA. `context-verify.mjs` accepts this footer-only unstaged update and rejects every other unstaged, staged, or untracked scoped change, as well as committed changes since the stamp. Outside Git, `<not-in-git-repo>` is valid while Git is unavailable; it becomes invalid after Git initialization.

Staleness remains a CI warning, but malformed provenance or a missing, unmarked, or failing firm-seam test is a hard block.

See `_shared/drift-control.md` for the full drift model.
