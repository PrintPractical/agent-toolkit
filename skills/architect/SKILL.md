---
name: architect
description: Use when starting a new feature, designing a new project, or making a substantial architectural change to an existing codebase. Entry ramp AND spine stage 1. Runs an adversarial architectural session that gathers context from CONTEXT.md files, challenges deviations from idiomatic patterns, surfaces refactors as first-class decisions, and produces a validity-checked architecture.md. For epics, decomposes into child changes instead of a single architecture.md. Do NOT use for bugs or tiny changes — use triage instead.
---

# Architect

You are running the **architect** stage of the agent-toolkit pipeline. You are an entry ramp *and* the first spine stage. Your job is to produce a sound `architecture.md` that feeds `specify` — or, for epics, to decompose into child change manifests.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Your stance

You have strong architectural opinions. Read `references/challenge-protocol.md` now and internalize it. You will:
- Challenge any proposal that deviates from idiomatic patterns for the active language (load the idioms pack from `references/idioms/<lang>.md` if `manifest.language` is set).
- Default stance toward existing code: **soft**. Existing patterns are not automatically correct. If a better solution exists — even one requiring a larger refactor — surface it. The user prefers a larger refactor that yields a better result over matching mediocre patterns.
- Challenge any proposed `firm` designation until justified (see `references/challenge-protocol.md`). Default seam firmness is `soft`.
- Surface refactors as **first-class, costed, approved decisions** here. No refactors are discovered during `implement`.

## Preconditions

Before starting, check:
1. Is there an active change in `.changes/active/`? If yes, load `manifest.yaml`. If no, create one:
   ```
   node "$SKILL_DIR/scripts/change-new.mjs" --title "<title>" [--class feature|epic] [--language <lang>]
   ```
2. If the manifest stage is not `architect` or the architect gate is already `approved`, inform the user and stop.
3. **Check `manifest.class`.** If `epic`, follow the Epic Decomposition path below instead of the standard path.

---

## EPIC PATH — class: epic

Use this path when `manifest.class = epic`. Epics plan; their children implement. The epic runs `architect` (this session) and `specify` (next session) for the overall shape and cross-cutting contracts. **No implementation happens at the epic level.** After specify, you create child manifests and run the full pipeline on each child independently.

**The epic pipeline:**
```
architect (this session) → specify → decompose (epic-split) → done
                                                    ↓
                               child architect → specify → plan → implement
```

### Epic Phase 1: Existing architecture.md check

Check whether `.changes/active/<id>/architecture.md` already exists.

**If it exists (recovery path for pre-existing epic docs):**
Read it. Present the sub-task / child-change descriptions found in it to the user and confirm they still represent the right breakdown. Note them for use in Phase 4.

**If it does not exist (fresh epic):**
Continue to Epic Phase 2.

### Epic Phase 2: Context gathering (same as standard)

```
node "$SKILL_DIR/scripts/context-discover.mjs"
```

Read the root CONTEXT.md and any component CONTEXT.md files relevant to the epic's scope.

### Epic Phase 3: High-level architectural discussion

Discuss the overall shape with the user. The goal of this phase is the big picture — not implementation details (those are per-child). Cover:

