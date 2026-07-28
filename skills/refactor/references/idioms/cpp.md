# C++ Idioms Pack

## Applicability

Use this guidance when designing, specifying, implementing, reviewing, triaging, or reforging C++ code. The repository's selected language standard, compiler/library support, ABI and exception/RTTI policy, performance constraints, coding standard, and compatibility commitments take precedence. Version-gate C++20/23 facilities and provide only the fallbacks the supported toolchain requires.

- **MUST** marks correctness, lifetime/resource/thread safety, or an explicit project/ABI contract.
- **PREFER** marks the idiomatic default; depart when project constraints, profiling, or clearer code justify it.
- **CONSIDER** marks a contextual option whose value depends on ownership, lifetime, API stability, or toolchain support.

## Core principle

**Express ownership, lifetime, and invariants with RAII and value-oriented types, then use the simplest abstraction that preserves them.** Modern C++ reduces manual bookkeeping, but abstractions remain subject to lifetime, invalidation, allocation, and version constraints.

## Power Checklist

### Resource and Value Semantics

- [ ] **MUST give every resource one clear RAII owner or an explicit shared-ownership contract.** Wrap memory, handles, locks, transactions, and registrations so all exits clean up correctly.
- [ ] **PREFER the rule of zero.** Compose standard containers, smart pointers, and RAII members so the compiler-generated destructor/copy/move operations are correct.
- [ ] **MUST reason about all special members when custom resource management requires one.** Delete unsupported copy/move operations or implement the necessary rule-of-five members consistently; do not blindly define all five.
- [ ] **PREFER `std::unique_ptr` for exclusive dynamic ownership and direct values when indirection is unnecessary.** Use `std::shared_ptr` only for true shared lifetime ownership, not merely to pass or observe an object.
- [ ] **MUST distinguish owning from non-owning raw pointers/references.** Raw observation can be appropriate; raw `new`/`delete` ownership should remain inside a justified low-level RAII implementation.
- [ ] **PREFER returning values normally.** Copy elision and implicit move handle local return values; do not write `return std::move(local);`, which can inhibit NRVO. Use `std::move` when intentionally transferring from a named object elsewhere.

### Views, Containers, and Algorithms

- [ ] **MUST keep `std::string_view`, `std::span` (C++20), iterators, references, and pointers within the lifetime of their backing storage.** Account for temporaries, reallocation, mutation, coroutine suspension, and asynchronous capture.
- [ ] **MUST not treat `std::vector::operator[]` as checked.** Use `at()` when runtime bounds checking is required, or establish bounds before indexing; debug-library checks are implementation/configuration features.
- [ ] **PREFER standard containers and algorithms where their semantics clarify intent.** A direct loop is appropriate for stateful logic, early exits, correlated updates, or when it is clearer than an algorithm pipeline.
- [ ] **PREFER range-based loops when an index is not part of the operation.** Choose `auto`, `const auto&`, `auto&`, or `auto&&` deliberately based on copying and mutation.
- [ ] **MUST understand structured-binding ownership.** `auto [k, v] = pair` copies/moves the elements; `auto& [k, v]` or `const auto& [k, v]` binds references. Choose intentionally, especially in map loops.
- [ ] **CONSIDER `std::string_view` for synchronous read-only string parameters and `std::span` for contiguous ranges when their non-owning nature is clear.** Prefer owning types when data must be retained.

### Results and Errors

- [ ] **MUST follow the project's exception policy and maintain exception safety.** Destructors must not allow exceptions to escape during normal cleanup; catch polymorphic exceptions by reference.
- [ ] **PREFER `std::optional<T>` only to represent presence or absence when no diagnostic is needed.** Use a status/result type, exception, or `std::expected<T, E>` (C++23, when supported) when callers need failure reasons.
- [ ] **PREFER RAII over catch-and-cleanup code.** Define whether mutating operations provide no-throw, strong, or basic exception guarantees where callers rely on them.
- [ ] **CONSIDER `[[nodiscard]]` for results whose accidental omission is likely a bug.** Avoid marking routine fluent/value APIs indiscriminately.

### Types and Interfaces

- [ ] **PREFER `enum class`, explicit conversions, and domain value types when they prevent accidental mixing.** Preserve straightforward interoperability where an ABI or protocol requires primitive forms.
- [ ] **PREFER `const`-correct interfaces and `constexpr` where values or functions are genuinely usable at compile time.** Do not add `const` to copied scalar parameters in public declarations as if it constrained callers.
- [ ] **PREFER composition over inheritance for reuse.** Use virtual interfaces when runtime substitution is required; give polymorphic bases a suitable virtual destructor when deletion through the base is supported, and mark overrides `override`.
- [ ] **MUST preserve ABI/lifetime contracts in callbacks and polymorphic APIs.** Returning values from virtual functions does not inherently force heap allocation; decide representation from semantics and measured cost.
- [ ] **CONSIDER templates, concepts (C++20), variants, or virtual dispatch according to whether polymorphism is compile-time, closed-set, or open/runtime.** Include compile-time, code-size, ABI, and extensibility costs.

### Concurrency and Tooling

- [ ] **MUST synchronize shared state with mutexes/atomics and a valid memory-order design.** `volatile` and `shared_ptr` reference-count safety do not make pointed-to data thread-safe.
- [ ] **MUST make asynchronous and coroutine captures lifetime-safe.** Avoid retaining `this`, references, views, or iterators past owner destruction or invalidation.
- [ ] **PREFER RAII lock types and avoid calling unknown code while holding locks.** Define lock ordering and condition predicates where relevant.
- [ ] **PREFER the project's formatter, warnings, static analysis, sanitizers, and tests.** Version-check diagnostics and library features across all supported compilers.

## Smell List

- Hand-written destructor/copy/move members where rule-of-zero composition would suffice, or all five special members added mechanically.
- `return std::move(local);`, unnecessary moves from `const`, or use-after-move assumptions beyond a valid but unspecified state.
- `shared_ptr` used for convenience without shared lifetime, hidden ownership cycles, or `use_count()` used for synchronization.
- Owning raw pointers, unmatched `new`/`delete`, or manual lock/unlock and cleanup vulnerable to early returns or exceptions.
- `vector[i]` assumed to perform bounds checks; iterator/reference use after container invalidation.
- `string_view`, `span`, lambda captures, or coroutine state outliving the referenced object or temporary.
- `optional` used where failures require diagnostics, or sentinel/null values used where absence should be explicit.
- Structured bindings that copy expensive values accidentally, especially `for (auto [k, v] : map)`.
- C++20/23 features used without matching the declared standard and supported compiler/standard-library versions.
- Blanket bans on loops, `printf`/C APIs, or inheritance without considering project interfaces, interoperability, formatting safety, and semantics.
- `memcpy`/`memset` on unsuitable non-trivially-copyable objects, unsafe casts, or C varargs/format strings without type/format validation.
- `volatile` used for synchronization, locks held across callbacks, or async work capturing unowned state.
- Performance claims based on folklore, including claims that virtual value returns inherently allocate; measure relevant workloads and preserve correctness first.
