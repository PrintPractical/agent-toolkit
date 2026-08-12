---
name: specify
description: Use after architect approval is approved to run the specification phase. Batches material decisions with recommendations, requires explicit confirmation of each, finalizes interface changes, then runs an adversarial implement-as-if dry run for unresolved blockers. Emits decisions.md and reconciles architecture.md. Do not run unless the architect approval is approved.
---

# Specify

You are running the **specify** phase of the agent-toolkit pipeline. Spine phase 2. Your job is to settle every material behavioral and contract decision before `plan` and `implement`, while preserving implementation freedom for local, reversible, idiomatic choices. An unresolved material decision becomes a kickback during `implement`.

**If `manifest.class = epic`:** Follow the Epic Specify path at the bottom of this file. Epic specify is scoped to cross-cutting contracts only — not per-child implementation details.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Your stance

Same adversarial posture as `architect`. Re-read `references/challenge-protocol.md`, `references/adversarial-review.md`, and `references/engineering-fundamentals.md`. Recommend the best solution for each user-owned material decision. Ask the user only about public contracts, security policy, compatibility/migration, firm seams, irreversible/costly commitments, and meaningful architectural or operational tradeoffs. Auto-select conventional idiomatic choices that are local/private/reversible; silence is never acceptance for a decision that truly needs the user.

## Preconditions

Load `manifest.yaml`. Verify:
- `phase` is `specify` (i.e., architect approval was approved).
- `approvals.specify` is `pending`.
- `architecture.md` exists and has a passed validity check.
- **If `class = epic`:** jump to the Epic Specify section below.

If preconditions fail, tell the user what's wrong and which step to run instead.

Load `architecture.md` fully. This is your spec baseline.

If `manifest.language` is set, use the `idioms` skill to load its matching pack for interface design guidance. If no matching pack is installed, state that and use the repository's language conventions and tooling rather than assuming pack guidance.

## Phase 1: Interface inventory

Before the interview, extract from `architecture.md`:
- All new or modified seams
- All interfaces mentioned in the decisions
- All refactors in scope

List them as review scope. Ask only when a choice crosses the materiality boundary. Configuration or observability details are user-owned only when they define a public/operational contract, security policy, costly commitment, or meaningful tradeoff. Use repository conventions and idioms for local/private/reversible details.

## Phase 2: Batched decision confirmation

Conduct a systematic confirmation interview in concise numbered batches. Rules:
- Each item states a user-owned material question, the agent's recommendation, its rationale, and meaningful alternatives.
- Require an explicit response for every item: `accept`, choose an alternative, or provide a decision. The user may respond compactly by item number.
- A missing, vague, or ambiguous answer stays `unresolved`. Follow up only on unresolved items; never infer acceptance from silence.
- Challenge an answer only when it is vague, introduces a smell, or conflicts with the idioms pack. If the user overrides a challenge, record the recommendation, user decision, and reasoning if given.
- Stop when every user-owned material item is explicitly confirmed. Do not create questions or ledger rows for local/private/reversible details governed by repository convention and idioms.

Examine these categories, but ask only where the choice crosses the materiality boundary:
1. **Interface definitions** — exact signatures, types, error conditions, edge cases
2. **Data contracts** — field names, types, required vs optional, validation rules
3. **Error handling** — every failure mode mentioned in `architecture.md`, what happens
4. **Concurrency/ordering** — if the change touches concurrent code, ordering guarantees
5. **Configuration** — new config knobs, their defaults, their validation
6. **Migration/compatibility** — is this a breaking change? backward-compat requirements?
7. **Test scenarios** — which scenarios must be covered for each firm seam?
8. **Observability specifics** — exact metric names, trace spans, log levels
9. **Refactor scope** — for each approved refactor: exact files/modules, what changes

Keep a confirmation ledger as you work. Every resolved item needs a decision ID, recommendation, explicit user response, and `confirmed` status. You'll need it for `decisions.md`.

## Phase 3: Bounded implement-as-if review

After confirmation, run exactly one `SV-*` cycle from `references/adversarial-review.md`. A fresh implementer-critic performs one broad, read-only implement-as-if pass over `architecture.md`, the draft decisions, and relevant repository context. It reviews deeply where applicable across data/state, data structures, interfaces/traits, errors, security, observability, simplicity, maintainability, and idioms. It must not prescribe private control flow merely because implementation freedom remains.

Consolidate every finding into one batch. Each finding has a stable `SV-NNN` ID, severity `blocker|major`, category `correctness|security|simplicity|maintainability|idioms`, evidence, concrete impact, and concrete alternative. Do not emit low-severity findings or mandatory `N/A` rows.

Remediate the complete batch once. Obtain user confirmation only for remediation crossing the materiality boundary; auto-select local/private/reversible conventional idiomatic choices. Then launch a fresh verifier to check only the original IDs. Verification does not repeat discovery, expand scope, or introduce new low/major findings. A remediation-caused blocker regression is the sole new-ID exception: record it with `--regression`, correct it in the same focused scope, and close it with `--regression-resolution` during the one targeted reverification. If any ID remains unresolved or closure needs broad investigation, stop instead of extending the cycle.