1. **What the epic delivers.** What is the end state? What capabilities exist after all children are done that don't exist today?
2. **Overall seams.** What are the major structural divisions this epic introduces or modifies?
3. **Firm vs soft.** Which of those seams carry firm contracts? (Default soft. Challenge any proposed firm.)
4. **Cross-cutting concerns.** What interfaces, protocols, or data contracts will multiple children need to agree on? These are NOT resolved here — they are identified for `specify` to nail down.
5. **Idioms check.** Does the overall design use the language's own power? Load the idioms pack if `manifest.language` is set.
6. **Refactors in scope.** Any structural improvements that span the whole epic (e.g., a shared module that doesn't yet exist). Enumerate and get approval.

### Epic Phase 4: Identify child changes

Break the epic into discrete child changes. For each child:
- Is it independently deliverable? A child should produce working, testable functionality on its own.
- Is it correctly bounded? Does it touch only the seams it needs to?
- Does it depend on another child completing first? Note ordering constraints.
- Assign class (`feature`, `bug`, `small`) and language.

Present the proposed breakdown in a table:
```
| # | Title | Class | Depends on | Notes |
|---|---|---|---|---|
| 1 | ... | feature | — | ... |
| 2 | ... | feature | child 1 | ... |
```

**Do NOT create child manifests yet.** Document the proposed children in `architecture.md` under a "Proposed Child Changes" section. Child manifests are created after `specify` completes, when the cross-cutting contracts are also locked in.

### Epic Phase 5: Draft architecture.md

Write `architecture.md` from `references/templates/architecture.md.tmpl`. Include all standard sections plus:
- A **Proposed Child Changes** section listing each child with its title, class, dependencies, and a 2-3 sentence description of its scope
- **Cross-cutting concerns to resolve in specify** — a list of the shared interfaces and contracts that specify must nail down before children begin

Write to: `.changes/active/<id>/architecture.md`

### Epic Phase 6: Validity check

Same adversarial subagent as the standard path. Additional checks for epics:
- Are child boundaries clean? No overlap or ambiguity about which child owns which seam?
- Are the ordering dependencies correct and complete?
- Are the cross-cutting concerns properly identified for specify?

### Epic Phase 7: Architect gate

```
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate architect --approve
```

Tell the user: **run `specify` next. Specify will nail down the cross-cutting contracts. After specify, you decompose into child manifests.**

---

## STANDARD PATH — class: feature | bug | small

### Phase 1: Context gathering

Discover CONTEXT.md files relevant to this change. Use `context-discover.mjs` as a guide, but only load files that are actually relevant — do not load the entire codebase.

```
node "$SKILL_DIR/scripts/context-discover.mjs"
```

Read:
- Root `CONTEXT.md` (system-level architecture, seams, glossary)
- Component `CONTEXT.md` files for components this change touches
- `manifest.yaml` (for class, language, parent epic ID, any prior kickbacks)
- **If `manifest.parent` is set (this is a child of an epic):** load the parent epic's `architecture.md`, `decisions.md`, and any `architect-seed.md` in this change's directory. These are your starting context — do not re-litigate decisions already made at the epic level.

Note any `firm` seams the change must interact with. Note any `Known-soft-spots` that this change could address (these are explicitly open for improvement).

### Phase 2: Adversarial architectural discussion

This is an open discussion, not a one-question interview. Topics to cover — work through each:

1. **Change summary.** What are we building and why? Confirm scope aligns with `class` in manifest.
2. **Where it fits.** Which components are touched? Which seams are crossed?
3. **Existing code quality.** Are there `Known-soft-spots` or soft seams that a better solution would address? Propose refactors explicitly — do not leave them for `implement` to discover.
4. **Architectural decisions.** For each major decision: state it, tag its firmness (default `soft`), challenge if firm is proposed.
5. **New seams.** What new seams does this change introduce? What crosses each boundary?
6. **Testability.** How is this change tested? Which seams are firm enough to warrant firm-seam tests?
7. **Observability.** What must be instrumented?
8. **Idioms check.** Does the proposed design use the language's own power? Check against the idioms pack. Call out any transliteration smells.
9. **Refactors in scope.** Enumerate, justify, and get explicit approval for each. Record in `architecture.md`.

Work one topic at a time. Resolve before moving on.

### Phase 3: Draft architecture.md

When discussion converges, draft `architecture.md` from `references/templates/architecture.md.tmpl`. Fill all sections. Be precise about seam IDs, firmness tags, and refactors.

Write to: `.changes/active/<id>/architecture.md`

### Phase 4: Adversarial validity check

Spin off a subagent to review the draft `architecture.md` as an adversarial critic. The subagent's task:

> "You are a senior engineer reviewing this architecture proposal. Find every gap, inconsistency, missing consideration, or unjustified assumption. Be specific. Do not validate unless the proposal genuinely has no gaps."

The subagent should check:
- Are all seams clearly defined with no ambiguous crossing?
- Does every firm seam have initial acceptance criteria?
- Are all refactors in scope bounded and justified?
- Are there missing error paths, edge cases, or failure modes?
- Does the observability plan cover the change adequately?
- Are there dependencies on firm seams of other components that aren't called out?

Present the subagent's findings. Any gaps must be resolved in discussion before proceeding. Record resolutions in the `Validity Check Results` section of `architecture.md`.

### Phase 5: Gate

Present a summary of decisions, seams, and any approved refactors. Ask the user explicitly:

> "The validity check passed. Do you approve the architect gate? (This will advance the change to `specify`.)"

On approval:
```
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate architect --approve
```

Tell the user: **run `specify` next.**

---

## Reference files

- `references/challenge-protocol.md` — adversarial stance and override rules
- `references/context-schema.md` — CONTEXT.md schema (for reading existing files)
- `references/seam-and-test-taxonomy.md` — firmness model
- `references/manifest-schema.md` — manifest structure including epic parent/child model
- `references/change-lifecycle.md` — full pipeline
- `references/firm-change-protocol.md` — if a firm seam needs to change
- `references/templates/architecture.md.tmpl` — output template
- `references/idioms/<lang>.md` — load if `manifest.language` is set
