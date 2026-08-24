# agent-toolkit

<p align="center">
  <img src="image.png" width="350" />
</p>

Adaptive domain-to-delivery skills for greenfield and brownfield software work. The toolkit keeps the agent focused on the domain evidence relevant to the change, then carries that evidence through design, implementation, testing, independent review, and completion. It provides only three skills: `design`, `build`, and `fix`.

## Requirements

- Node.js 20 or newer for the `agent-toolkit` CLI.
- Git is optional. Without it, the lifecycle still runs but commit integration is skipped.
- `gh` authenticated to GitHub is required only when GitHub issue integration is enabled.

## Install

Install the CLI, then let it install its bundled skills. Installation is project-scoped by default; use `--global` to make the skills available across projects:

```bash
npm install --global github:PrintPractical/agent-toolkit#v2
agent-toolkit install --global
```

`agent-toolkit install` invokes a pinned Node 20-compatible release of the standard [skills.sh](https://skills.sh) installer so it can detect and use the correct paths for supported agents. Use repeatable `--agent <name>` flags for a non-interactive targeted install, project-only `--all` for every agent, or `--copy` to copy instead of symlink:

```bash
agent-toolkit install --global --agent opencode --agent claude-code
agent-toolkit install --all
```

The direct skills.sh command remains available: `npx skills@1.4.4 add PrintPractical/agent-toolkit --all`. From a local checkout, the CLI can also be linked globally with `npm install --global .`.

## Workflow

Use `design` for features and substantial changes, `fix` for defects that can be reproduced, and `build` after a reviewed design is ready. Each skill adapts its domain modeling, boundaries, contracts, and test depth to the evidence in the repository rather than requiring a fixed architecture.

`agent-toolkit init` creates the local configuration. Starting a change creates the smallest useful artifacts for either a new or existing system:

- `.agent/SYSTEM.md`: a minimal, relevant system map, bootstrapped once and refined only with durable knowledge.
- `.agent/changes/<slug>.md`: the active feature design or fix record, including examples, decisions, risks, slices, and test strategy. Review and status bookkeeping stays in runtime state so it cannot invalidate the candidate it describes.
- `.agent/.state/`: CLI-owned lifecycle state and recorded evidence; it is added to `.gitignore` and must not be edited manually.

The lifecycle is enforced rather than inferred from prose:

1. Shape and validate the change artifact and minimal system map.
2. Send a fresh design packet to a critic, remediate material findings when requested, then use a distinct fresh verifier.
3. Implement reviewed vertical slices. A fix must first record an expected-failing regression test.
4. Record passing test evidence for the current project fingerprint, then seal the implementation baseline.
5. Send the sealed result to a fresh quality critic, remediate and retest when needed, then use a distinct fresh verifier on the final result.
6. In Git repositories with commit integration enabled, inspect the plan and create one conventional final commit. The toolkit never pushes. In non-Git projects, or when commit integration is off, completion does not require a commit.

Review packets become stale if their reviewed content changes. Reviewer IDs are required, and critic and verifier identities must differ; the skills require separate fresh contexts rather than self-approval. Test evidence records the command, kind (`regression`, `unit`, or `integration`), result, bounded output, timestamp, and project fingerprint; commands that mutate the candidate are rejected. Material design drift requires `review restart --stage design`. Candidate drift after critic approval or baseline sealing requires `review restart --stage design|quality` so a fresh critic sees the replacement candidate.

Commit preparation stages and exposes the exact reviewed tree, parent, files, and message. Creation runs standard commit hooks against an isolated index and temporary worktree, rejects hook changes to the inspected tree or message, and atomically updates `HEAD` only while the inspected parent is still current.

GitHub issues are optional. Set the policy to `off` (default), `create`, or `existing`. `create` requires `agent-toolkit issue ensure`; `existing` requires `agent-toolkit issue link <number>`. GitHub-enabled modes require a Git repository and authenticated `gh` access.

## Configuration

`.agent/config.json` is created by `agent-toolkit init`:

```json
{
  "version": 1,
  "completion": {
    "commit": {
      "policy": "if-git",
      "conventional": true,
      "dirtyWorktree": "block"
    }
  },
  "github": {
    "issues": {
      "policy": "off",
      "repository": "auto",
      "commitLink": "closes",
      "labels": []
    }
  }
}
```

`completion.commit.policy` accepts `if-git` or `off`. `github.issues.policy` accepts `off`, `create`, or `existing`; `repository` may be `auto` or a GitHub repository understood by `gh`; `commitLink` accepts `closes` or `references`.

## CLI

```text
agent-toolkit install [--global] [--agent <name>...] [--all] [--copy]
agent-toolkit init
agent-toolkit start --kind feature|fix --title "..." [--issue <number>]
agent-toolkit status [--json]
agent-toolkit check
agent-toolkit advance
agent-toolkit test --kind regression|unit|integration [--expect-fail] -- <command>
agent-toolkit review prepare --stage design|quality --role critic|verifier
agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> [--findings <file>]
agent-toolkit review restart --stage design|quality
agent-toolkit findings resolve <id>
agent-toolkit issue ensure
agent-toolkit issue link <number>
agent-toolkit commit prepare
agent-toolkit commit create
```

Run `status` after each gate and follow its reported next action. `check` validates the active artifacts; lifecycle transitions, reviews, evidence, issue association, and commits remain explicit commands.
