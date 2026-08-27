# agent-toolkit

<p align="center">
  <img src="image.png" width="350" />
</p>

Adaptive idea-to-delivery skills for greenfield and brownfield software work. The toolkit helps the agent challenge and develop an idea, then carries relevant domain evidence through design, implementation, testing, independent review, and completion. It provides four skills: `ideate`, `design`, `build`, and `fix`.

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

Use `ideate` to collaboratively explore a goal and its use cases before choosing a direction, `design` for features and substantial changes, `fix` for defects that can be reproduced, and `build` after a reviewed design is ready. The managed workflow skills adapt their domain modeling and test depth to repository evidence while deliberately protecting meaningful boundaries. Storage, transport, time, identity, messaging, and external-system capabilities normally receive narrow contracts owned inward and concrete adapters outward, even with one implementation; contract-free wrappers and generic layering remain discouraged.

`ideate` is deliberately outside the managed workflow. It does not invoke the CLI or use `.agent/` assets. It brainstorms with the engineer, develops goals and concrete use cases, inspects repository evidence when useful, and constructively challenges anti-patterns, unnecessary complexity, unsafe behavior, and conflicts with the existing system. Pushback explains the consequence and offers alternatives with tradeoffs rather than rejecting unconventional ideas by default. When the engineer explicitly asks to formalize a direction in the same conversation, `design` carries the established context into its normal artifacts and lifecycle without repeating resolved questions.

`agent-toolkit init` creates the local configuration. Starting a change creates the smallest useful artifacts for either a new or existing system:

- `.agent/SYSTEM.md`: a minimal, relevant system map, bootstrapped once and refined only with durable knowledge.
- `.agent/changes/<slug>.md`: the active feature design or fix record, including source-requirement traceability, examples, boundary and abstraction decisions, expected file/module placement, risks, tests, vertical slices, and implementation-conformance evidence. Review and status bookkeeping stays in runtime state so it cannot invalidate the candidate it describes.
- `.agent/.state/`: CLI-owned lifecycle state and recorded evidence; it is added to `.gitignore` and must not be edited manually.

The lifecycle is enforced rather than inferred from prose:

1. Shape and validate the design, expected file/module placement, implementation plan, and minimal system map in one change artifact.
2. Pause for developer feedback. Requested changes return to shaping; explicit developer approval advances to independent review.
3. Send a fresh design packet to a critic for the cycle's one comprehensive discovery pass, remediate material findings when requested, then use one distinct fresh verifier context for closure retries.
4. Implement the reviewed architecture as runnable vertical slices. Each slice has an executable acceptance command and must be recorded with fresh, one-use evidence through `slice complete` before the next one begins. Before baseline sealing, each distinct command needs current executable-candidate evidence; duplicate commands and artifact-only edits do not force duplicate runs. Independent blocker audits are not part of implementation. A fix must first record an expected-failing regression test.
5. Map reviewed abstractions, dependency rules, project module constraints, and expected placement to code in `Implementation Conformance`, record passing test evidence for the current project fingerprint, then seal the implementation baseline.
6. Send the sealed result to a fresh quality critic for one comprehensive discovery pass, including omitted requirements and unimplemented reviewed abstractions. Findings require concrete contract references, candidate evidence, and observable impact. Remediate narrowly, then use one distinct verifier context for closure. Two verifier rejections enter explicit developer escalation rather than a third automatic remediation cycle; dispositions still require final verifier approval.
7. In Git repositories with commit integration enabled, inspect the commit plan and create one conventional final commit. The toolkit never pushes. In non-Git projects, or when commit integration is off, completion does not require a commit.

Review packets become stale if their reviewed content changes. Reviewer IDs are required, critic and verifier identities must differ, and closure retries reuse the first verifier identity. A critic performs the only discovery pass and reports all demonstrated material findings together; zero findings is valid. A verifier may reopen supplied findings, reject inaccurate dispositions, or report a demonstrable high-severity regression introduced by remediation, but cannot add pre-existing omissions or broaden scope. Protocol 3 findings require `contractReference`, `evidence`, and `observableImpact`; protocol 2 packets from active older workflows remain recordable. New packets provide a runtime-only `findingsPath` under `.agent/.state/`; every response must be JSON matching `outputSchema`, including `{"findings":[]}` for approval. Test attempts, including failures and timeouts, are recorded with bounded output. Tests use an executable-content fingerprint separate from review artifacts, have a configurable timeout, and are rejected if they mutate executable content. Material design drift requires `review restart --stage design`; candidate drift after critic approval or baseline sealing requires a review restart.

