# Rust Idioms Pack

## Applicability

Use this guidance when designing, specifying, implementing, reviewing, triaging, or reforging Rust code. The repository's supported Rust version (MSRV), public API commitments, selected runtime, dependency policy, generated-code conventions, and configured formatter/lints take precedence.

- **MUST** marks correctness, soundness, safety, or an explicit project contract.
- **PREFER** marks the idiomatic default; depart when the code or project constraints make another choice clearer or cheaper.
- **CONSIDER** marks a contextual option that requires evidence about ownership, API evolution, workload, or maintenance.

## Core principle

**Use ownership and the type system to encode invariants, while keeping control flow and APIs understandable.** Rust should eliminate invalid states and unsafe resource use where practical, not maximize type cleverness or avoid every allocation, loop, or runtime check.

## Power Checklist

### Ownership and APIs

- [ ] **MUST make ownership and borrowing contracts clear.** Prefer `&str` to `&String` and `&[T]` to `&Vec<T>` when only a view is required; return owned data when ownership must cross a boundary.
- [ ] **MUST manage resources with ownership and `Drop`.** Keep manual release inside a sound abstraction and account for partial initialization and early returns.
- [ ] **PREFER borrowing over cloning when it remains simple.** Clone deliberately when it decouples lifetimes, captures a snapshot, or is cheap enough for the workload.
- [ ] **PREFER newtypes and enums for domain distinctions and state machines.** Do not replace straightforward data with elaborate type machinery that obscures behavior.
- [ ] **PREFER the smallest useful visibility.** Public fields suit stable data records; private fields plus getters or domain methods suit invariants, evolution, computed values, and controlled mutation. Avoid reflexive getters and reflexive exposure alike.
- [ ] **CONSIDER `#[non_exhaustive]` for externally consumed types expected to grow.** It imposes construction/matching costs on callers, so do not add it automatically to internal types or deliberately closed APIs.

### Errors and Panics

- [ ] **MUST distinguish recoverable errors from invariant violations.** Return `Result` for failures callers can handle; reserve panics for broken invariants, impossible states, or explicitly fail-fast application policy.
- [ ] **PREFER typed domain errors at reusable library/component boundaries and contextual reports at application boundaries.** `thiserror` and `anyhow` may coexist by layer: for example, a library exposes a typed `thiserror` enum while a binary adds `anyhow::Context`.
- [ ] **PREFER `?` for propagation and add context where the underlying error does not identify the failed operation.** Match explicitly when recovery, translation, retry, or cleanup differs by variant.
- [ ] **CONSIDER `unwrap`/`expect` when failure is impossible by construction, in tests/examples, or under a documented fail-fast policy.** Prefer `expect` with useful invariant context; do not use either for ordinary malformed input or environmental failure.

### Traits, Types, and Collections

- [ ] **MUST preserve semantic contracts when implementing or deriving traits.** `Eq`, `Ord`, `Hash`, serialization, and conversion behavior must agree with domain identity and compatibility requirements.
- [ ] **PREFER standard traits and conversions when their semantics fit.** Use `From` for infallible conversion, `TryFrom` for validation, and avoid surprising implicit allocation or loss.
- [ ] **PREFER derives for behavior that is genuinely correct.** Do not derive `Clone` merely to satisfy the borrow checker or because neighboring types do; cloning may be expensive or violate single-owner intent.
- [ ] **PREFER iterator combinators for recognizable transformations and loops for stateful control flow, early exits, multiple accumulators, or clearer debugging.** Clarity beats a blanket ban on either form.
- [ ] **PREFER lazy iterator pipelines and collection APIs such as `entry` when they simplify the operation.** Avoid intermediate collections unless they establish ownership, ordering, reuse, or a useful phase boundary.
- [ ] **MUST handle enum variants intentionally.** Wildcards are appropriate for forward-compatible external/non-exhaustive enums or deliberately irrelevant cases, but should not hide meaningful variants of an enum you control.

### Concurrency and Async

- [ ] **MUST avoid holding a blocking or non-async-aware lock guard across `.await` unless the lock and design explicitly support it.** Keep critical sections bounded and cancellation effects understood.
- [ ] **MUST account for spawned-task failure.** A panic commonly becomes a failed join result (for example, a Tokio `JoinError`); whether it is observed, logged, aborts the process, or only ends that task depends on executor use and panic configuration.
- [ ] **PREFER one async runtime per binary unless interoperability is an explicit design.** Move blocking or CPU-heavy work off executor worker threads using the runtime's supported mechanism.
- [ ] **CONSIDER channels for ownership transfer, event streams, and actor-like coordination; shared state for coherent shared snapshots or direct mutation.** Choose `Mutex`, `RwLock`, atomics, or channels from contention, invariants, cancellation, backpressure, and access patterns, not slogans.
- [ ] **CONSIDER typed message enums when a channel carries a closed protocol.** Separate channels or trait-based messages may be clearer for independent flows or extensible systems.

### Unsafe and Verification

- [ ] **MUST state and uphold the safety contract for every `unsafe` operation.** Keep unsafe regions small, explain non-local invariants with `SAFETY` comments, and expose safe APIs only when all safe inputs are sound.
- [ ] **MUST validate FFI layout, ownership, lifetime, thread-safety, panic, and error conventions.** `repr(C)` addresses layout, not the rest of the contract.
- [ ] **PREFER `rustfmt`, project Clippy settings, tests, and relevant dynamic tools such as Miri or sanitizers.** Treat warnings according to repository policy and document intentional allowances narrowly.

## Smell List

- Broad `clone()` use that conceals an unclear ownership model or unexpectedly expensive work.
- `unwrap()`/`expect()` on user input, I/O, synchronization, or task joins without a justified fail-fast policy.
- `String`, booleans, tuples, or untyped maps carrying domain states that a focused enum/newtype/struct would make safer.
- `Box<dyn Trait>` everywhere despite a closed set of variants, or generics everywhere despite compile-time/code-size and API costs.
- Public fields that permit invalid mutation, or boilerplate getters that provide no invariant, abstraction, or evolution benefit.
- `#[non_exhaustive]`, `Clone`, `Default`, `Serialize`, or equality/order derives added without checking downstream and semantic consequences.
- Iterator chains that obscure control flow, or manual loops that reimplement a clear standard iterator operation.
- Blocking calls on async worker threads; detached task failures; unbounded channels without a capacity/backpressure rationale.
- `Arc<Mutex<_>>` chosen automatically, or channels forced onto naturally shared coherent state.
- Lock guards across `.await`, lock-order ambiguity, or cancellation leaving shared state half-updated.
- Scattered `unsafe`, missing safety rationale, unchecked FFI assumptions, or safe wrappers whose invariants callers can violate.
- Broad lint allowances, ignored `Result`s, wildcard matches that hide owned variants, or reachable placeholders/panics in production paths.
