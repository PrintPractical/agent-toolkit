# agent-toolkit — Authoring Conventions

This document is for contributors adding or modifying skills, shared refs, templates, idioms packs, or scripts.

## Repo layout

```
AgentToolkit/
  _shared/          Canonical shared references (authored once; synced into skills)
  _templates/       Canonical asset templates (synced into skills)
  _idioms/          Language idioms packs: rust.md, c.md, cpp.md
  packages/build/   Canonical scripts + lib/ + build tooling (sync-shared.mjs) + __tests__/
  skills/           One folder per skill
    <name>/
      SKILL.md      REQUIRED. Frontmatter: name, description
      scripts/      SYNCED copies of packages/build scripts + lib (do not hand-edit)
      references/   SYNCED copies + skill-specific docs (do not hand-edit synced files)
```

## Shared assets

**Author in `_shared/`, `_templates/`, or `_idioms/` only.** Never edit the copies inside `skills/*/references/` by hand — they are overwritten by `npm run build`.

To add a new shared file, add it to `_shared/` (or `_templates/` / `_idioms/`), then update `packages/build/sync-shared.mjs` to specify which skills receive it.

## SKILL.md rules

- `name`: lowercase hyphen-separated, ≤64 chars, matches folder name.
- `description`: required. Embed trigger keywords. Third person. Cover what AND when. Gate narrow skills with "Use ONLY when...". Skills without a description are never surfaced.
- Keep SKILL.md under 500 lines. Move detailed reference material to `references/`.
- Progressive disclosure: only `name` + `description` load at agent startup. Full SKILL.md loads when relevant. Supporting files load on demand.
- Prefer scripts over inline code blocks — script execution output consumes context; the script file itself does not.

## Scripts

**Canonical source of truth:** `packages/build/*.mjs` (the scripts) and `packages/build/lib/index.mjs` (shared lib). Author them here.

- Scripts import the shared lib via `./lib/index.mjs`. This path resolves identically in the dev repo (`packages/build/`) and in an installed skill (`skills/<name>/scripts/`).
- `npm run build` (sync-shared) bundles every script + `lib/` into each `skills/<name>/scripts/` directory. **Do not hand-edit the copies under `skills/*/scripts/`** — they are overwritten by the build.
- SKILL.md invokes scripts as `node "$SKILL_DIR/scripts/<script>.mjs"` where `$SKILL_DIR` is the skill's install directory. Never reference `packages/build/` from a SKILL.md — that path does not exist in an installed skill.
- Shebang: `#!/usr/bin/env node`
- Status/progress → `stderr`. Machine-readable JSON output → `stdout`.
- Scripts must locate templates/siblings relative to `import.meta.url` with a fallback for both dev and installed layouts (see `context-scaffold.mjs`).
- Register cleanup traps for any temp files.
- Every script must have a corresponding unit test in `packages/build/__tests__/`.

## Manifest state machine

```
stages:   architect → specify → plan → implement → done
gates:    architect | specify | plan | implement | docs
```

- No skill auto-advances past a gate without `approved` status.
- Each spine skill self-checks the prior gate before proceeding.
- `change-status.mjs` prints current stage + recommended next skill.

## Kickback types

- `defect`: the upstream spec should have caught this. Counts against kickback frequency.
- `amendment`: legitimate external/requirement change. Does not count against frequency.

## Firmness semantics

- Default seam firmness: `soft`.
- `firm` is earned: user argues the case, agent challenges, justification recorded inline.
- Firm ≠ frozen. Use the firm-change protocol (see `_shared/firm-change-protocol.md`) to change a firm item.
- The agent challenges any proposed `firm` designation until justified.

## Test taxonomy (seam-firmness → test durability)

- Tests at firm seams = safety net. Never edited to make a refactor pass.
- Tests at soft seams = disposable. Expected to churn with structural change.
- `plan` labels every test task with its seam's firmness.
- `implement` enforces the tripwire: firm-seam test failure during refactor = kickback, not a test edit.

## CONTEXT.md provenance

Every CONTEXT.md includes a `Provenance:` footer with `validated-at: <sha>`.
Run `context-verify.mjs` to check staleness and run firm-seam tests.
CI: firm-seam test failure = hard block. Soft-prose staleness = warning + `Context-Reviewed:` PR trailer ack.

## Adding an idioms pack

1. Create `_idioms/<lang>.md` following the structure of existing packs (power-checklist + smell-list).
2. Add it to `packages/build/sync-shared.mjs` for the skills that use it (`architect`, `specify`, `implement`).
3. Update `README.md` to list the new language.
4. `manifest.language` value should match the filename stem (e.g. `rust`, `c`, `cpp`).

## skills.sh.json

Groupings must match skill folder names exactly. Update when adding a skill.

## CI

- `npm run build` (sync-shared) must pass with no drift.
- `npm test` must pass.
- PRs that change a firm-seam test must include a `Firm-Change: <seam-id>` trailer.
- PRs with stale CONTEXT.md (per `context-verify --all`) must include a `Context-Reviewed: <path>` trailer.
