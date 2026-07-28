# Python Idioms Pack

## Applicability

- Apply this pack to maintained Python 3 projects; honor the project's declared minimum Python version and supported implementations before using newer syntax or standard-library APIs.
- Follow the repository's established formatter, linter, type checker, test runner, packaging metadata, and public API compatibility policy.
- **MUST** marks correctness, safety, or lifecycle requirements. **PREFER** marks the idiomatic default when tradeoffs are otherwise equal. **CONSIDER** marks a context-dependent technique, not a requirement.
- Do not mandate annotations throughout an untyped codebase. Add typing where it protects boundaries, clarifies contracts, or provides demonstrated value.

## Core principle

**Make behavior explicit at boundaries and let Python's data model handle the mechanics.** Prefer clear objects, protocols, iteration, and managed lifetimes over ad hoc conventions, while keeping straightforward code straightforward.

Flag proposals that replace a well-defined domain model or lifecycle with dynamic dictionaries, string conventions, hidden mutation, or ambient state.

---

## Power Checklist

### Data Model and Domain Types

- [ ] **PREFER `dataclass` for value-oriented records with generated comparison and representation.** Choose `frozen=True`, ordering, slots, and custom equality only when their semantics fit; do not use a dataclass merely to avoid writing a meaningful class API.
- [ ] **PREFER `Enum` for a closed set of named values.** Use `StrEnum` only when string interoperability is part of the contract, and compare enum members rather than duplicating their raw values.
- [ ] **CONSIDER value objects or small classes instead of primitive-heavy APIs.** Validation and invariants should live near the data they govern.
- [ ] **MUST implement `__eq__` and `__hash__` consistently.** Mutable objects should not usually be hashable; return `NotImplemented` when comparison with another type is unsupported.
- [ ] **PREFER standard data-model hooks over bespoke conventions.** Iteration, containment, context management, formatting, and path protocols make objects compose with Python and its ecosystem.

### Typing and Interfaces

- [ ] **PREFER annotations at public APIs, serialization boundaries, callbacks, and complex return shapes.** Internal obvious locals rarely need annotations.
- [ ] **PREFER `Protocol` for structural interfaces consumed by multiple implementations.** Keep protocols narrow and behavior-focused; use nominal abstract base classes when shared implementation or runtime registration is genuinely needed.
- [ ] **PREFER precise domain types over `Any`, unstructured mappings, and broad unions.** `TypedDict` is useful for externally shaped mappings; dataclasses or validated models are better when behavior and invariants belong with the data.
- [ ] **MUST narrow optional values before use.** Do not silence a checker with casts or ignores unless the runtime invariant is established and documented.
- [ ] **CONSIDER generics when they preserve a useful relationship between inputs and outputs.** Avoid type machinery that makes a simple API harder to understand.

### Iteration and Control Flow

- [ ] **PREFER iterables and iterators when callers need streaming or one-pass consumption.** Accept `Iterable[T]` rather than `list[T]` when indexing or mutation is unnecessary.
- [ ] **PREFER generators for lazy pipelines and potentially large inputs.** Document single-use behavior and avoid yielding while holding a resource longer than callers expect.
- [ ] **PREFER a comprehension when it is a direct readable transformation.** Use an ordinary loop when branching, state changes, error handling, or naming intermediate values makes intent clearer.
- [ ] **CONSIDER `itertools`, `enumerate`, `zip`, and unpacking before manual index bookkeeping.** Preserve explicit validation when unequal lengths or truncation matter.

### Errors and Resources

- [ ] **MUST raise the most specific useful exception.** Define domain exceptions when callers need to distinguish failures; do not encode failure in magic values when absence is not a normal result.
- [ ] **MUST preserve causality when translating exceptions.** Use `raise DomainError(...) from exc`, or `from None` only when suppressing irrelevant implementation detail is deliberate.
- [ ] **PREFER `with` and context managers for files, locks, transactions, temporary state, and other scoped resources.** Use `contextlib` for simple adapters rather than hand-written cleanup paths.
- [ ] **MUST keep exception scopes narrow.** Catch only errors the code can handle, and perform cleanup with context managers or `finally` rather than duplicated branches.
- [ ] **MUST decide how cleanup errors are handled.** Closing, flushing, committing, and rollback can fail; do not silently discard those failures.

### Paths, Imports, and Modules

- [ ] **PREFER `pathlib.Path` for filesystem paths and path operations.** Convert at APIs that require strings or file descriptors rather than mixing path manipulation styles throughout a module.
- [ ] **PREFER modules organized around cohesive responsibilities.** Keep package `__init__.py` files small and make deliberate re-exports part of the public API.
- [ ] **MUST avoid import-time I/O, network calls, thread creation, and environment-dependent mutation.** Imports should be predictable and safe for tooling and tests.
- [ ] **PREFER absolute imports across package boundaries and relative imports only where they improve local package clarity.** Avoid manipulating `sys.path` in application modules.
- [ ] **MUST resolve circular imports structurally where possible.** Local imports and `TYPE_CHECKING` guards are targeted tools, not substitutes for sensible dependency direction.