Record the discovery and verification under structured cycle `specify-1` with `review-log.mjs`. The auditor uses structured `--finding` JSON from the shared policy; the verifier supplies one `--resolution SV-NNN=resolved|unresolved` for every original finding. An approved clean auditor still requires a distinct verifier:

```
node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --phase specify --cycle specify-1 \
  --role auditor --reviewer "<fresh label>" --verdict approved
node "$SKILL_DIR/scripts/review-log.mjs" record --id <id> --phase specify --cycle specify-1 \
  --role verifier --reviewer "<distinct fresh label>" --verdict approved
```

## Phase 4: Write decisions.md

Fill `decisions.md` from `references/templates/decisions.md.tmpl`. Include:
- A complete confirmation ledger before the prose decisions
- All interface changes (complete, exact)
- Full decision log (batch item → recommendation → explicit resolution, challenges, overrides)
- The bounded `SV-*` review cycle and focused verification results
- Architecture reconciliation notes (any disparities found in architecture.md and how they were fixed)

Write to: `.changes/active/<id>/decisions.md`

Update `manifest.yaml context_targets` if new CONTEXT.md targets were identified during the interview.

## Phase 5: Reconcile architecture.md

Compare `decisions.md` against `architecture.md`. If any decision changes, clarifies, or contradicts an architectural decision:
- Update `architecture.md` to reflect the refined understanding.
- Note the reconciliation in `decisions.md` under "Architecture Reconciliation."

## Phase 6: Approval

Present the confirmation ledger, interfaces finalized, and dry-run findings. Ask the user to confirm the ledger accurately represents their choices. Then ask:

> "Every user-owned material decision is explicitly confirmed and the bounded specification review has no unresolved blockers. Do you approve the specify approval? (This will advance to `plan`.)"

On approval:
```
node "$SKILL_DIR/scripts/manifest-approval.mjs" --id <id> --approval specify --approve
```

Tell the user: **run `plan` next.**

## Handling kickbacks from implement

If you are running `specify` because `implement` kicked back (not a fresh session), treat it as an amendment session:
- Load the kickback entry from `manifest.yaml`.
- Address only the gap identified in the kickback.
- Run targeted review covering only that recorded gap; do not restart broad discovery. If it reveals a new material decision, confirm that decision and record it under the kickback rather than manufacturing another formal review cycle.
- Update `decisions.md` with the new resolution.
- Reconcile `architecture.md` if needed.
- Set the latest kickback entry's `resolution` in `manifest.yaml` to the actual decision. Do not leave it empty or use a placeholder such as `pending`.
- Re-approve only the invalidated approval(s). A specify-impacting kickback requires specify then plan; a plan-only kickback requires only plan.
- Confirm the manifest's recommended next phase before telling the user to resume implementation.

## Reference files

- `references/challenge-protocol.md`
- `references/adversarial-review.md` — bounded `SV-*` review cycle and finding schema
- `references/seam-and-test-taxonomy.md`
- `references/manifest-schema.md` — kickback types and epic model
- `references/firm-change-protocol.md` — if a firm interface must change
- `references/templates/decisions.md.tmpl`
- `idioms` skill — matching interface-design guidance

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

**Phase E2: Batched decisions (cross-cutting only)**

Use the standard materiality boundary and confirmation discipline, scoped strictly. Ask only about shared public contracts, security policy, compatibility/migration, firm seams, costly commitments, or meaningful cross-child architectural/operational tradeoffs. Auto-select local/private/reversible conventional choices. Examine:
- Exact type signatures, message formats, error types for each shared interface
- Which child owns (authors) each shared contract vs which children consume it
- Versioning / evolution rules: can a shared interface change mid-epic without breaking other children?
- Ordering constraints: if child A produces an interface that child B consumes, must A's interface be complete before B starts its `specify`?

**Phase E3: Bounded cross-child review**

Run exactly one `SV-*` cycle over all cross-child contracts. One fresh critic makes one broad implement-as-if pass across every child boundary and all applicable review dimensions. Present one consolidated blocker/major batch using stable `SV-NNN` IDs, the required categories, evidence, concrete impact, and alternatives. Remediate once, asking the user only for material decisions. A fresh verifier checks only original IDs; allow at most one targeted correction/reverification, with no repeated discovery or new low/major findings. Record the cycle under `Dry-Run Findings`. If an original blocker remains, do not decompose the epic.

Record the auditor and verifier through `review-log.mjs` under cycle `specify-1` exactly as in the standard path.

**Phase E4: Write epic decisions.md**

Write `decisions.md` covering:
- All cross-cutting interface definitions (complete and exact)
- Ownership map: which child authors each shared interface
- Ordering constraints between children
- Dry-run findings and resolutions
- What is explicitly OUT OF SCOPE for this document (left to per-child specify)

Write to: `.changes/active/<id>/decisions.md`

**Phase E5: Approval + auto-decompose (you run this, not the user)**

First, approve the specify approval:
```
node "$SKILL_DIR/scripts/manifest-approval.mjs" --id <id> --approval specify --approve
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
