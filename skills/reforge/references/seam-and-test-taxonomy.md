# Seam-Firmness → Test Durability

This document defines the test taxonomy used throughout the toolkit. Every test pins a seam. The seam's firmness determines the test's expected lifespan and what happens when the test fails during a refactor.

## The model

```
seam firmness → test durability
─────────────────────────────────────────────────────
firm seam     → safety-net test    (never edited to pass a refactor)
soft seam     → disposable test    (expected to churn with structural change)
```

Tests are not typed independently. The seam decides everything.

## Firm-seam tests (safety net)

A firm-seam test asserts a contract. It tests *what the system does*, not how it does it. A true refactor does not change observable behavior, so firm-seam tests must survive any refactor unchanged.

**Rules for firm-seam tests:**
- Written before implementation (red-green discipline).
- Located at the level of the seam they pin (integration, system, or behavioral — not unit internals).
- Never modified to make a refactor pass. A failing firm-seam test during a refactor is not a test problem — it is evidence that the refactor changed behavior, which means it is not a pure refactor. **This triggers a kickback, not a test edit.**
- Carry the seam ID in a comment: `// [SEAM-gw-rl-01]`.
- Cited in CONTEXT.md under `enforced-by`.

**Green baseline rule:** Before any refactor begins, all firm-seam tests must be green. A refactor without a green baseline has no safety net.

## Soft-seam tests (disposable)

A soft-seam test is coupled to implementation structure. It tests internal units, private functions, specific data layouts. When structure changes, these tests change too. That is not a failure — it is expected.

**Rules for soft-seam tests:**
- Written alongside implementation.
- May be rewritten or deleted during a refactor cycle. No approval needed.
- Should NOT be written for trivial getter/setter mechanics — only for non-trivial logic.
- Do NOT cite seam IDs (they don't pin a contract).

## Practical guidance for `plan`

`plan` labels every test task with its seam's firmness. The label appears in the checklist:

```
- [ ] Write tests for rate-limit enforcement [seam: gateway/rate-limit, firmness: firm]
- [ ] Write unit tests for token-bucket internals [seam: internal, firmness: soft]
```

A plan must contain at least one firm-seam test task per firm seam in the acceptance criteria. CI will verify this check.

## Practical guidance for `implement`

For each implementation section:
1. Identify which seams are touched. Check `architecture.md` for firmness.
2. If any touched seam is firm: write the firm-seam test first. Must be green before continuing.
3. Implement to pass tests.
4. Run refactor cycle. Firm-seam tests must remain green throughout.
5. Rewrite soft-seam tests to match the refactored structure.

**The tripwire:** `implement` treats any firm-seam test modification as an automatic kickback signal. The implementer must STOP, explain why the firm contract changed, and kick back to `specify` (as an amendment or defect, as appropriate). The implementer never changes a firm-seam test unilaterally.

## Fast-changing systems and early greenfield

New systems have few firm seams. That is correct — firmness must be earned, and earning requires stability evidence. In early greenfield:
- Expect all or nearly all seams to be soft.
- Tests churn frequently. That is normal and expected.
- As the system stabilizes and key contracts emerge, graduate soft seams to firm with justification.
- Firm seam density increases over time: early = thin net, mature = thick net.

Forcing firmness early to gain "test coverage" is an anti-pattern. It creates brittle tests that fight refactoring — exactly the opposite of the goal.

## Behavioral/integration tests and changing internals

Behavioral tests (firm-seam level) test the *interface*, not internals. Internal structure can change completely without touching them. This is the distinction:

- "Rate limit returns 429 when tokens exhausted" → behavioral, firm, stable across any token-bucket implementation.
- "TokenBucket.consume() decrements count by N" → internal, soft, changes if the algorithm changes.

The toolkit prefers behavioral assertions for firm seams and tolerates structural assertions only at soft seams.
