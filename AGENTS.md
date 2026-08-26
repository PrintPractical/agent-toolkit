# Contributor Guide

## Scope

- Keep the package focused on the four public skills: `ideate`, `design`, `build`, and `fix`.
- Keep `ideate` independent of the CLI and `.agent/` assets; it may hand conversational context to `design` only when the engineer explicitly requests the managed workflow.
- Treat the CLI state machine as the source of truth. Skills and documentation must match behavior in `bin/` and `src/`.
- Keep workflow artifacts compact, evidence-based, and useful for both greenfield and brownfield repositories.
- Preserve mandatory fresh critic and distinct verifier gates; do not add self-approval or gate-bypass paths.
- Preserve non-Git operation and keep GitHub integration optional.
- Never add push behavior. Git completion may create only the inspected conventional commit.

## Changes

- Use Node.js 20 or newer and ESM.
- Prefer the smallest direct implementation; avoid speculative abstractions and compatibility code without a concrete consumer.
- Keep `skills/<name>/SKILL.md` frontmatter names aligned with their directories.
- Keep templates and user-facing examples ASCII.
- Add or update tests for lifecycle, configuration, artifact, evidence, review, Git, or GitHub behavior changes.
- Do not manually edit generated runtime data under `.agent/.state/`.

## Verification

Run before submitting:

```bash
npm test
npm run verify
```

`npm run verify` runs the tests and checks the npm package contents with `npm pack --dry-run`.
