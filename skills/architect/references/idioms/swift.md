# Swift Idioms Pack

## Applicability

- Establish the supported Swift language mode, Apple platform deployment targets, and package/toolchain versions before selecting APIs or concurrency features.
- Respect the repository's existing framework and UI model, such as SwiftUI, UIKit, AppKit, Vapor, or server-side Swift; do not import an Apple-only assumption into portable code.
- **MUST** identifies correctness, safety, or compatibility requirements. Deviations require an explicit, documented reason.
- **PREFER** identifies the idiomatic default. Use another approach when local constraints make the tradeoff clearer.
- **CONSIDER** identifies a context-dependent tool, not a requirement or review blocker.

## Core principle

**Use Swift's type system and ownership model to make states, lifetimes, failures, and isolation explicit.** Prefer code whose valid use is obvious from its shape over code held together by comments, flags, casts, or runtime assumptions.

Choose the simplest abstraction that preserves those guarantees. Value types, protocols, generics, actors, and async functions are tools, not goals; use reference identity, dynamic dispatch, or locks when the domain genuinely requires them.

---

## Power Checklist

### Values, State, and Modeling

- [ ] **Prefer structs for independent values.** Use a class when identity, shared mutable state, Objective-C interoperation, or framework inheritance is part of the model.
- [ ] **Model finite states with enums and associated values.** Keep state-specific data beside its case rather than spreading validity across booleans and optionals.
- [ ] **Make mutation visible.** Prefer `let`, nonmutating transformations, and narrowly scoped `mutating` methods; use copy-on-write collections rather than defensive copying.
- [ ] **Preserve value semantics in custom value types.** A struct that hides unexpectedly shared mutable reference storage must provide copy-on-write behavior or clearly document reference-like semantics.
- [ ] **Use raw values only for real serialized or interoperable representations.** Associated values are usually better for domain data that differs by case.
- [ ] **Switch exhaustively over enums you own.** Use `@unknown default` for non-frozen external enums where future cases are possible, and make fallback behavior deliberate.

### Protocols and Generics

- [ ] **Define protocols around required behavior, not shared storage or speculative reuse.** Keep conformances coherent and requirements minimal.
- [ ] **Use generics or `some Protocol` when preserving concrete type information matters.** Use `any Protocol` when heterogeneous storage or runtime substitution is the actual requirement.
- [ ] **Prefer protocol extensions for genuine default behavior.** Do not hide important customization behind statically dispatched extension-only methods.
- [ ] **Apply constraints where they express an invariant.** Avoid generic parameters that have one concrete use or merely move a cast elsewhere.
- [ ] **CONSIDER composition before class inheritance.** Inheritance remains appropriate where an Apple framework or substitutable class hierarchy requires it.

### Optionals and Errors

- [ ] **Use optionals only for legitimate absence.** If absence has several meanings, use an enum or a typed result that names them.
- [ ] **Unwrap close to use with `guard let`, `if let`, optional chaining, or `map`/`flatMap`.** Choose the form that keeps the successful path readable.
- [ ] **Use `throws` for operations that can fail and let callers decide recovery.** Define errors with useful cases and associated context; preserve underlying errors when crossing layers.
- [ ] **Use `Result` when failure is stored, transported, or used by a callback API.** Prefer ordinary `throws` for direct synchronous or async control flow.
- [ ] **Reserve `precondition`, force unwrap, and `try!` for invariants proven by construction.** The proof should be local and stable, not dependent on mutable input or remote data.
- [ ] **Handle cancellation separately from domain failure where behavior differs.** Do not translate cancellation into a misleading business error.

### Ownership and ARC

- [ ] **Design closure capture lifetimes deliberately.** Determine who owns an escaping closure and whether capturing `self` creates a cycle before choosing a capture list.
- [ ] **Use `weak` when the referenced object may validly disappear.** Handle the resulting optional at the point where work can no longer proceed.
- [ ] **Use `unowned` only when the referent is guaranteed to outlive every access.** It avoids optional handling but traps if the lifetime proof is wrong.
- [ ] **Do not add `[weak self]` mechanically.** A short-lived closure may safely capture strongly, while weakening a required operation can silently discard work.
- [ ] **Break delegate, callback, timer, observation, and task ownership cycles.** Ensure long-lived registrations have an explicit invalidation or cancellation path.

### Structured Concurrency

