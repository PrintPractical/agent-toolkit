# Go Idioms Pack

## Applicability

- Apply this pack to Go modules; honor the `go` directive, supported platforms, and repository compatibility policy before using newer language or standard-library features.
- Follow the module's established formatting, analysis, generation, testing, and dependency conventions. `gofmt` output is non-negotiable.
- **MUST** marks correctness, safety, or lifecycle requirements. **PREFER** marks the idiomatic default when tradeoffs are otherwise equal. **CONSIDER** marks a context-dependent technique, not a requirement.
- Generated code, low-level systems code, and performance-critical paths may justify different choices, but the constraint should be measured or documented rather than assumed.

## Core principle

**Keep ownership, control flow, and concurrency visible through simple composition.** Go is strongest when concrete behavior is easy to trace, interfaces are small and local to consumers, and every resource or goroutine has a clear lifetime.

Flag proposals that introduce abstraction, pointers, channels, goroutines, or global state without a concrete need and an explicit owner.

---

## Power Checklist

### Design and Composition

- [ ] **PREFER small packages and types composed from concrete collaborators.** Add abstraction at a demonstrated variation point, not in anticipation of one.
- [ ] **PREFER interfaces defined by the package that consumes behavior.** Keep them minimal; producers should usually return concrete types so callers retain the full API.
- [ ] **PREFER accepting behavior and returning concrete results.** Accept an interface when multiple implementations or test substitution matter; do not export an interface merely to mirror one struct.
- [ ] **PREFER embedding for capability composition, not inheritance simulation.** Be deliberate about promoted methods and whether they become part of the public API.
- [ ] **MUST preserve useful zero values where practical.** A zero value should be ready to use or fail clearly; constructors are warranted when invariants, dependencies, or ownership require them.
- [ ] **PREFER explicit dependencies over package globals and hidden registries.** Construction should show what a component needs.

### Errors and Boundaries

- [ ] **MUST return errors for recoverable failures and inspect every meaningful error.** Do not use panic for ordinary validation, I/O, or business failures.
- [ ] **MUST wrap errors with operation and relevant context using `%w` when callers need the cause.** Avoid both context-free propagation and repetitive noise.
- [ ] **MUST use `errors.Is` and `errors.As` for wrapped errors.** Do not compare error strings or depend on exact wrapping text.
- [ ] **PREFER sentinel errors only for stable conditions callers must branch on; prefer typed errors when structured details matter.** Keep the exported error surface intentional.
- [ ] **MUST place panic recovery only at genuine process, request, job, or plugin boundaries.** Recover to restore isolation, record diagnostics, and produce a defined failure; never silently continue corrupted local work.
- [ ] **MUST preserve partial-result semantics explicitly.** If a function can return useful data with an error, document and test what remains valid.

### Context and Cancellation

- [ ] **MUST accept `context.Context` as the first parameter for request-scoped cancellation, deadlines, and values.** Pass it through rather than replacing it with `context.Background()`.
- [ ] **MUST call the cancellation function returned by `WithCancel`, `WithTimeout`, or `WithDeadline`.** Usually `defer cancel()` immediately after successful construction.
- [ ] **PREFER context values only for request-scoped cross-cutting metadata.** Required business dependencies and optional arguments belong in explicit parameters or types.
- [ ] **MUST stop work promptly when cancellation is part of the contract.** Blocking sends, receives, retries, and waits need a cancellation path.
- [ ] **CONSIDER whether cleanup should outlive a canceled request.** If so, create an explicitly bounded cleanup context rather than accidentally discarding cancellation.

### Resources and `defer`

- [ ] **PREFER `defer` immediately after successfully acquiring a resource.** Keep cleanup adjacent to ownership and handle cleanup errors when they affect correctness.
- [ ] **MUST close response bodies, files, rows, transactions, and other owned handles on every path.** Check terminal errors such as `Rows.Err`, flush, commit, and close where relevant.
- [ ] **PREFER scoped helper functions when defers inside a loop would retain many resources.** Do not abandon `defer`; make the lifetime match the operation.
- [ ] **MUST understand defer argument evaluation and named-return mutation before relying on them.** Favor straightforward cleanup over clever return rewriting.
- [ ] **PREFER explicit transaction commit/rollback ownership.** A deferred rollback can safely cover early returns while successful commit remains visible.

### Goroutines and Synchronization

- [ ] **MUST define who starts, stops, waits for, and observes every goroutine.** A goroutine is a resource, not a free background call.
- [ ] **MUST give long-lived or blocking goroutines cancellation and shutdown paths.** Close only channels the sender owns, and wait for workers when their completion matters.
- [ ] **PREFER structured groups for related goroutines when one failure should cancel siblings and be returned.** Preserve the first useful cause and avoid orphaned work.
- [ ] **PREFER channels for ownership transfer, event streams, coordination, or bounded pipelines.** Prefer a mutex for protecting shared in-memory state when message passing would obscure simple invariants.
- [ ] **MUST avoid holding locks across blocking I/O, channel operations, callbacks, or unknown code.** Define and preserve lock ordering when multiple locks are unavoidable.
- [ ] **CONSIDER buffered channels only with a reasoned capacity and backpressure policy.** Buffering changes scheduling and failure behavior; it does not repair a lifecycle bug.

