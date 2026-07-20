---
name: specify
description: Use after architect gate is approved to run the specification stage. Conducts a systematic one-question-at-a-time disambiguation interview, challenges answers, nails all interface changes, then runs an adversarial implement-as-if dry-run subagent to surface remaining ambiguities. Emits decisions.md and reconciles architecture.md. Do not run unless the architect gate is approved.
---

# Specify

You are running the **specify** stage of the agent-toolkit pipeline. Spine stage 2. Your job is to eliminate every implementation ambiguity before `plan` and `implement` run. If a question is not answered here, it becomes a kickback during `implement` — which means the spec process failed.

**If `manifest.class = epic`:** Follow the Epic Specify path at the bottom of this file. Epic specify is scoped to cross-cutting contracts only — not per-child implementation details.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Your stance

Same adversarial posture as `architect`. Re-read `references/challenge-protocol.md`. Here you are drilling down from architectural decisions to implementation specifics. Challenge every vague answer. The user may override; record it. One question at a time — never pile questions.

## Preconditions

Load `manifest.yaml`. Verify:
- `stage` is `specify` (i.e., architect gate was approved).
- `gates.specify` is `pending`.
- `architecture.md` exists and has a passed validity check.
- **If `class = epic`:** jump to the Epic Specify section below.

If preconditions fail, tell the user what's wrong and which step to run instead.

Load `architecture.md` fully. This is your spec baseline.

If `manifest.language` is set, load `references/idioms/<lang>.md` for interface design guidance.

## Phase 1: Interface inventory

Before the interview, extract from `architecture.md`:
- All new or modified seams
- All interfaces mentioned in the decisions
- All refactors in scope

List them. These are the ambiguity sources. Each will need at least one interview question.

## Phase 2: One-question-at-a-time interview

Conduct a systematic disambiguation interview. Rules:
- One question per message. Wait for the answer before proceeding.
- After each answer: challenge if it's vague, introduces a smell, or conflicts with the idioms pack. Accept the answer only when it is precise enough to write code from.
- If the user overrides a challenge: record the override explicitly (challenge raised, user decision, reasoning if given).
- Stop asking when you genuinely believe zero ambiguities remain.

Question categories (cover all that apply):
1. **Interface definitions** — exact signatures, types, error conditions, edge cases
2. **Data contracts** — field names, types, required vs optional, validation rules
3. **Error handling** — every failure mode mentioned in `architecture.md`, what happens
4. **Concurrency/ordering** — if the change touches concurrent code, ordering guarantees
5. **Configuration** — new config knobs, their defaults, their validation
6. **Migration/compatibility** — is this a breaking change? backward-compat requirements?
7. **Test scenarios** — which scenarios must be covered for each firm seam?
8. **Observability specifics** — exact metric names, trace spans, log levels
9. **Refactor scope** — for each approved refactor: exact files/modules, what changes

Keep a running tally of resolved questions. You'll need them for `decisions.md`.

## Phase 3: Implement-as-if dry run

When you believe the interview is complete, spin off a subagent to act as an implementer and attempt to implement the change *without writing any code* — only describe what they would do and where they get stuck.

Subagent prompt:
> "You are implementing the following change. You have architecture.md and decisions.md. Walk through the implementation step by step. At each step, describe what you would write. Flag any ambiguity, missing information, conflicting requirement, or decision you'd have to make on your own. Do not write code — only describe and flag."

Hand the subagent: `architecture.md` + the interview log so far.

**If the dry run finds ambiguities:** add them to the interview queue. Return to Phase 2. Record the iteration number.

**If the dry run is clean:** proceed.

## Phase 4: Write decisions.md

Fill `decisions.md` from `references/templates/decisions.md.tmpl`. Include:
- All interface changes (complete, exact)
- Full interview log (Q → resolution, challenges, overrides)
- Dry-run iteration results
- Architecture reconciliation notes (any disparities found in architecture.md and how they were fixed)

Write to: `.changes/active/<id>/decisions.md`

Update `manifest.yaml context_targets` if new CONTEXT.md targets were identified during the interview.

## Phase 5: Reconcile architecture.md

Compare `decisions.md` against `architecture.md`. If any decision changes, clarifies, or contradicts an architectural decision:
- Update `architecture.md` to reflect the refined understanding.
- Note the reconciliation in `decisions.md` under "Architecture Reconciliation."

## Phase 6: Gate

Present a summary: interfaces finalized, questions resolved, dry-run clean. Ask:

> "The dry-run passed with no ambiguities. Do you approve the specify gate? (This will advance to `plan`.)"

On approval:
```
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate specify --approve
```

Tell the user: **run `plan` next.**

## Handling kickbacks from implement

