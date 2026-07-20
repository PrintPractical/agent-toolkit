---
name: brainstorm
description: Use when an idea, problem, or possible solution is not formed enough to begin architect. Explores the problem and alternative approaches, challenges assumptions during convergence, and can produce an optional architect-seed.md handoff for a later architect session. Do NOT use once the change is ready for architectural decisions — use architect directly.
---

# Brainstorm

You are running the **brainstorm** entry ramp. Your job is to turn an early, incomplete idea into a clearer set of options and, when useful, a provisional direction for `architect` to challenge. This is optional discovery, not a pipeline stage.

## Boundaries

- Do not create a change manifest, approve a gate, or create an active change.
- Do not present an explored option as approved architecture.
- `architect` remains the right direct entry point when the user already has a sufficiently formed change.

## Your stance

Read `references/challenge-protocol.md`. Be expansive while generating options and constructively adversarial while narrowing them. Do not dismiss an early idea for being incomplete; expose the uncertainty that prevents a sound architectural decision.

## Phase 1: Frame the idea

Start with the problem, not a proposed implementation. Work one topic at a time:

1. What problem or opportunity prompted this?
2. Who is affected, and what outcome would make this worthwhile?
3. What is known evidence versus a hypothesis or preference?
4. What constraints, dependencies, and anti-goals are already clear?

If the user starts with a solution, restate the underlying problem and confirm it before evaluating the solution.

## Phase 2: Diverge

Generate several meaningfully different approaches. Include retaining the status quo when it is a credible option. For each approach, capture:

- What it changes and what it deliberately leaves alone
- Expected benefits
- Costs, risks, and failure modes
- Assumptions that need validation
- Information that would distinguish it from the alternatives

Do not force convergence before the options are genuinely distinct. Use relevant repository context or lightweight exploration when it would materially improve the comparison, but do not begin detailed architecture or implementation planning.

## Phase 3: Converge

Compare the strongest options against the desired outcomes and constraints. Challenge unjustified assumptions, accidental scope expansion, and choices that create complexity without a clear payoff. State a provisional recommendation only when its tradeoffs are understood.

If the evidence is insufficient, recommend the smallest discovery step needed before `architect` rather than manufacturing a decision.

## Phase 4: Optional handoff

Summarize the problem, options, tradeoffs, recommendation, and open questions. Ask whether the user wants a durable handoff for `architect`.

If yes, fill `references/templates/architect-seed.md.tmpl` and write `architect-seed.md` at the project root or another path the user chooses. Label every entry as fact, hypothesis, preference, or provisional recommendation where applicable.

Then tell the user:

> "The brainstorm seed is ready. Run `architect` and point it at this seed. It will challenge and formalize the direction before any architect gate is approved."

If no, leave the result as session discussion. Do not create an artifact merely for bookkeeping.

## Reference files

- `references/challenge-protocol.md`
- `references/change-lifecycle.md`
- `references/templates/architect-seed.md.tmpl`
