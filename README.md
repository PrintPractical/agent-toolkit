# agent-toolkit

<p align="center">
  <img src="image.png" width="350" />
</p>

Adaptive idea-to-delivery skills for greenfield and brownfield software work. The package exposes exactly four skills: `ideate`, `design`, `build`, and `fix`. Skills provide the conversational experience; the `agent-toolkit` CLI is the deterministic lifecycle and evidence API they operate.

## Requirements

- Node.js 20 or newer.
- Git is optional. Without it, review and evidence gates still run but commit integration is skipped.
- Authenticated `gh` access is required only when optional GitHub issue integration is enabled.

## Install

```bash
npm install --global github:PrintPractical/agent-toolkit#v2
agent-toolkit install --global
```

Installation is project-scoped unless `--global` is supplied. Repeat `--agent <name>` for targeted non-interactive installation, use project-only `--all` for every detected agent, or `--copy` instead of symlinking:

```bash
agent-toolkit install --global --agent opencode --agent claude-code
agent-toolkit install --all
```

The CLI invokes a pinned Node 20-compatible [skills.sh](https://skills.sh) installer. The direct command is `npx skills@1.4.4 add PrintPractical/agent-toolkit --all`. A local checkout can be linked with `npm install --global .`.

## Work Model

`ideate` remains conversational and independent of the CLI and `.agent/`. It develops goals and use cases, challenges unsafe or needlessly complex ideas, and hands context to `design` only when the engineer explicitly requests formal project framing or change design.

A **change** is one coherent `feature` or `fix` candidate that can share one design contract, quality review, and inspected commit. Artifact depth is proportional to applicability; there is no formal small/medium classification. A one-slice correction and a multi-slice feature use the same mandatory gates.

A **project** is a rolling container for work needing multiple independently designed, reviewed, and committed milestones. Optional epic concepts may organize the roadmap, but each executable milestone is a normal feature or fix change with the complete change lifecycle. If a milestone cannot fit one coherent contract and review, split it.

`agent-toolkit init` creates:

- `.agent/SYSTEM.md`: compact durable system knowledge, updated only from evidence.
- `.agent/projects/<slug>.md`: project outcomes, sources, requirements, constraints, decisions, provisional roadmap, coverage, discoveries, completion criteria, and final integration.
- `.agent/changes/<slug>.md`: feature design or fix diagnosis, contracts, expected placement, vertical slices, tests, and implementation conformance.
- `.agent/.state/registry.json`: registered workflows and the current selector.
- `.agent/.state/<slug>.json`: CLI-owned lifecycle, review, evidence, linkage, and commit state.

Runtime state is ignored by Git and must never be edited manually. This release intentionally does not migrate the former singleton `active` pointer or old runtime, artifact, evidence, and review packet formats.

## Project Flow

1. Optionally explore with `ideate`, or supply repository-contained PRDs, TRDs, and related sources directly to `design`.
2. `design` runs `project start`, reads every source and the repository, fingerprints rather than copies sources, resolves ambiguity with the engineer, and completes the project frame.
3. The frame receives explicit developer approval, one fresh comprehensive design critic, remediation when needed, and one distinct verifier. Approval makes the project `active`.
4. `design` selects an explicitly named milestone, a matching current milestone, or the next unblocked `active` roadmap milestone. It creates a linked normal change artifact and completes the usual design gates.
5. `build` or `fix` delivers ordered vertical slices with exact acceptance evidence. It updates `.agent/SYSTEM.md` and project coverage, discoveries, decisions, and future roadmap from delivered evidence, marks the milestone complete, and runs `project reconcile` before quality review.
6. The milestone receives a fresh quality critic and distinct verifier, then one inspected conventional commit when Git integration is active. The toolkit never pushes.
7. After all required milestones are reconciled, quality-verified, and delivered, `project finalize` freezes exact final integration commands. Current integration evidence, a project-wide quality critic, and a distinct verifier are mandatory. Project approval completes the container without creating a redundant aggregate commit.

Project framing is not predictive architecture. Concrete APIs, schemas, boundaries, and module placement emerge during milestone design. Every change identifies the closest existing capability and records whether it extends that owner or why a concrete semantic or ownership distinction requires parallel code. Binding project outcomes, constraints, source material, quality attributes, or completion criteria require renewed project design review when changed. Roadmap ordering, coverage, discoveries, hypotheses, and final integration records evolve as milestones deliver evidence.

## Standalone Flow

1. `design` shapes a feature, or `fix` diagnoses a defect and records an expected-failing automated regression before production changes.
2. The engineer explicitly reviews the complete artifact. A fresh design critic performs the cycle's one discovery pass; a distinct verifier performs closure.
3. `build` or `fix` implements only the next reviewed vertical slice. Every slice has one exact JSON-array acceptance command and one matching conformance record.
4. Current final-candidate evidence seals the baseline. A fresh quality critic reviews the candidate and one distinct verifier closes supplied findings.
5. Git completion creates only the inspected conventional commit. Non-Git and commit-off workflows complete without a commit. No command pushes.

## Workflows And Switching

Multiple unfinished workflows remain registered and listable. Starting work makes it current; `workflow select <slug>` changes only the selector. It never stashes, checks out, restores, overwrites, or otherwise manipulates project files or Git.

Selection is deliberately strict:

- Selecting the already current workflow is an idempotent no-op.
- Git selection requires a clean worktree and the exact workflow base or completion `HEAD`.
- Non-Git selection requires the executable candidate fingerprint recorded for the target workflow.
- Starting another non-Git workflow is blocked while an unfinished executable candidate differs from its parked baseline.

One checkout is therefore sequential. Use isolated worktrees or checkouts for truly concurrent implementation. The toolkit never creates or switches those environments itself. Resume by inspecting `status --json` and `workflow list --json`; skills select automatically only when intent and candidate safety are unambiguous.

In a Git repository, rolling projects require `completion.commit.policy: "if-git"` because every delivered milestone is anchored by its inspected commit. Commit integration may remain off for standalone changes and is naturally absent in non-Git repositories.

## Gates And Evidence

Review packets use protocol 3 JSON only. Every response, including approval, is written to the packet's exact runtime-only `findingsPath` as `{"findings":[]}` or structured high/medium findings with `contractReference`, `evidence`, and `observableImpact`. Critic and verifier identities must differ; closure retries reuse the verifier identity. A verifier can only reopen supplied findings, reject inaccurate dispositions, or report a demonstrated high-severity regression introduced by remediation. Two closure rejections require explicit developer escalation, and dispositions still require verifier approval.

Tests record bounded output, timeout and mutation status, exact command, and executable fingerprint. A newer failure invalidates an older pass for that command. Commands that mutate executable or reviewed candidate content are rejected. Artifact-only reconciliation preserves executable evidence, while executable changes require current reruns. Baselines and reviews fingerprint the appropriate complete candidate; material contract drift requires design restart.

Commit preparation exposes the exact reviewed tree, parent, files, and message. Commit hooks run against an isolated index and temporary worktree. Tree, message, worktree, or parent drift is rejected before `HEAD` is atomically updated.

## Configuration

`.agent/config.json` controls required issue integration, evidence timeout, bounded verifier closure, and optional commit creation. Safeguards cannot be disabled. Defaults are Git-conditional commits and no GitHub issue:

```json
{
  "version": 1,
  "review": { "maxClosureRejections": 2, "requireFindingEvidence": true, "reuseVerifierContext": true },
  "evidence": { "deduplicateCommands": true, "timeoutMs": 1200000 },
  "completion": { "commit": { "policy": "if-git", "conventional": true, "dirtyWorktree": "block" } },
  "github": { "issues": { "policy": "off", "repository": "auto", "commitLink": "closes", "labels": [] } }
}
```

GitHub issue policy accepts `off`, `create`, or `existing`. `create` uses `issue ensure`; `existing` uses `issue link <number>`. Commit policy accepts `if-git` or `off`.

## CLI

```text
agent-toolkit install [--global] [--agent <name>...] [--all] [--copy]
agent-toolkit init
agent-toolkit project start --title "..." [--source <path>...]
agent-toolkit project reconcile
agent-toolkit project finalize
agent-toolkit start --kind feature|fix --title "..." [--project <slug> --milestone <number>] [--issue <number>]
agent-toolkit workflow list [--json]
agent-toolkit workflow select <slug>
agent-toolkit status [--json]
agent-toolkit check
agent-toolkit advance
agent-toolkit feedback record --verdict approved|changes-requested [--note "..."...] [--notes <file>]
agent-toolkit test --kind regression|unit|integration|acceptance [--expect-fail] -- <command>
agent-toolkit slice complete --number <n>
agent-toolkit review prepare --stage design|quality --role critic|verifier
agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> --findings <findingsPath>
agent-toolkit review restart --stage design|quality
agent-toolkit findings resolve <id>
agent-toolkit findings disposition <id> --outcome not-applicable|outside-contract|not-material|duplicate|deferred --reason "..."
agent-toolkit escalation record --decision continue|retry|require-proof|restart-quality|restart-design|split|stop [--reason "..."]
agent-toolkit issue ensure|link
agent-toolkit commit prepare|create
```

Run `status` after each gate and follow its exact next action.