There is no separate plan artifact or planning ceremony. During shaping, the design skill writes both a required `File and Module Placement Plan` and the `Implementation Plan`. Placement names expected additions, modifications, moves, or deletions and their responsibilities, project constraints, boundaries, and slices. Its paths are reviewed forecasts rather than an exhaustive manifest: build may add support files or adjust paths when responsibilities, module constraints, and dependency direction remain intact, with meaningful differences explained in `Implementation Conformance`. Each required slice subsection crosses every layer needed for one observable outcome; domain-only, persistence-only, transport-only, and wiring-only phases are rejected as plans. New workflows bind each slice to a reviewed JSON-array acceptance command, sequential runtime completion, and a matching individual conformance record; aggregate claims such as “Slices 1-3 baseline” cannot seal a build. Developer feedback reviews that plan and the abstraction decisions together before independent criticism, and reviews the final remediated design again if critic changes altered it. During build, the default organization is a shallow module tree of small cohesive, independently testable concepts rather than layer-wide files or deeply nested ceremony. Logical dependency boundaries apply inside a single crate or package and cannot be replaced by a packaging decision.

Commit preparation stages and exposes the exact reviewed tree, parent, files, and message. Creation runs standard commit hooks against an isolated index and temporary worktree, rejects hook changes to the inspected tree or message, and atomically updates `HEAD` only while the inspected parent is still current.

GitHub issues are optional. Set the policy to `off` (default), `create`, or `existing`. `create` requires `agent-toolkit issue ensure`; `existing` requires `agent-toolkit issue link <number>`. GitHub-enabled modes require a Git repository and authenticated `gh` access.

## Configuration

`.agent/config.json` is created by `agent-toolkit init`:

```json
{
  "version": 1,
  "review": {
    "maxClosureRejections": 2,
    "requireFindingEvidence": true,
    "reuseVerifierContext": true
  },
  "evidence": {
    "deduplicateCommands": true,
    "timeoutMs": 1200000
  },
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

Missing `review` and `evidence` sections in existing version 1 configs receive these defaults. Closure rejection limits and evidence timeouts must be positive integers; finding evidence, verifier-context reuse, and command deduplication remain required safeguards. `completion.commit.policy` accepts `if-git` or `off`. `github.issues.policy` accepts `off`, `create`, or `existing`; `repository` may be `auto` or a GitHub repository understood by `gh`; `commitLink` accepts `closes` or `references`.

## CLI

```text
agent-toolkit install [--global] [--agent <name>...] [--all] [--copy]
agent-toolkit init
agent-toolkit start --kind feature|fix --title "..." [--issue <number>]
agent-toolkit status [--json]
agent-toolkit check
agent-toolkit advance
agent-toolkit feedback record --verdict approved|changes-requested [--note "..."...] [--notes <file>]
agent-toolkit test --kind regression|unit|integration|acceptance [--expect-fail] -- <command>
agent-toolkit slice complete --number <n>
agent-toolkit review prepare --stage design|quality --role critic|verifier
agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> --findings <packet-findingsPath>
agent-toolkit review restart --stage design|quality
agent-toolkit findings resolve <id>
agent-toolkit findings disposition <id> --outcome not-applicable|outside-contract|not-material|duplicate|deferred --reason "..."
agent-toolkit escalation record --decision continue|retry|require-proof|restart-quality|restart-design|split|stop [--reason "..."]
agent-toolkit issue ensure
agent-toolkit issue link <number>
agent-toolkit commit prepare
agent-toolkit commit create
```

Run `status` after each gate and follow its reported next action. `check` validates requirements traceability, boundary and abstraction decisions, vertical plan structure, implementation conformance when due, and the active system map; lifecycle transitions, reviews, evidence, issue association, and commits remain explicit commands.
