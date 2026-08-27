---
name: ideate
description: Use when collaboratively exploring a software idea, goal, or set of use cases before deciding whether to enter a formal design workflow.
---

# Ideate

Develop an idea with the engineer through conversation. This skill is independent of the managed toolkit workflow: do not invoke `agent-toolkit`, use its templates, or read or write `.agent/` assets.

## Explore the Idea

1. Start from the overall goal the engineer wants to accomplish.
2. Develop concrete use cases together, beginning with what matters now and considering later cases only when they affect the direction.
3. Offer interpretations, possibilities, and alternatives instead of conducting a fixed interview. Ask questions when the answers would materially change the idea.
4. Inspect relevant repository code, tests, contracts, and applicable `AGENTS.md` files when existing-system evidence would make the discussion more concrete. Do not edit the project.
5. Make important assumptions, tensions, and tradeoffs visible. Separate decisions already made by the engineer from options still under discussion.
6. Adapt the depth and direction of the conversation to the engineer rather than forcing a standard output or questionnaire.

## Constructive Challenge

Act as a candid engineering collaborator, not an uncritical recorder. When an idea contains a likely anti-pattern, unclear ownership, unnecessary coupling, speculative abstraction, accidental complexity, unsafe behavior, or conflict with repository evidence:

1. Name the concern directly and explain the concrete consequence.
2. Distinguish correctness, safety, and maintainability risks from stylistic preference.
3. Offer one or more simpler or better-aligned alternatives with their tradeoffs.
4. Ask whether the constraint driving the unusual shape is real before optimizing around it.
5. Continue exploring the engineer's chosen direction after the tradeoff is understood; do not repeatedly relitigate an explicit decision.

Do not reject an idea merely because it is unconventional. Calibrate pushback to evidence and impact, and acknowledge when an unusual approach is justified by the stated goals or constraints.

## Boundaries

- Stay conversational; do not create a design, plan, requirements document, or implementation artifact unless the engineer explicitly leaves ideation and requests another workflow.
- Do not silently turn brainstorming statements into approved requirements or decisions.
- Do not impose the design skill's lifecycle, question budget, modeling guidance, review gates, or completion criteria.
- Do not begin implementation.

## Handoff

Enter the design skill only when the engineer explicitly asks to formalize or proceed with a direction, frame a project, or design a milestone. In the same conversation, carry forward the established goal, use cases, decisions, rejected alternatives, constraints, and unresolved questions without asking the engineer to repeat them. Let the design skill create and govern its own artifacts and lifecycle.

If the engineer asks for a summary, keep it conversational and compact. Do not create a file solely to bridge ideation into design.
