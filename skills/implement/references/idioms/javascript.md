# JavaScript Idioms Pack

## Applicability

- Establish the target runtimes, minimum versions, module format, bundler/transpiler behavior, and package entry-point contract before choosing syntax or platform APIs.
- Check whether code runs in browsers, Node.js, workers, edge runtimes, embedded hosts, or several of these; globals and resource semantics differ.
- **MUST** identifies correctness, security, or compatibility requirements. Deviations require an explicit, documented reason.
- **PREFER** identifies the idiomatic default. Local conventions or measured constraints may justify another choice.
- **CONSIDER** identifies a context-dependent technique, not a mandatory abstraction.

## Core principle

**Make dynamic behavior explicit at boundaries and keep the asynchronous runtime observable.** JavaScript provides flexible values and lightweight composition, but correctness depends on validating external data, preserving errors, controlling concurrency, and respecting event-loop and resource lifecycles.

Prefer direct language and platform features over clever coercion, hidden mutation, or framework-independent assumptions. Optimize after measuring the actual runtime and workload.

---

## Power Checklist

### Runtime and Modules

- [ ] **Choose one module system per package boundary.** Follow the declared ESM or CommonJS contract and use explicit interop only at a documented seam.
- [ ] **Use static `import`/`export` when dependencies are known.** Use dynamic `import()` for genuine conditional loading, code splitting, or optional capabilities.
- [ ] **Publish and consume explicit entry points.** Do not depend on another package's private file layout or on bundler-only resolution unless the project requires it.
- [ ] **Feature-detect optional host capabilities where portability is required.** Do not infer browser, Node.js, or worker behavior from a single incidental global.
- [ ] **Keep side effects out of module initialization when practical.** Export setup functions for work that needs configuration, I/O, or deterministic teardown.

### Bindings and Data Modeling

- [ ] **Use `const` by default and `let` for intentional reassignment.** Binding immutability does not freeze an object; control object mutation separately.
- [ ] **Use objects for records with known property names.** Use `Map` for arbitrary keys, frequent keyed updates, or insertion-order iteration, and `Set` for uniqueness and membership.
- [ ] **Use arrays for ordered sequences, not as sparse maps.** Prefer collection methods when they clarify transformation and a loop when control flow or early exit is central.
- [ ] **Accept and return iterables when eager array materialization is unnecessary.** Preserve laziness for large or streaming inputs where the runtime supports it.
- [ ] **Model finite states with tagged objects.** Keep state-specific data with a discriminant instead of coordinating flags and nullable fields by convention.
- [ ] **Use object spread for shallow copying only.** Be explicit about nested sharing; copying syntax does not create deep immutability.

### Values and Control Flow

- [ ] **Use `===` and `!==` by default.** Allow deliberate coercive equality only for a narrow, explained semantic such as `value == null` matching both nullish values.
- [ ] **Use `?.` for genuinely optional traversal and `??` for nullish defaults.** Use `||` only when all falsy values should trigger the fallback.
- [ ] **Define the meaning of missing, `undefined`, and `null` at API boundaries.** Avoid emitting several representations of the same absence accidentally.
- [ ] **Use explicit numeric parsing and validate the complete accepted format.** Account for `NaN`, infinities, precision limits, and `BigInt` where domain values require them.
- [ ] **Keep mutation local and visible.** Prefer transformations that return values, while avoiding wasteful copying when a contained mutation is clearer and measured.

### Promises and Async Flow

- [ ] **Use `async`/`await` for sequential flow and native promise combinators for intentional concurrency.** Return or await every promise unless detachment is explicit and supervised.
- [ ] **Use `Promise.all` when all results are required and fail-fast behavior is correct.** Use `allSettled`, `race`, or `any` only when their distinct completion semantics match the requirement.
- [ ] **Bound concurrency for large or untrusted input.** Do not create one simultaneous request, timer, or file operation per item without considering service and resource limits.
- [ ] **Pass `AbortSignal` through cancellable APIs where supported.** On abort, stop underlying work and remove listeners; cancellation must do more than ignore a late result.
- [ ] **Check an already-aborted signal before starting expensive work.** Compose timeout or parent signals using target-supported APIs rather than ad hoc flags.
- [ ] **Use `for...of` with `await` for sequential iteration.** For concurrency, map to promises deliberately and await them with the appropriate bounded strategy.
- [ ] **Give background work an owner.** Capture failures, expose completion or cancellation where useful, and define shutdown behavior instead of using accidental fire-and-forget.

### Errors and Boundaries

- [ ] **Throw `Error` instances with actionable messages and stable machine-readable fields when callers need classification.** Preserve stacks and original context.
- [ ] **Use `cause` when wrapping an error on runtimes that support it.** Add domain context without replacing the underlying failure.
- [ ] **Catch only where code can recover, translate, annotate, or clean up.** Otherwise let rejection propagate to the layer responsible for policy.
- [ ] **Validate data from network, storage, environment, user input, `postMessage`, and untyped libraries at entry.** Parsing JSON proves syntax, not shape or trustworthiness.
- [ ] **Treat authorization, path handling, URL construction, and command execution as validated boundary operations.** Escaping is sink-specific, not a universal string transform.
- [ ] **Preserve cancellation and operational error distinctions when translating failures.** Do not turn every exception into an empty value or generic status.