- [ ] **Prefer `async`/`await`, `async let`, and task groups that tie child work to a lexical scope.** Structured children inherit cancellation and cannot silently outlive their owner.
- [ ] **Check and propagate cancellation in long-running or iterative work.** Use `Task.checkCancellation()` or `Task.isCancelled` at meaningful suspension or work boundaries.
- [ ] **Use `withTaskCancellationHandler` when cancellation must stop an underlying operation or release a resource.** Keep cleanup idempotent.
- [ ] **Use `Task {}` only with a clear owner and lifecycle.** Store and cancel handles for work tied to an object or screen; avoid fire-and-forget business operations.
- [ ] **Reserve `Task.detached` for work that intentionally must not inherit actor, priority, task-local, or cancellation context.** Most asynchronous work does not meet this test.
- [ ] **Do not block cooperative executors.** Move blocking I/O or CPU-heavy work to an appropriate subsystem rather than using semaphores, sleeps, or synchronous waits in async code.
- [ ] **Bound fan-out.** A task group over unbounded input can overwhelm memory, services, or file descriptors even though each child is lightweight.

### Actors, Isolation, and Sendability

- [ ] **Use actors to protect coherent mutable state, not as generic object wrappers.** Keep actor-isolated operations meaningful and minimize cross-actor chatter.
- [ ] **Account for actor reentrancy.** State may change across `await`; capture assumptions before suspension and validate them afterward when needed.
- [ ] **Use `@MainActor` for UI state and APIs that truly require the main executor.** Avoid annotating broad service layers merely to silence isolation diagnostics.
- [ ] **Treat `Sendable` as an ownership guarantee.** Prefer immutable value payloads across isolation boundaries and use `@unchecked Sendable` only with a documented synchronization proof.
- [ ] **Enable the strongest concurrency checking supported by the project's language mode and dependencies.** Fix isolation at the design seam rather than scattering unsafe escapes.

### Collections and APIs

- [ ] **Choose collections by semantics.** Use `Array` for order, `Set` for uniqueness/membership, and `Dictionary` for keyed lookup; do not encode maps as tuple arrays without a reason.
- [ ] **Use sequence operations when they communicate intent, but keep a clear loop when it better expresses control flow or avoids needless allocation.** Prefer lazy chains when intermediate materialization is unnecessary.
- [ ] **Use collection indices rather than assuming integer offsets.** Avoid repeated linear indexing into non-random-access collections.
- [ ] **Follow Swift API Design Guidelines.** Names should read grammatically at call sites, distinguish mutating/nonmutating pairs, and omit redundant type words.
- [ ] **Use argument labels to clarify roles and units.** Represent units and domain identifiers with types when confusion would be costly.
- [ ] **Keep public APIs small and document ownership, actor isolation, errors, and complexity that callers must understand.**

### Access Control and Testability

- [ ] **Use the narrowest practical access level.** Start with `private` or internal module scope and expose only intentional API surface.
- [ ] **Design test seams around behavior and dependencies, not access-control workarounds.** Inject clocks, clients, stores, and nondeterminism at meaningful boundaries.
- [ ] **Use `@testable import` judiciously.** It can test internal behavior, but tests coupled to private implementation structure make refactoring expensive.
- [ ] **Test async behavior without sleeps.** Await observable completion, use controllable dependencies, and verify cancellation and actor-sensitive behavior deterministically.

---

## Smell List

### Type and State Smells

- Force unwraps and `try!` on decoded, user-provided, network, file, or mutable data
- Implicitly unwrapped optionals used to postpone lifecycle design rather than satisfy a framework initialization contract
- Multiple booleans and loosely related optionals encoding a state machine that permits impossible combinations
- Stringly typed states, identifiers, notification names, dictionary keys, or errors where enums, wrappers, or typed constants fit
- Classes chosen by reflex for plain data, with identity and shared mutation introduced accidentally
- Deep inheritance or protocol layers that add indirection without substitutability or reuse
- Broad type erasure and casts where a generic constraint or explicit enum would retain guarantees

### Ownership and Concurrency Smells

- Escaping closures, delegates, timers, observations, or tasks that retain their owner indefinitely
- Mechanical `[weak self]` followed by silent optional chaining that drops required work
- `unowned` based on an expected lifetime rather than a guaranteed one
- Fire-and-forget `Task {}` calls whose errors, cancellation, priority, and lifetime have no owner
- `Task.detached` used to bypass actor-isolation errors or to launch ordinary child work
- Semaphores, `DispatchGroup.wait`, thread sleeps, or synchronous I/O blocking an async context
- Ignoring cancellation in loops, retries, streams, or wrappers around callback APIs
- Mutable state read before `await` and assumed unchanged afterward inside a reentrant actor
- `@MainActor` or `@unchecked Sendable` applied broadly to suppress diagnostics without an isolation proof

### API and Maintenance Smells

- Public setters exposing invariants that should be maintained by domain operations
- Arrays repeatedly scanned for keyed lookup or uniqueness where `Dictionary` or `Set` expresses intent
- Dense chains of `map`, `flatMap`, and optional chaining that conceal branching, errors, or side effects
- Generic abstractions created before a second concrete use demonstrates the shared behavior
- Access levels widened solely so tests can reach implementation details
- Async tests coordinated with arbitrary delays, making correctness dependent on machine timing
- Catch-all error handling that discards context, conflates cancellation, or converts every failure to `nil`