### Async and Concurrency

- [ ] **MUST give every created task an owner and completion policy.** Await tasks, keep and inspect them, manage them with a task group, or explicitly document supervised background lifetime.
- [ ] **MUST propagate cancellation unless a boundary intentionally converts it.** Cleanup should be cancellation-safe and should not accidentally turn cancellation into ordinary success.
- [ ] **MUST keep blocking filesystem, CPU-heavy, and synchronous network work off the event-loop thread.** Use an async implementation, a thread, or a process according to the workload.
- [ ] **PREFER structured concurrency such as `asyncio.TaskGroup` when the supported Python version permits it.** Define sibling failure and shutdown behavior explicitly.
- [ ] **CONSIDER backpressure and bounded concurrency.** Unbounded task creation can exhaust memory, sockets, or downstream services even when each operation is asynchronous.

### Packaging, Tooling, and Tests

- [ ] **MUST declare runtime dependencies, optional extras, Python requirements, and build metadata in the project's packaging configuration.** Do not rely on undeclared local environment state.
- [ ] **PREFER one authoritative configuration path for formatting, linting, typing, and tests.** Match existing tools instead of adding overlapping ones without a concrete gap.
- [ ] **PREFER tests around observable behavior, boundary failures, and resource cleanup.** Use parametrization for meaningful cases and fixtures with explicit, minimal scope.
- [ ] **MUST make tests deterministic.** Control clocks, randomness, environment, filesystem, and network boundaries rather than sleeping or depending on execution order.
- [ ] **CONSIDER property-based tests for parsers, serializers, state transitions, and invariant-rich transformations.** Keep examples for important regressions and readable contracts.

---

## Smell List

### Data and API Smells

- Mutable default arguments such as `def f(items=[])`; use `None` or a default factory when a fresh value is required
- Nested `dict[str, Any]` structures passed across layers, with required keys and value meanings known only by convention
- Stringly typed modes, statuses, field names, or dispatch where an enum, value object, callable, or protocol would express the contract
- Boolean parameters whose call sites conceal distinct operations, especially several independent flags
- A dataclass with extensive mutation and invariant repair that should expose behavior through a purposeful class API
- Identity checks for value equality (`is` instead of `==`), or equality checks for singletons such as `None` instead of `is`

### Error and Resource Smells

- Bare `except:` or broad `except Exception` around substantial work, especially when it logs and continues with partial state
- Raising `Exception` or returning `None` for every failure, leaving callers unable to distinguish expected absence from errors
- Translating an exception without `from`, losing the causal relationship, or logging and re-raising the same failure at every layer
- Opening files, acquiring locks, changing directories, patching environment state, or starting transactions without scoped cleanup
- Depending on garbage collection to close resources, finish generators, or flush buffered data
- Catching cancellation or process-control exceptions as ordinary application failures

### Iteration and Module Smells

- Materializing a list solely to iterate once when streaming materially improves memory use or latency
- A dense comprehension or generator expression with hidden side effects, multiple branches, or duplicated expensive work
- Import-time registration or singleton construction whose ordering changes behavior or makes tests depend on module cache state
- Circular imports patched repeatedly with local imports instead of addressing module responsibilities
- Wildcard imports, `sys.path` mutation, or internal modules treated as stable public APIs by accident
- Manual path concatenation, current-working-directory assumptions, or platform-specific separators where `Path` should carry intent

### Async and Concurrency Smells

- `asyncio.create_task()` with no retained reference, owner, result handling, cancellation path, or shutdown policy
- Blocking library calls or CPU-bound loops inside `async def`, causing unrelated tasks to stall
- Fire-and-forget coroutines, un-awaited coroutine warnings, or tasks allowed to survive beyond the resources they use
- Catching cancellation and continuing indefinitely, or shielding work without a bounded reason and owner
- Unbounded `gather` or task creation over external input with no backpressure
- Holding synchronous locks or scarce resources across `await` when the suspended task cannot guarantee timely release

### Tooling and Test Smells

- Runtime dependencies imported successfully only because developer tools installed them transitively
- Tests that sleep, rely on wall-clock timing, share mutable global fixtures, or require a particular order
- Mocking internal implementation chains instead of substituting a boundary or asserting observable behavior
- Blanket type ignores, lint suppressions, or coverage exclusions without a narrow documented reason
- Requiring typing everywhere, or rewriting clear loops as comprehensions solely to satisfy a stylistic preference
