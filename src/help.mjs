const help = {
  main: `agent-toolkit - adaptive design-to-delivery workflow gates

Usage: agent-toolkit <command> [options]

Commands:
  install    Install the bundled design, build, and fix skills
  init       Initialize .agent configuration in the current project
  start      Start a feature or fix workflow
  status     Show the active phase and exact next action
  check      Validate the active design and system map
  advance    Move through the next objective lifecycle gate
  feedback   Record developer approval or requested design changes
  test       Run a command and record fingerprinted test evidence
  slice      Record sequential completion of a reviewed implementation slice
  review     Prepare, record, or restart independent reviews
  findings   Resolve a remediated review finding
  issue      Create or link an optional GitHub issue
  commit     Prepare or create the exact reviewed commit
  help       Show this help or help for one command

Run agent-toolkit help <command> or agent-toolkit <command> --help for details.`,
  install: `Usage: agent-toolkit install [--global] [--agent <name>...] [--all] [--copy]

Installs bundled skills through skills.sh. The default is an interactive project install.
  --global        Install for the current user
  --agent <name>  Target an agent; repeat for multiple agents
  --all           Install for every agent in the project; cannot be global
  --copy          Copy skill files instead of symlinking`,
  init: `Usage: agent-toolkit init

Creates .agent/config.json, artifact directories, runtime state, and the .gitignore entry.`,
  start: `Usage: agent-toolkit start --kind feature|fix --title "..." [--issue <number>]

Starts one active change and creates its design artifact and minimum system map.
  --kind   Required workflow kind
  --title  Required human-readable change title
  --issue  Existing issue number; requires GitHub policy create or existing`,
  status: `Usage: agent-toolkit status [--json]

Shows the active change, lifecycle phase, artifacts, review state, and next command.`,
  check: `Usage: agent-toolkit check

Validates artifact presence, requirements traceability, boundary and abstraction decisions, vertical implementation slices, implementation conformance when due, the system map, and closed questions.`,
  advance: `Usage: agent-toolkit advance

Advances one lifecycle gate when its objective requirements are satisfied.`,
  feedback: `Usage: agent-toolkit feedback record --verdict approved|changes-requested [--note "..."] [--notes <file>]

Records the developer's response to the completed design and implementation plan before critic review.
  approved          Accept the current artifacts for independent design review
  changes-requested Return to shaping; requires repeatable --note text or a text/JSON notes file`,
  test: `Usage: agent-toolkit test --kind regression|unit|integration|acceptance [--expect-fail] -- <command> [args...]

Runs the command and records its result against the unchanged project candidate.
  --kind         Required evidence kind
  --expect-fail  Require and record a failing command, normally for pre-fix regression proof
  --             Separates toolkit options from the test command`,
  slice: `Usage: agent-toolkit slice complete --number <n>

Records one reviewed slice as complete. Slices must be completed in order, their one-to-one Implementation Conformance record must be present, and the current candidate must have passing acceptance evidence from the exact command reviewed in the plan.`,
  review: `Usage:
  agent-toolkit review prepare --stage design|quality --role critic|verifier
  agent-toolkit review record --packet <id> --verdict approved|changes-requested --reviewer <id> --findings <packet-findingsPath>
  agent-toolkit review restart --stage design|quality

Critic and verifier must be fresh, distinct reviewers. The critic performs one comprehensive discovery pass. The verifier only checks supplied findings and high-severity regressions introduced by remediation; it is not a second critic. Every response, including approval, must be JSON matching outputSchema saved to the packet's exact runtime-only findingsPath.`,
  findings: `Usage: agent-toolkit findings resolve <id>

Marks one review finding resolved after its remediation is complete.`,
  issue: `Usage:
  agent-toolkit issue ensure
  agent-toolkit issue link <number>

Creates an idempotent issue or links an existing issue when configured in .agent/config.json.`,
  commit: `Usage:
  agent-toolkit commit prepare
  agent-toolkit commit create

Stages and exposes the exact reviewed commit candidate, then creates only that conventional commit. Never pushes.`,
  help: `Usage:
  agent-toolkit help [command]
  agent-toolkit <command> --help

Shows top-level help or detailed usage and options for one command.`
};

export function helpText(command) {
  const key = command || "main";
  if (!help[key]) throw new Error(`Unknown help topic: ${command}`);
  return help[key];
}
