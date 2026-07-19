# Firm-Change Protocol

Firm seams, contracts, and decisions are **protected, not frozen**. This protocol governs how they change intentionally — safely, with full propagation and no dangling references.

## When this protocol applies

Any proposal to:
- Remove or weaken a `firm` seam designation
- Change a firm interface/contract
- Remove or modify a firm acceptance criterion
- Contradict a recorded firm decision in `decisions.md`
- Modify or delete a firm-seam test

## The protocol

### Step 1: Surface and deliberate

Raise the proposed change as a first-class decision. Do not make it quietly.

The agent challenges the proposal (challenge-protocol applies):
- Why does this firm thing need to change?
- Is this a requirement evolution (amendment) or was the original decision wrong (defect)?
- Have you considered the blast radius?

The user may override the agent's challenge. Override is respected. Record the decision.

### Step 2: Classify the kickback type

- **`defect`**: The original firm decision was wrong. Counts against kickback frequency.
- **`amendment`**: Requirements or context legitimately changed. Does not count against kickback frequency.

Log the kickback entry in `manifest.yaml` before proceeding.

### Step 3: Enumerate blast radius

Before changing anything, enumerate all dependents:

```bash
# Find all references to the seam ID
grep -r "SEAM-<id>" .

# Find all references to the interface symbol/type/endpoint
grep -r "<symbol>" src/
```

Blast radius includes:
- Other CONTEXT.md files that reference this seam or interface
- Code that implements or calls the interface
- Tests that enforce the firm seam (these will need deliberate update)
- Downstream firm decisions in `decisions.md` that assumed this contract
- `plan.md` tasks that were scoped to the original contract

The agent must produce an explicit list before any files are touched.

### Step 4: Create propagation tasks

Add explicit tasks to `plan.md` covering every item in the blast radius:
- Update the contract definition
- Update implementing code
- Update callers
- Update the firm-seam test (this is the deliberate, approved update)
- Update affected CONTEXT.md files
- Update dependent decisions in `decisions.md`
- Re-run `context-verify.mjs` after propagation

Propagation is not done until all dependents are consistent.

### Step 5: Implement propagation

Follow the normal `implement` flow for the propagation tasks. The firm-seam test update is a deliberate, authorized change — it carries a `Firm-Change: <seam-id>` marker in the PR/commit.

### Step 6: Verify

After propagation:
1. Run the updated firm-seam test — must pass green.
2. Run `context-verify.mjs` — must report no dangling references to the old contract.
3. Verifier subagent confirms no orphaned seam IDs in CONTEXT.md files.

### Step 7: Record

In `decisions.md`, add a section:
```
## Firm Change: [SEAM-<id>] <seam-name>
Type: defect | amendment
Justification: <one sentence>
Old contract: <summary>
New contract: <summary>
Blast radius: <list>
```

In CONTEXT.md, update the firm seam entry with the new justification.

## What is NOT allowed

- Silently editing a firm-seam test without this protocol. CI will block it without a `Firm-Change:` trailer.
- Removing a firm seam's `enforced-by` citation without running the verify step.
- Changing a firm contract piecemeal (updating code but not tests, or updating tests but not CONTEXT.md).
- Letting `implement` trigger this protocol without kicking back to `specify` first. `implement` makes no decisions — it stops and escalates.

## PR convention

PRs that change a firm-seam test must include a trailer:
```
Firm-Change: SEAM-gw-rl-01
```

CI checks for this trailer when a diff touches a file containing a firm-seam test marker. Without it, the PR is blocked.
