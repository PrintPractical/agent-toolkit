# Bounded Adversarial Review

This policy defines the formal review cycle for architecture (`AV-*`), specification (`SV-*`), and implementation/refactor (`RV-*`). Triage is deliberately excluded: it uses a lightweight challenge and self-check without formal findings, reviewer roles, or `review-log.mjs`.

## Review depth

Review deeply wherever applicable across:

- Data and state ownership, lifecycle, invariants, persistence, and concurrency
- Data structures and representation choices
- Interfaces, traits, protocols, and dependency direction
- Errors, recovery, cancellation, and failure observability
- Security, privacy, trust boundaries, and abuse cases
- Logs, metrics, traces, diagnostics, and operational response
- Simplicity and avoidable complexity
- Maintainability, cohesion, coupling, testability, and change cost
- Language idioms, using every applicable idiom pack

Applicability follows the scope and evidence. Do not require an `N/A` row, checklist recital, or boilerplate for dimensions that genuinely do not apply. A clean review gives a brief evidence-based rationale.

## Finding contract

Only findings that can block approval or materially improve the artifact/work enter the cycle. Do not emit nits or low-severity findings.

| Field | Allowed / required value |
|---|---|
| ID | Stable `AV-NNN`, `SV-NNN`, or `RV-NNN`; never renumber or reuse |
| Severity | `blocker` or `major` |
| Category | `correctness`, `security`, `simplicity`, `maintainability`, or `idioms` |
| Evidence | Concrete artifact section or `file[:line]` |
| Impact | Specific failure, risk, cost, or ambiguity if left unchanged |
| Alternative | Concrete safer or simpler direction, not generic advice |
| Status | `open` or `resolved` |

`blocker` means approval or safe execution cannot continue. `major` means the proposal/work is viable but carries a material defect or avoidable cost. Every recorded finding must resolve before the gate; move work that cannot be resolved within the bounded cycle to an explicit upstream kickback instead of deferring it inside the cycle.

## The bounded cycle

Each architecture session, each standard or epic specify session, and each completed implementation/refactor execution gets exactly this cycle:

1. **Broad discovery, once.** Inspect the complete agreed scope in one pass. Parallel lenses are allowed, but they are one coordinated pass and feed one result.
2. **Consolidated findings, once.** Deduplicate and present one complete batch of all `blocker` and `major` findings. Assign stable IDs. Do not drip findings across conversations.
3. **Remediation, once.** Resolve the complete batch together. User confirmation is required only at the materiality boundary in `challenge-protocol.md`; local/private/reversible conventional choices are selected automatically.
4. **Focused verification.** Verify only the original IDs against the remediated artifact or diff. Do not repeat broad discovery, expand scope, or introduce new low/major findings. The sole new-ID exception is a blocker regression caused by remediation: record it with the stage prefix through `--regression`, correct it within the same focused scope, then close it through `--regression-resolution` during the one targeted reverification.
5. **One targeted correction, maximum.** If verification shows an original ID is unresolved or records a remediation-caused blocker regression, allow one correction limited to those IDs and one focused reverification. If any ID remains unresolved, or safe approval would require new broad investigation, stop and return to the appropriate upstream stage rather than extending the cycle.

The cycle therefore permits at most one broad pass, one finding batch, one remediation, one verification, and one targeted correction/reverification. Verification is closure, not a second review.

## Records by stage

Every formal cycle uses structured version-2 entries in `reviews.json` through `review-log.mjs`. The artifact records the same cycle name, findings, remediation, and verification evidence so humans can read the decision trail.

- `architect`: use cycle `architect-1`; record `AV-*` findings under `Validity Check Results`.
- `specify`, standard and epic: use cycle `specify-1`; record `SV-*` findings under `Dry-Run Findings`.
- `implement`: use cycle `implement-1`; record `RV-*` findings in the plan review section.
- Refactor execution: use cycle `refactor-1`; record `RV-*` findings in `refactor.md`.

The recording CLI permits one discovery auditor and at most two verifier entries in a cycle. Verifiers use `--resolution` for original IDs, `--regression` only for a blocker regression introduced by remediation, and `--regression-resolution` to close it. Historical version-1 records remain readable, but all new records use the fixed named structured cycle.

Apply the cross-language review criteria in `engineering-fundamentals.md` together with every applicable language idiom pack.

Opportunity IDs such as `RF-*`, acceptance criteria, decisions, and seams are not review finding IDs.
