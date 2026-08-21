---
name: epic
description: Use ONLY when an epic is decomposed, every child is archive-ready, and the parent needs documentation reconciliation, docs approval, and coordinated archival.
---

# Epic Completion

Set `SKILL_DIR` to this skill's absolute install directory and run all commands from the project root.

Run this only for an epic at `phase: decomposed` after every child is `archive-ready`. Do not run plan or implement for the parent.

1. Read the parent architecture, decisions, all child manifests, child completion evidence, and every `manifest.context_targets` CONTEXT.md.
2. Write `epic-docs.md` from `references/templates/epic-docs.md.tmpl`. Reconcile the parent context hierarchy with the delivered child outcomes.
3. Run `context-verify.mjs --path <target> --run-tests` for each target. In a Git repository, commit the reconciled scope, then update only each final CONTEXT.md provenance footer with that commit's full HEAD SHA before approval. Outside Git, retain `<not-in-git-repo>` provenance.
4. Have a fresh independent reviewer compare `epic-docs.md`, the parent contexts, child outcomes, and the current repository. Record the reviewer label, approved verdict, and concrete evidence in `epic-docs.md`.
5. Ask for explicit docs approval, record the response verbatim, then run:

```bash
node "$SKILL_DIR/scripts/manifest-approval.mjs" --id <id> --approval docs --approve
node "$SKILL_DIR/scripts/change-archive.mjs" --id <id>
```

The archive command coordinates the parent and every child. A child must never be archived or cancelled independently.
