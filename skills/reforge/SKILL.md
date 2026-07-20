---
name: reforge
description: Use when you have a PoC or prototype and want to rebuild it as a production-quality system from scratch. Distills the functional intent and lessons learned from the prototype, discards the implementation, and produces a reforge-seed.md that seeds a greenfield architect session. Do NOT use to improve an existing production system — use architect for that.
---

# Reforge

You are running the **reforge** entry ramp. Your job is to extract the *intent* and *lessons* from a prototype or PoC, then discard its implementation. The output — `reforge-seed.md` — feeds a fresh `architect` session for a new production-quality repo. You are not improving the prototype. You are mining it for knowledge so the new system starts ahead.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Your stance

Deliberately selective. You are looking for:
- **What the prototype proved.** What capabilities work and must survive into production.
- **What the prototype revealed.** Complexity, edge cases, and failure modes the author didn't expect.
- **What must NOT carry forward.** Implementation shortcuts, wrong abstractions, accidental patterns.

This requires honesty. A PoC author often anchors on their prototype's patterns. Your job is to see past the implementation to the underlying intent.

## Phase 1: Comprehend the PoC

Run explore subagents to understand the prototype — not to document it, but to extract intent.

**Explore agent 1 — capabilities:**
> "Explore this codebase. What does it do? Describe its capabilities in terms of user/system behavior and outcomes — not implementation. What problem does it solve? What does it explicitly NOT do?"

**Explore agent 2 — domain complexity:**
> "Explore this codebase. What were the hardest problems to solve? Where is the code most complex or most commented? What edge cases does the implementation handle? What edge cases does it seem to have punted on? What would break under production load or with real users?"

**Explore agent 3 — implementation quality:**
> "Explore this codebase. What implementation shortcuts were taken? What patterns are clearly PoC-quality (hardcoded values, skipped validation, missing error handling, single-user assumptions)? What abstractions feel wrong or accidental? What would you rewrite first?"

Present findings and discuss with the user before writing the seed.

## Phase 2: Interview — intent and lessons

This is a short, focused interview. Goal: confirm and extend the explore findings with the user's firsthand knowledge.

Questions (one at a time, challenge answers):

1. What capabilities from the PoC *must* exist in the production system? (Enumerate explicitly.)
2. What capabilities were explored but should NOT be in the production system? (Anti-goals.)
3. What was the single most surprising thing you learned building the PoC?
4. What would you do completely differently if starting over today?
5. Are there domain terms or concepts in the PoC that are correctly named? (These carry forward to the glossary.)
6. Are there domain terms or concepts that are *incorrectly* named or modeled? (These should be corrected in the new system.)
7. What acceptance criteria would the production system need to satisfy that the PoC never addressed?
8. What is the target language/stack for the production system? (Sets idioms context.)

Challenge vague answers. "I'd refactor the architecture" is not an answer. "The event loop model was wrong because X; I'd use Y instead" is an answer.

After the target language is known, load `references/idioms/<lang>.md` if it exists and use it to challenge implementation anti-patterns and the proposed production direction. If no matching pack exists, state that and use the target ecosystem's established conventions and tooling rather than assuming pack guidance.

## Phase 3: Write reforge-seed.md

Fill `references/templates/reforge-seed.md.tmpl`. Be specific and opinionated. Vague seeds produce vague architecture.

Fields to fill carefully:
- **Functional Intent** — behavior and outcomes, not implementation
- **Capabilities That Must Be Preserved** — specific, not generic
- **Anti-Goals** — explicit and justified
- **Lessons Learned** — the most valuable output. Specific enough to be actionable.
- **Implementation Anti-Patterns to Avoid** — each with a "why it was bad, what to do instead" pair
- **Known Domain Complexity** — things that will be hard again in production
- **Rough Acceptance Criteria** — high-level behavioral requirements for the architect session
- **Questions for the Architect Session** — open questions the PoC raised but didn't answer

Write to: a location of your choice (the reforge seed is not an active change artifact — it's a starting point).

Suggested path: `reforge-seed.md` at the root of the new project's future location, or as a temp file the user can move.

## Phase 4: Hand off to architect

Present the seed to the user. Walk through it. Confirm:
- The capabilities list is complete.
- The anti-goals are honest.
- The lessons are specific enough to be actionable challenges in architect.
- The questions for the architect session are real gaps.

Then:
> "The reforge seed is ready. Start a new repository for the production system and run `architect` there, pointing it at this seed. The architect session will use the Rough Acceptance Criteria and Questions as its starting challenges."

If the target language is known, note:
> "Set `manifest.language = <lang>` when creating the architect change manifest to load the idioms pack."

## What reforge does NOT do

- It does not create a CONTEXT.md (the new repo has no code yet; `architect` will do that after the first implementation cycle, or `map` after the first working version).
- It does not run `architect` itself — it prepares the seed. The user starts the new repo first.
- It does not suggest carrying forward any implementation code from the PoC. If the user wants to port code, that's their decision — surface it as a specific question in the seed.

## Reference files

- `references/templates/reforge-seed.md.tmpl`
- `references/templates/CONTEXT.md.tmpl` — for reference on what architect will produce
- `references/challenge-protocol.md`
- `references/idioms/<lang>.md` — if target language is known
