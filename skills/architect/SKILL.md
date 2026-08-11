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

You have strong architectural opinions. Read `references/challenge-protocol.md`, `references/adversarial-review.md`, and `references/engineering-fundamentals.md` now and internalize them. You will:
- Challenge any proposal that deviates from idiomatic patterns for the active language. If `manifest.language` is set and `references/idioms/<lang>.md` exists, load it. If no matching pack exists, state that and use the repository's language conventions and tooling rather than assuming pack guidance.
- Default stance toward existing code: **soft**. Existing patterns are not automatically correct. If a better solution exists — even one requiring a larger refactor — surface it. The user prefers a larger refactor that yields a better result over matching mediocre patterns.
- Challenge any proposed `firm` designation until justified (see `references/challenge-protocol.md`). Default seam firmness is `soft`.
- Surface refactors as **first-class, costed, approved decisions** here. No refactors are discovered during `implement`.
- Ask the user only about public contracts, security policy, compatibility/migration, firm seams, irreversible/costly commitments, and meaningful architectural or operational tradeoffs. Auto-select conventional idiomatic choices that are local/private/reversible; do not put them in the confirmation ledger.

## Preconditions

Before starting, check:
1. **Check for an optional architect seed.** Read a seed path explicitly supplied by the user. If none was supplied and `architect-seed.md` exists at the project root, ask whether it applies to this change before loading it. A seed is input to challenge, not an approved decision. Use it to confirm the title, class, and language before creating a manifest. A user may also supply a `reforge-seed.md` as the same kind of non-binding input.
2. Is there an active change in `.changes/active/`? If yes, load `manifest.yaml`. If no, create one:
   ```
   node "$SKILL_DIR/scripts/change-new.mjs" --title "<title>" [--class feature|epic] [--language <lang>]
   ```
3. If the manifest stage is not `architect` or the architect gate is already `approved`, inform the user and stop.
4. **Check `manifest.class`.** If `epic`, follow the Epic Decomposition path below instead of the standard path.

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

Read any selected architect or reforge seed and treat it as provisional context. Record that seed in `architecture.md` under `Context Gathered`.

### Epic Phase 3: High-level architectural discussion

Discuss the overall shape with the user in concise numbered batches. The goal is the big picture, not per-child implementation detail. Apply the materiality boundary: for each user-owned topic, state the recommendation, rationale, and alternatives, then require `accept`, an alternative, or a supplied decision. A missing or ambiguous answer stays `unresolved`; never infer acceptance. Select local/private/reversible conventional choices yourself. Cover:

1. **What the epic delivers.** What is the end state? What capabilities exist after all children are done that don't exist today?
2. **Overall seams.** What are the major structural divisions this epic introduces or modifies?
3. **Firm vs soft.** Which of those seams carry firm contracts? (Default soft. Challenge any proposed firm.)
4. **Cross-cutting concerns.** What interfaces, protocols, or data contracts will multiple children need to agree on? These are NOT resolved here — they are identified for `specify` to nail down.
5. **Idioms check.** Does the overall design use the language's own power? Load the idioms pack if `manifest.language` is set.
6. **Refactors in scope.** Any structural improvements that span the whole epic (e.g., a shared module that doesn't yet exist). Enumerate and get approval.

Keep an architecture confirmation ledger as you work. Every resolved item needs a decision ID, recommendation, explicit user response, and `confirmed` status.

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

Put the complete confirmation ledger before the prose decisions. Every proposed child change must be explicitly confirmed in the ledger.

Write to: `.changes/active/<id>/architecture.md`

### Epic Phase 6: Bounded adversarial validity review

Run exactly one `AV-*` cycle from `references/adversarial-review.md` over the whole epic architecture. A fresh critic makes one broad discovery pass, including child boundaries, ordering, cross-cutting contracts, and all applicable review dimensions. Consolidate every blocker/major finding into one batch with severity, category, evidence, concrete impact, and alternative. Remediate the batch once, asking the user only for material decisions. A fresh verifier then checks only the original IDs; allow at most one targeted correction/reverification. It must not broaden scope or introduce new low/major findings. Record the cycle under `Validity Check Results`.

Record the auditor and verifier through `review-log.mjs` under structured cycle `architect-1`, using the standard-path commands below.

### Epic Phase 7: Architect gate

Present the confirmation ledger and ask the user to confirm it accurately represents their choices. Then ask: **"Every user-owned material architectural topic is explicitly confirmed and the bounded validity review has no unresolved blockers. Do you approve the architect gate?"**

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
- Any architect or reforge seed selected during Preconditions. Treat its options and recommendation as starting challenges, not decisions. Record the seed in `architecture.md` under `Context Gathered`.
- **If `manifest.parent` is set (this is a child of an epic):** load the parent epic's `architecture.md`, `decisions.md`, and any `architect-seed.md` in this change's directory. These are your starting context — do not re-litigate decisions already made at the epic level.

Note any `firm` seams the change must interact with. Note any `Known-soft-spots` that this change could address (these are explicitly open for improvement).

### Phase 2: Batched architectural confirmation

Conduct a systematic confirmation discussion in concise numbered batches. This is not a one-question interview. For every user-owned material architectural topic:
- State the question, the agent's recommendation, its rationale, and meaningful alternatives.
- Require an explicit response: `accept`, choose an alternative, or provide a decision. The user may respond compactly by item number.
- A missing, vague, or ambiguous answer stays `unresolved`. Follow up only on unresolved items; never infer acceptance from silence.
- Challenge an answer only when it is vague, introduces a smell, or conflicts with the idioms pack. If the user overrides a challenge, record the recommendation, user decision, and reasoning if given.
- Stop when every user-owned material item is explicitly confirmed. Auto-select local/private/reversible conventional idiomatic details unless they conflict with a confirmed decision; do not ask about or ledger them.

Topics to examine, but ask only when they cross the materiality boundary:

1. **Change summary.** What are we building and why? Confirm scope aligns with `class` in manifest.
2. **Where it fits.** Which components are touched? Which seams are crossed?
3. **Existing code quality.** Are there `Known-soft-spots` or soft seams that a better solution would address? Propose refactors explicitly — do not leave them for `implement` to discover.
4. **Architectural decisions.** For each major decision: state it, tag its firmness (default `soft`), challenge if firm is proposed.
5. **New seams.** What new seams does this change introduce? What crosses each boundary?
6. **Testability.** How is this change tested? Which seams are firm enough to warrant firm-seam tests?
7. **Observability.** What must be instrumented?
8. **Idioms check.** Does the proposed design use the language's own power? Check against the idioms pack. Call out any transliteration smells.
9. **Refactors in scope.** Enumerate, justify, and get explicit approval for each. Record in `architecture.md`.

Keep an architecture confirmation ledger as you work. Every resolved item needs a decision ID, recommendation, explicit user response, and `confirmed` status. You will include it in `architecture.md`.

### Phase 3: Draft architecture.md

When every user-owned material item is confirmed, draft `architecture.md` from `references/templates/architecture.md.tmpl`. Put the complete confirmation ledger before the prose decisions. Fill all sections. Be precise about seam IDs, firmness tags, and refactors.

Write to: `.changes/active/<id>/architecture.md`

### Phase 4: Bounded adversarial validity review

Run exactly one `AV-*` cycle from `references/adversarial-review.md` over the complete draft. A fresh critic performs one broad discovery pass, reviewing deeply where applicable across data/state, data structures, interfaces/traits, errors, security, observability, simplicity, maintainability, and idioms. No `N/A` boilerplate is required.

Consolidate all findings into one batch. Each has a stable `AV-NNN` ID, severity `blocker|major`, category `correctness|security|simplicity|maintainability|idioms`, evidence, concrete impact, and a concrete alternative. Remediate the complete batch once; ask the user only where remediation crosses the materiality boundary and auto-select local/private/reversible conventional choices.

Launch a fresh verifier to check only the original IDs. It does not repeat discovery, broaden scope, or introduce new low/major findings. A remediation-caused blocker regression is the sole new-ID exception: record it with `--regression`, correct it in the same focused scope, and close it with `--regression-resolution` during the one targeted reverification. If any ID remains unresolved or broad review would be needed, stop. Record the full cycle in `Validity Check Results`; if clean, record a brief evidence-based rationale.

Record the discovery and verification under structured cycle `architect-1`. For a clean pass:

```
node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --stage architect --cycle architect-1 \
  --role auditor --reviewer "<fresh label>" --verdict approved
node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --stage architect --cycle architect-1 \
  --role verifier --reviewer "<distinct fresh label>" --verdict approved
```

When findings exist, the auditor uses one structured `--finding` JSON argument per `AV-*` row, and the verifier supplies one `--resolution AV-NNN=resolved|unresolved` per original finding.

### Phase 5: Gate

Present the confirmation ledger, a summary of decisions, seams, and any approved refactors. Ask the user to confirm that the ledger accurately represents their choices. Then ask explicitly:

> "Every user-owned material architectural topic is explicitly confirmed and the bounded validity review has no unresolved blockers. Do you approve the architect gate? (This will advance the change to `specify`.)"

On approval:
```
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate architect --approve
```

Tell the user: **run `specify` next.**

---

## Reference files

- `references/challenge-protocol.md` — adversarial stance and override rules
- `references/adversarial-review.md` — bounded `AV-*` review cycle and finding schema
- `references/context-schema.md` — CONTEXT.md schema (for reading existing files)
- `references/seam-and-test-taxonomy.md` — firmness model
- `references/manifest-schema.md` — manifest structure including epic parent/child model
- `references/change-lifecycle.md` — full pipeline
- `references/firm-change-protocol.md` — if a firm seam needs to change
- `references/templates/architecture.md.tmpl` — output template
- `references/idioms/<lang>.md` — load if `manifest.language` is set
