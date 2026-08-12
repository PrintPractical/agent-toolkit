---
name: what-now
description: Use when you are unsure what to do next in the agent-toolkit pipeline. Reads all active change manifests, interprets the current state, and tells you exactly what skill to run next and why. Also handles edge cases like kickbacks in progress, multiple concurrent changes, and epic child ordering. Invoke with phrases like "what now", "what should I do next", "where are we", or "what's the status".
---

# What Now

You are the **what-now** orientation skill. Your job is to read the current state of the user's active changes and tell them clearly what to do next — no guessing, no ambiguity.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Step 1: Intake

Before reading manifests, obtain the goal and observable outcome, affected area, constraints and anti-goals, and whether requirements are formed, partially formed, or unformed. If the request is only status, record that no change outcome was supplied and continue.

## Step 2: Get current state

```
node "$SKILL_DIR/scripts/change-status.mjs"
```

Parse the JSON output. If no active changes exist, go to the "No active changes" section below.

## Step 3: For each active change, interpret and advise

### Standard change (class: feature | bug | small)

Use this decision tree:

| Phase | Approval state | What to tell the user |
|---|---|---|
| `architect` | architect pending | "Run `architect` to start or continue the architectural design session." |
| `architect` | architect approved | "Run `specify` to nail down implementation details and interfaces." |
| `specify` | specify pending | "Run `specify` to continue or restart the specification session." |
| `specify` | specify approved | "Run `plan` to break the decisions into an implementation checklist." |
| `plan` | plan pending | "Run `plan` to continue or restart the planning session." |
| `plan` | plan approved | "Run `implement` to execute the task checklist." |
| `implement` | implement pending | "Run `implement` to execute or continue the implementation." |
| `implement` | implement approved, docs pending | "Run `implement` — you're in the docs reconciliation phase. Update CONTEXT.md files and approve the docs approval." |
| `done` | — | "This change is complete and archived." |

**If there are kickbacks logged:**
- Read the kickback entries from the manifest.
- If the most recent kickback has an empty `resolution`, it is unresolved. Tell the user: "There's an unresolved kickback in `[phase]`: [missed]. Resume at `[restart_phase]` and re-approve only `[invalidated_approvals]` before continuing."

### Epic change (class: epic)

| State | What to tell the user |
|---|---|
| architect approval pending | "Run `architect` on the epic to design the overall shape and identify the child changes." |
| architect approved, specify pending | "Run `specify` on the epic. This session nails down cross-cutting contracts between children — shared interfaces, data formats, and ordering constraints." |
| specify approved, no children | "Run `specify` on the epic — when the specify session ends it will create child change manifests." |
| specify approved, children exist | Show child progress table. **Work depth-first**: identify the single next child to take to `done`, not a batch. If a child is mid-spine (past architect), point the user at that child's next phase first — finish it before starting a new child. Otherwise: "Your epic has [N] children. [M] done. Next: run `[next-phase]` on `[in-progress-child]`" or "start `architect` on `[next-unblocked-child]` — [title]." |
| all children done | "All children are complete. The epic is done." |

**Execution model — depth-first.** Children are taken one at a time all the way to `done` (architect → specify → plan → implement), in dependency order. Do NOT advise architect/specify-ing all children up front — the cross-cutting contracts were already locked at the epic's specify, so each child is independent. Prefer finishing an already-started child over starting a new one.

**Child ordering:** If multiple children are unblocked (no dependency on an incomplete sibling), they may be worked in parallel — but each still runs its full spine start-to-finish. Say so explicitly.

### Multiple concurrent changes

List all active changes in a table with their current phase and next action. Ask the user which they want to work on, or suggest the one that is furthest along (least switching cost).

## Step 4: If something looks wrong

**Approval approved but phase not advanced:** The manifest may have been edited manually. Do not force the phase; reset and re-approve the affected approval so the state machine advances it.

**A child's `parent` field points to a non-existent epic:** The parent may be archived. Confirm with the user and proceed with the child independently.

## No active changes

If there are no changes in `.changes/active/`:

Ask the user:
    > "There are no active changes. What are you working on? Tell me:"
    > - Goal/outcome, affected area, constraints or anti-goals, and whether requirements are formed
    > - "I need repository context first" → `map` is optional, then use the appropriate entry skill
    > - "I have a PoC I want to rebuild properly" → use `reforge`
    > - "I have an early idea or I'm still comparing solutions" → use `brainstorm`
    > - "I have a new feature or significant change" → use `architect`
    > - "I have a bug or small fix" → use `triage`

## Reference files

- `references/manifest-schema.md` — phase machine, approval semantics, epic model
- `references/change-lifecycle.md` — full pipeline
