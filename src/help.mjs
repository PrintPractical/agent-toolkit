const help = {
  main: `agent-toolkit - adaptive design-to-delivery workflow gates

Usage: agent-toolkit <command> [options]

Commands:
  install    Install the bundled ideate, design, build, and fix skills
  init       Initialize .agent configuration in the current project
  project    Start, reconcile, or finalize a rolling project
  start      Start a standalone or project milestone change
  workflow   List or safely select registered workflows
  status     Show the current phase and exact next action
  check      Validate the current project or change artifacts
  advance    Move through the next objective lifecycle gate
  feedback   Record developer approval or requested design changes
  test       Run a command and record fingerprinted test evidence
  slice      Record sequential completion of a reviewed implementation slice
  review     Prepare, record, or restart independent reviews
  findings   Resolve or disposition a review finding
  escalation Record a developer decision after bounded closure review
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
  project: `Usage:
  agent-toolkit project start --title "..." [--source <path>...]
  agent-toolkit project reconcile
  agent-toolkit project finalize

Starts reviewed project framing, reconciles a completed implementation into its project before quality review, or begins final project integration after every milestone is delivered. Source files must be inside the repository and are fingerprinted rather than copied.`,
  start: `Usage: agent-toolkit start --kind feature|fix --title "..." [--project <slug> --milestone <number>] [--issue <number>]

Starts a standalone change or one active roadmap milestone and creates its design artifact and minimum system map.
  --kind   Required workflow kind
  --title  Required human-readable change title
  --project Reviewed project slug for milestone work
  --milestone Active roadmap milestone number; requires --project
  --issue  Existing issue number; requires GitHub policy create or existing`,
  workflow: `Usage:
  agent-toolkit workflow list [--json]
  agent-toolkit workflow select <slug>

Lists registered workflows or changes only the current selector after candidate-safety checks. Selection never checks out, stashes, restores, or otherwise manipulates project files or Git.`,
  status: `Usage: agent-toolkit status [--json]

Shows the current project or change, lifecycle phase, artifacts, review state, and next command. With no current workflow, reports how to start one.`,
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

The critic performs one comprehensive discovery pass in a fresh context. One distinct verifier context checks only supplied findings, developer dispositions, and high-severity regressions introduced by remediation, and that verifier context is reused for closure retries. After the configured rejection limit, the workflow requires explicit developer escalation. Every response, including zero-finding approval, must be JSON matching outputSchema saved to the packet's exact runtime-only findingsPath.`,
  findings: `Usage:
  agent-toolkit findings resolve <id>
  agent-toolkit findings disposition <id> --outcome not-applicable|outside-contract|not-material|duplicate|deferred --reason "..." [--duplicate-of <id>] [--follow-up <reference>]

Marks a remediated finding resolved, or records a reasoned developer disposition during review escalation. Dispositions remain pending until the cycle's verifier confirms them.`,
  escalation: `Usage: agent-toolkit escalation record --decision continue|retry|require-proof|restart-quality|restart-design|split|stop [--reason "..."]

Records the developer's explicit decision after bounded verifier closure. Continue requires every finding resolved or dispositioned and still requires final verifier approval. Retry authorizes one additional focused remediation attempt; it does not start another critic.`,
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