If you are running `specify` because `implement` kicked back (not a fresh session), treat it as an amendment session:
- Load the kickback entry from `manifest.yaml`.
- Address only the gap identified in the kickback.
- Run a targeted dry-run covering just that gap.
- Update `decisions.md` with the new resolution.
- Reconcile `architecture.md` if needed.
- Set the latest kickback entry's `resolution` in `manifest.yaml` to the actual decision. Do not leave it empty or use a placeholder such as `pending`.
- Re-approve the specify gate.
- Confirm that approval advanced the manifest to `stage: plan`.
- Remind the user to run `plan` and re-approve its gate after `plan.md` is updated. Do not tell them to resume `implement` while the current stage is `plan`.

## Reference files

- `references/challenge-protocol.md`
- `references/seam-and-test-taxonomy.md`
- `references/manifest-schema.md` — kickback types and epic model
- `references/firm-change-protocol.md` — if a firm interface must change
- `references/templates/decisions.md.tmpl`
- `references/idioms/<lang>.md` — interface design guidance

---

## EPIC SPECIFY PATH — class: epic

Epic specify is scoped to **cross-cutting contracts only** — things that multiple children must agree on. Do NOT drill into per-child implementation details; that happens in each child's own `specify` session.

### What "cross-cutting" means

A cross-cutting concern is something that two or more child changes both touch or depend on. Examples:
- A shared message format or wire protocol that child A produces and child B consumes
- A shared data structure (a domain type, an error enum) that multiple children reference
- A configuration schema that all children read
- An event or notification contract between components
- Error handling conventions that must be consistent across all children

If a contract or interface belongs to exactly one child, it is NOT cross-cutting — skip it here, let that child's `specify` handle it.

### Epic Specify phases

**Phase E1: Identify cross-cutting items**

From `architecture.md`, extract:
- Every interface marked as shared across children in the "Proposed Child Changes" section
- Every seam that multiple children cross
- Any explicit "cross-cutting concerns to resolve in specify" section

List them. These are the only things this session covers.

**Phase E2: One-question-at-a-time interview (cross-cutting only)**

Same adversarial discipline as standard specify, but scoped strictly:
- Exact type signatures, message formats, error types for each shared interface
- Which child owns (authors) each shared contract vs which children consume it
- Versioning / evolution rules: can a shared interface change mid-epic without breaking other children?
- Ordering constraints: if child A produces an interface that child B consumes, must A's interface be complete before B starts its `specify`?

**Phase E3: Dry run**

Spin off a subagent:
> "You are implementing these N child changes. You have the epic's architecture.md and decisions.md. Walk through the interface boundaries between children. Flag any gap, ambiguity, or contract that one child produces and another consumes that is not fully specified."

If ambiguities are found, loop back to Phase E2.

**Phase E4: Write epic decisions.md**

Write `decisions.md` covering:
- All cross-cutting interface definitions (complete and exact)
- Ownership map: which child authors each shared interface
- Ordering constraints between children
- Dry-run findings and resolutions
- What is explicitly OUT OF SCOPE for this document (left to per-child specify)

Write to: `.changes/active/<id>/decisions.md`

**Phase E5: Gate + auto-decompose (you run this, not the user)**

First, approve the specify gate:
```
node "$SKILL_DIR/scripts/manifest-gate.mjs" --id <id> --gate specify --approve
```

**Then immediately run epic-split automatically** — do not ask the user to do this manually. Read the "Proposed Child Changes" section from `architecture.md` and the ordering/ownership decisions from `decisions.md`, construct the children JSON, and run:

```
node "$SKILL_DIR/scripts/epic-split.mjs" --epic <id> --children '[
  {
    "title": "Child 1 title",
    "class": "feature",
    "language": "rust",
    "notes": "Brief scope: what this child owns, what interfaces it produces, what it depends on from sibling children. 2-3 sentences."
  },
  {
    "title": "Child 2 title",
    "class": "feature",
    "language": "rust",
    "notes": "..."
  }
]'
```

**Note on existing epic manifests with extra gates:** If the epic manifest has `plan`, `implement`, or `docs` gates (created before this fix), they are harmless — they are never read for epics. You can leave them as-is. Going forward, new epics only get `architect` and `specify` gates.

Each child gets an `architect-seed.md` with its notes and implicit access to the epic's arch+decisions as parent context.

After epic-split completes, tell the user:
> "Epic decomposed. [N] child changes created. Each child's `architect` session will inherit this epic's architecture and decisions as parent context.
>
> **Work depth-first: take one child all the way to `done` (architect → specify → plan → implement) before starting the next.** Do not architect/specify all children up front — the cross-cutting contracts are already locked here at the epic level, so each child is insulated from the others. Finishing one child gives working software and lessons that inform the next.
>
> Suggested order (based on dependencies):
> 1. `[child-id-1]` — [title] (no dependencies, start here)
> 2. `[child-id-2]` — [title] (depends on child 1's X interface)
> ...
>
> Independent children may run in parallel, but each still goes through its full spine start-to-finish. Run `architect` on the first child when ready. Check progress anytime by asking 'what now'."
