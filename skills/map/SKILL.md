---
name: map
description: Use on a brownfield codebase that has no CONTEXT.md files yet. Reverse-engineers the system and component architecture from existing code to produce a CONTEXT.md hierarchy — root system context plus per-component context files. Run this once before using architect or triage on an existing project. Also use when CONTEXT.md files exist but are severely out of date.
---

# Map

You are running the **map** entry ramp. Your job is to comprehend an existing codebase and produce a living CONTEXT.md hierarchy that makes `architect`, `triage`, and `verify` viable. You document **what is**, including its debt. You do not design what should be — that is `architect`'s job.

## Running the helper scripts

This skill bundles its helper scripts in its own `scripts/` directory (installed alongside this SKILL.md). Set `SKILL_DIR` to this skill's absolute path — shown as **Base directory for this skill** at the end of this file — then run the scripts from your **project root** (they operate on the project's `.changes/` and `CONTEXT.md` files):

```bash
SKILL_DIR="<absolute path to this skill's directory>"
```

All `node "$SKILL_DIR/scripts/..."` commands below depend on this. Never reference `packages/build/` — that path only exists in the toolkit's development repo, not in an installed skill.

## Your stance

Descriptive, not prescriptive. Map the codebase as it exists. When you see something suboptimal:
- Document it in `Known-soft-spots`.
- Assign `soft` firmness unless there is strong evidence the pattern is load-bearing (depended on by external consumers, contractual, etc.).
- Do NOT recommend changes to the user — this session produces documentation, not a refactor plan.

Conservative firmness: when in doubt, tag `soft`. It is easy to earn `firm` later; it is disruptive to downgrade a wrongly-designated `firm` seam.

## Phase 1: Discovery

Run the context discovery scan to find any existing CONTEXT.md files:
```
node "$SKILL_DIR/scripts/context-discover.mjs"
```

Then use explore subagents to understand the codebase structure. Split the work:

**Explore agent 1 — system level:**
> "Explore this codebase. Identify: the top-level components and their responsibilities, the major data flows, the technology stack, any obvious seams between components, and any configuration or environment dependencies. Report back with a structured summary."

**Explore agent 2 — build and test infrastructure:**
> "Explore this codebase. Identify: how it is built, how tests are organized and run, what testing frameworks are used, and what test coverage exists. Report back."

**For each top-level component (in parallel if multiple):**
> "Explore the <component> directory/module. Identify: its public interface, its internal structure, its dependencies on other components, any configuration it reads, and any obvious technical debt or known suboptimal patterns. Report back."

## Phase 2: Root CONTEXT.md

From the explore results, draft the root `CONTEXT.md` using `references/templates/CONTEXT.md.tmpl` with `--root`.

Key decisions:
- **Seam firmness:** Err toward `soft`. A seam is `firm` only if it is externally contracted (published API, IPC protocol with external consumers, file format with external users).
- **Known-soft-spots:** Be honest and specific. This is the most valuable field for future agents — it grants permission to improve.
- **Glossary:** Capture domain terms as used in the *code*, not as ideally defined. Use the names that appear in the codebase.
- **Technical requirements:** Only include hard constraints with evidence. "It should be fast" is not a technical requirement. "Latency p99 < 50ms per the API contract in config/sla.yaml" is.

Scaffold and fill:
```
node "$SKILL_DIR/scripts/context-scaffold.mjs" --path . --name "<Project Name>" --root
```

Then fill every section. Leave `Acceptance/Behavioral Criteria` empty unless you can identify clear, externally observable behavioral contracts from the code.

## Phase 3: Component CONTEXT.md files

For each top-level component, scaffold and fill a CONTEXT.md:
```
node "$SKILL_DIR/scripts/context-scaffold.mjs" --path <component-dir> --name "<Component Name>"
```

Populate each field from the explore agent's report. Apply the same conservative firmness rules.

For each component, ask:
- What is the component's single responsibility? (If it has two, note that in Known-soft-spots.)
- What is its public interface to other components?
- What does it depend on?
- What would break if it changed?

## Phase 4: Validity check

Spin off a subagent:
> "You are reviewing CONTEXT.md files derived from a codebase analysis. For each CONTEXT.md, check: do the claims match what you can see in the code? Are there missing seams? Are there seams marked firm that don't appear to be externally contracted? Are there obvious technical debts missing from Known-soft-spots? Report discrepancies."

Hand the subagent all generated CONTEXT.md files + the explore reports.

Resolve discrepancies before finalizing.

## Phase 5: Stamp provenance

After the user reviews and approves the CONTEXT files, stamp each with the current HEAD SHA:
```
git rev-parse HEAD
```

Update the `Provenance: validated-at:` line in each CONTEXT.md.

## Phase 6: Present to user

Show:
- Root CONTEXT.md
- List of component CONTEXT.md files created
- Count of firm vs soft seams
- Known-soft-spots inventory (the most actionable output)

Ask the user to review and correct any misunderstandings. The user knows the codebase; you don't. Trust corrections.

## What map does NOT do

- It does not propose architectural improvements (that's `architect`).
- It does not create a change manifest for code changes.
- It does not run tests.
- It does not guarantee CONTEXT.md is complete — it is a best-effort derivation. Future `verify` passes and `architect`/`triage` sessions will refine it.

## After map

Tell the user:
> "The CONTEXT.md hierarchy is ready. You can now use `architect` for new features, `triage` for bugs and small changes, or `verify` to keep the docs in sync as the code evolves."

## Reference files

- `references/context-schema.md` — CONTEXT.md fields and firmness rules
- `references/templates/CONTEXT.md.tmpl` — template
- `references/drift-control.md` — provenance and staleness model
- `references/seam-and-test-taxonomy.md` — firmness guidance
