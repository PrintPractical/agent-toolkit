# C Idioms Pack

## Applicability

Use this guidance when designing, specifying, implementing, reviewing, triaging, or reforging C code. The project's C standard, compiler and warning policy, target ABI/OS, embedded or freestanding constraints, allocation policy, coding standard, and compatibility requirements take precedence.

- **MUST** marks correctness, defined behavior, memory/thread safety, or an explicit project/ABI contract.
- **PREFER** marks the disciplined default; depart when measured constraints or established project conventions justify it.
- **CONSIDER** marks a contextual technique that depends on platform, lifetime, performance, or toolchain support.

## Core principle

**Make bounds, ownership, lifetimes, error states, and cleanup mechanically visible.** C provides few guardrails, so interfaces and control flow must carry the contracts that stronger type systems would otherwise enforce.

## Power Checklist

### Interfaces and Ownership

- [ ] **MUST document ownership for every pointer-bearing API.** State whether inputs are borrowed, outputs are caller-owned, ownership transfers, aliases remain valid, and which function releases a resource.
- [ ] **MUST pair buffers with capacities and produced/consumed lengths.** Define whether lengths include a terminator and whether partial output is possible.
- [ ] **MUST keep pointers within the lifetime and bounds of their object.** Returning stack addresses, retaining expired borrows, invalid pointer arithmetic, and misaligned access are defects.
- [ ] **PREFER opaque structs and narrow headers when representation is not part of the ABI.** Expose data directly when it is intentionally a stable interchange or hardware-facing layout.
- [ ] **PREFER `const` for pointees not modified through an interface.** Remember that it does not imply immutability through aliases or thread safety.
- [ ] **CONSIDER `restrict` only for a documented, proven non-aliasing contract over the relevant accesses.** Violating that caller contract causes undefined behavior; do not add it as a generic optimization hint.

### Sizes and Memory

- [ ] **MUST check size arithmetic before allocation, indexing, or byte-count conversion.** Guard multiplication and addition against `SIZE_MAX`, and reject values not representable in the destination type.
- [ ] **MUST preserve the original pointer across `realloc` failure.** Assign to a temporary, define zero-size behavior, and update ownership only on success.
- [ ] **MUST initialize every object before any read.** Prefer complete designated initializers or `{0}` where semantic zero initialization is appropriate; do not confuse initialization with raw `memset` or mask missing fields with unnecessary blanket clearing.
- [ ] **PREFER `size_t` for object sizes and counts, and `ptrdiff_t` for pointer differences.** Use fixed-width integers such as `uint32_t` when exact width is part of a wire format, file format, hardware register, ABI, or persisted-data contract, not as a blanket replacement for native integer types.
- [ ] **PREFER stack storage for bounded, suitably sized local lifetimes and heap storage when size or lifetime requires it.** Account for stack limits, VLAs, alignment, and allocator policy.
- [ ] **CONSIDER setting a pointer to `NULL` after `free` when that specific variable remains live and may be reused or cleaned up again.** It does not invalidate aliases and is unnecessary when the variable immediately leaves scope.

### Strings and Byte Operations

- [ ] **MUST never use `gets`, and must prove bounds for every copy, append, and format operation.** Check truncation and required-size semantics explicitly.
- [ ] **PREFER length-aware designs.** Use `snprintf` for formatting (checking negative and `>= capacity` results), or validated lengths plus `memcpy` when exact byte copying is intended.
- [ ] **Do not recommend `strncpy` or `strncat` as generally safe replacements.** `strncpy` may omit termination and pad the destination; `strncat`'s count is not destination capacity. Use them only when their exact semantics are required and all bounds/termination invariants are proven.
- [ ] **CONSIDER platform/project helpers such as `strlcpy`, `strlcat`, or checked wrappers only when available and their truncation semantics are accepted.** Portability and return-value handling remain part of the contract.

### Errors and Cleanup

- [ ] **MUST define a consistent error convention per API.** Specify success/failure values, output validity on failure, partial progress, retry behavior, and whether errors are enum values, status codes, or `errno`-based.
- [ ] **MUST use `errno` only when the called API documents it as meaningful for that outcome.** Inspect it after detecting failure and before another call can change it; set it to zero first only for APIs whose documented success/failure interpretation requires that (for example, disambiguating some conversion results).
- [ ] **MUST check relevant return values and handle short I/O, interruption, partial initialization, and cleanup failures according to policy.** Do not assume one `read`/`write` transfers the requested amount.
- [ ] **MUST keep one clear cleanup path for partially acquired resources.** Reverse acquisition order; a disciplined `goto cleanup` is often safer than duplicated early-return cleanup.
- [ ] **PREFER `assert` for internal invariants, not expected runtime failures or untrusted input.** Its removal under `NDEBUG` must not change required behavior or side effects.

### Concurrency and Tooling

- [ ] **MUST synchronize shared mutable state and define lock/atomic ownership.** `volatile` is not a threading primitive; use C atomics or platform synchronization with a valid memory-order design.
- [ ] **MUST keep signal handlers within the platform's async-signal-safe rules.** Coordinate with normal code using permitted primitives and documented signal semantics.
- [ ] **PREFER scoped, auditable critical sections and condition-predicate loops.** Recheck predicates after wakeup and define lock ordering where multiple locks exist.
- [ ] **PREFER strong compiler warnings in CI for every supported compiler, with narrow documented suppressions.** Use the project's warning baseline rather than assuming one flag set is portable.
- [ ] **PREFER static analysis and sanitizer-enabled test configurations where supported.** Combine ASan/UBSan, leak/thread tools, fuzzing, and platform tools as applicable; sanitizer success is not a proof of defined behavior.

## Smell List

- Pointer/length APIs with unspecified units, capacity, termination, ownership, aliasing, or lifetime.
- Allocation-size expressions such as `count * sizeof(T)` without overflow and representability checks.
- `realloc` assigned directly to the sole owning pointer, or partial initialization with no reverse-order cleanup path.
- `strcpy`, `strcat`, `sprintf`, or unbounded scans on untrusted/uncertain data; `strncpy`/`strncat` presented as automatically safe.
- Reading `errno` after success or after intervening calls, or clearing it before every call without API-specific reason.
- Error paths that leak resources, discard partial I/O, swallow status, or use `assert` for recoverable conditions.
- Unconditional null-after-free churn that suggests aliases are safe, or no invalidation strategy where a live variable may be reused.
- Fixed-width integers used everywhere without a boundary requirement, or native widths assumed at wire/ABI/data boundaries.
- `restrict` added without a caller-visible non-aliasing contract.
- Signed overflow, out-of-range narrowing, invalid shifts, unchecked pointer arithmetic, or reliance on representation/packing not guaranteed by the target contract.
- `volatile` synchronization, unsynchronized shared state, unsafe signal-handler calls, or condition waits not guarded by predicate loops.
- Weak warning settings, broad warning suppression, or safety-sensitive code lacking appropriate static analysis, sanitizer, and boundary tests.