### Event Loop and Concurrency

- [ ] **Keep callbacks and microtask chains short enough to yield.** Chunk or offload CPU-heavy work so timers, I/O, rendering, and cancellation can progress.
- [ ] **Understand ordering among synchronous code, promise jobs, timers, rendering, and host-specific queues.** Do not make correctness depend on an assumed delay.
- [ ] **Avoid shared mutable state across requests or concurrent operations unless its ownership and synchronization semantics are explicit.**
- [ ] **Use workers or host-appropriate background facilities for measured CPU-bound work.** Moving synchronous work into an `async` function does not make it nonblocking.
- [ ] **Apply backpressure to streams and producers.** Await writes or consumption signals rather than buffering without limit.

### Resources and Cleanup

- [ ] **Pair acquisition with cleanup using `try`/`finally`.** Cover files, locks, subscriptions, observers, timers, sockets, object URLs, and temporary state.
- [ ] **Remove event listeners with the same identity and options used to add them, or use a supported abort signal for lifecycle cleanup.**
- [ ] **Close or cancel streams deliberately on success, failure, cancellation, and early return according to the API contract.**
- [ ] **CONSIDER explicit resource-management syntax only when the configured runtime/toolchain supports it and the resource implements the protocol correctly.**
- [ ] **Make application shutdown await owned work and resource closure.** Do not rely solely on process exit or garbage collection.

### APIs, Tests, and Tooling

- [ ] **Design small functions around one observable responsibility without imposing arbitrary line limits.** Extract code when naming a concept or isolating policy improves understanding.
- [ ] **Keep public input and output shapes stable and documented.** Prefer options objects when several optional parameters would otherwise be positional and ambiguous.
- [ ] **Test externally visible behavior, failure paths, cancellation, cleanup, and concurrency limits.** Use fake clocks or controllable dependencies instead of real sleeps.
- [ ] **Run the repository's formatter, linter, tests, and target-runtime checks.** Configure lint rules to catch floating promises, accidental globals, and unsafe patterns where tooling supports them.
- [ ] **Test in each supported runtime when host APIs or module resolution differ.** A transpiled syntax check is not a runtime compatibility test.

---

## Smell List

### Language and Data Smells

- `var`, implicit globals, assignment to undeclared names, or reliance on sloppy-mode behavior
- Coercive equality, truthiness defaults, or string/number addition where accepted input types are not obvious
- Object keys used for arbitrary external keys where prototype-sensitive behavior or string coercion is unintended
- Sparse arrays, `delete array[index]`, or array scans standing in for `Map`/`Set` semantics
- JSON stringify/parse used as a deep clone, losing cycles, prototypes, dates, maps, sets, `BigInt`, `undefined`, and special numbers
- Mutation of built-in or third-party prototypes, especially as a package import side effect

### Promise and Error Smells

- Wrapping an existing promise in `new Promise` without adapting a callback or imposing distinct settlement behavior
- Floating promises whose rejection, lifetime, or cancellation has no owner
- `array.forEach(async ...)`, which does not await callbacks or propagate their failures as expected
- Serial `await` in a loop when bounded parallelism is intended, or unbounded `Promise.all` over arbitrary input
- Catch blocks that log and continue, return `undefined`, or replace a useful error without its cause
- Cancellation represented only by a boolean checked after expensive work has already continued
- Retry loops without limits, backoff, cancellation, or classification of retryable failures

### Runtime and Resource Smells

- Mixed ESM and CommonJS conventions inside one package without a deliberate interoperability boundary
- Browser, Node.js, timezone, locale, filesystem, case-sensitivity, or environment-variable assumptions left unstated
- Synchronous filesystem, compression, crypto, parsing, or CPU-heavy loops on a latency-sensitive event-loop path
- Timers, listeners, subscriptions, sockets, streams, or temporary files with no deterministic cleanup path
- Correctness based on arbitrary `setTimeout` delays or presumed microtask/timer ordering
- Unbounded buffering or producer fan-out without backpressure
- Import-time I/O or global mutation that makes tests order-dependent

### Boundary and Maintenance Smells

- Trusting parsed JSON, environment strings, URL parameters, storage values, or messages without shape and range validation
- Optional chaining spread through required paths, silently converting invariant violations into missing output
- Broad environment polyfills or globals installed to hide an unsupported target
- Clever metaprogramming, proxies, or dynamic property access where direct data and functions are clearer
- Tests that assert implementation calls while skipping errors, cleanup, cancellation, and observable outcomes
- Disabling linter rules globally to accommodate a local exception