### Collections, Allocation, and Generics

- [ ] **PREFER slices as sequence APIs and maps for keyed lookup.** Document whether inputs or returned slices/maps may be retained or mutated when aliasing matters.
- [ ] **MUST distinguish nil from empty only where the observable contract requires it, such as serialization or protocol semantics.** Otherwise accept idiomatic nil slices and maps appropriately.
- [ ] **PREFER `make` capacity hints when size is known and material, but measure before complicating allocation strategy.** Avoid preallocation guesses that waste memory or obscure code.
- [ ] **MUST copy slices, maps, or byte buffers at ownership boundaries when later mutation would violate the contract.** Assignment copies headers, not backing data.
- [ ] **CONSIDER generics for reusable algorithms or containers that retain type relationships without reflection or duplication.** Do not replace a small behavioral interface with type parameters, or add generic abstraction used by only one concrete case.
- [ ] **PREFER value receivers for small immutable value-like types and pointer receivers for mutation or costly copies.** Keep a type's method set coherent and never copy synchronization state.

### Testing and Tooling

- [ ] **MUST format with `gofmt` and keep `go test ./...` viable for the module.** Run the repository's configured analysis and generation checks as well.
- [ ] **PREFER table-driven tests when cases share setup and assertions.** Give cases descriptive names and keep bespoke scenarios separate when a table hides intent.
- [ ] **CONSIDER fuzz tests for parsers, codecs, protocol boundaries, and invariant-heavy transformations.** Seed them with meaningful examples and regression inputs.
- [ ] **MUST run race-enabled tests for concurrent changes where the supported platform permits it.** The race detector complements, rather than proves, synchronization correctness.
- [ ] **PREFER tests against public behavior and small consumer-defined fakes.** Avoid exposing internals or creating large producer-side interfaces only for mocking.
- [ ] **MUST make concurrent tests deterministic through synchronization.** Do not use sleeps as a substitute for observing readiness or completion.

---

## Smell List

### API and Abstraction Smells

- Interfaces declared beside the implementation, returned by constructors, and used only by that implementation's callers
- Giant interfaces combining unrelated capabilities, forcing consumers and test doubles to depend on methods they do not use
- Java-style constructors, getters, builders, and inheritance-shaped embedding around simple structs
- Generics introduced to avoid a few clear concrete operations, or constraints so broad that supported behavior is unclear
- Constructors required only because a type's accidental zero value panics or behaves inconsistently
- Indiscriminate pointer use for small values, optionality without semantics, or mutation that should be explicit in a result

### Error and Context Smells

- Ignored errors from writes, flushes, closes, scanners, row iteration, cleanup, or goroutines
- Comparing `err.Error()` text, type-asserting through wrappers instead of `errors.As`, or equality checks instead of `errors.Is`
- Wrapping every layer with vague text such as "failed", or wrapping without `%w` when callers need the cause
- Panic used for malformed input or operational failure, or broad recovery deep inside library code
- Storing `context.Context` in a struct, retaining it beyond the operation, or accepting nil context
- Replacing caller context with a background context and unintentionally discarding cancellation or deadlines

### Concurrency Smells

- Goroutines started without a stop condition, completion signal, error path, or owner that waits for them
- Sends or receives that can block forever after a peer exits; worker pools whose input closes but outputs or workers do not
- Closing a channel from the receiver side or using channel close as a broadcast without clear sender ownership
- Channels used as mutexes for ordinary shared state, or mutexes used where ownership transfer is the actual model
- A channel allocated for every interaction despite a direct call or lock being simpler and more observable
- Copying a struct containing `sync.Mutex`, `sync.RWMutex`, `sync.Once`, atomics, or another no-copy value
- Launching unbounded goroutines per item with no concurrency limit or downstream backpressure

### Resource and State Smells

- `defer` omitted because cleanup looks obvious, leaving early-return paths to leak resources
- Defers accumulated in a large loop, retaining files, bodies, locks, or transactions until the outer function returns
- `init` functions that perform I/O, register hidden behavior, start goroutines, or make initialization order significant
- Mutable package globals, global clients configured by side effect, or tests that must restore ambient state
- Returning internal slices or maps whose mutation can violate invariants, or retaining caller buffers without documenting ownership
- Writing to a nil map, assuming a non-nil empty slice in an API, or depending accidentally on JSON's nil/empty distinction

### Performance and Test Smells

- Preallocating every collection, pooling cheap objects, or using pointers to avoid copies without measurements
- Converting repeatedly between strings and byte slices in a hot path without considering ownership and allocation
- Table tests with unreadable anonymous fields and branching assertions that conceal materially different behavior
- Concurrent tests stabilized with arbitrary sleeps, skipped race checks, or assertions made before goroutines are joined
- Fuzz targets that only check for panics when stronger round-trip, validity, or invariant properties are available
