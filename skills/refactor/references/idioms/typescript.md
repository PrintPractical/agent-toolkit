# TypeScript Idioms Pack

## Applicability

- Establish the TypeScript version, `tsconfig` inheritance, target runtimes, module/resolution mode, emitted output, and package entry-point contract before selecting features.
- Check whether code is type-checked only, transpiled by `tsc`, or emitted by another tool; compiler options and runtime behavior are separate concerns.
- **MUST** identifies correctness, safety, or compatibility requirements. Deviations require an explicit, documented reason.
- **PREFER** identifies the idiomatic default. Existing public contracts or measured constraints may justify another choice.
- **CONSIDER** identifies a context-dependent technique, not a demand for additional abstraction.

## Core principle

**Use types to encode verified knowledge, and validate everything that TypeScript cannot know at runtime.** Types erase, assertions do not check values, and asynchronous JavaScript still controls execution, cancellation, resources, and failure.

Make illegal states difficult to construct without making ordinary code fight an elaborate type model. Favor inference, narrowing, and explicit domain unions over casts, broad generics, or class hierarchies imported from nominal languages.

---

## Power Checklist

### Project and Compiler Discipline

- [ ] **Enable `strict` for new code and keep it enabled.** Treat migration exceptions as scoped technical debt rather than weakening the whole project.
- [ ] **CONSIDER `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.** They reveal real absence bugs, but adoption must account for existing APIs and declaration compatibility.
- [ ] **Use `noImplicitOverride`, `noFallthroughCasesInSwitch`, and unused checks when they fit the repository's build and lint workflow.** Avoid duplicate diagnostics that add noise without coverage.
- [ ] **Align `module`, `moduleResolution`, package `type`, exports, and the actual runtime.** Passing type-checks does not prove Node.js, browser, bundler, or test-runner resolution will agree.
- [ ] **Do not rely on a newer standard-library declaration than the deployed runtime provides.** Add a deliberate polyfill or select a compatible target.
- [ ] **Keep generated declarations and public API checks in CI for libraries.** Consumers experience the emitted types, not the source editor state.

### Unknown Values and Narrowing

- [ ] **Use `unknown` for untrusted or genuinely unspecified values.** Narrow with `typeof`, `instanceof`, property checks, predicates, or schema validation before use.
- [ ] **Prefer control-flow narrowing over assertions.** Preserve the evidence that proves a type instead of asking the compiler to ignore uncertainty.
- [ ] **Write type predicates only when their implementation fully validates the promised type.** An unsound predicate spreads false certainty to every caller.
- [ ] **Handle caught values as `unknown`.** Extract a safe message or classify known errors without assuming every thrown value is an `Error`.
- [ ] **Distinguish absence from falsiness.** Use optional chaining and nullish coalescing when `0`, `false`, and `""` remain valid.
- [ ] **Define whether omitted, `undefined`, and `null` differ in public and serialized shapes.** `exactOptionalPropertyTypes` can enforce part of this distinction.

### Domain Modeling

- [ ] **Use discriminated unions for finite states and variant payloads.** Put data required by a state on that variant rather than behind optional properties.
- [ ] **Make owned unions exhaustive.** In a `switch`, assign the remaining value to `never` or call an `assertNever` helper so new variants require a decision.
- [ ] **Use literal unions, enums, or const-backed objects according to runtime needs.** Do not ban either `enum` or object alternatives dogmatically; account for emission, interoperability, and reverse mapping.
- [ ] **Use `as const` to retain literal and readonly inference for values that are intended to be fixed.** Do not use it to pretend a mutable runtime object is deeply immutable.
- [ ] **Use `satisfies` to check a value against a contract while preserving useful inferred literals.** Use an annotation when consumers should see the broader declared type.
- [ ] **CONSIDER branded or opaque types for high-cost identifier or unit mix-ups.** Keep construction at validated boundaries and avoid branding every primitive.

### Interfaces, Aliases, and API Types

- [ ] **Choose `interface` or `type` based on the needed capability and local convention.** Interfaces support declaration merging and extension; aliases naturally express unions, tuples, and mapped types.
- [ ] **Export intentional API types rather than leaking deep inferred implementation types.** Keep public signatures stable and readable in generated declarations.
- [ ] **Use `import type` and type-only exports where configured emission semantics benefit.** Preserve runtime imports when decorators, side effects, or actual values require them.
- [ ] **Prefer readonly inputs and properties when callers should not mutate through the reference.** Remember that TypeScript readonly is compile-time and usually shallow.
- [ ] **Use utility and mapped types when they preserve domain meaning.** A named public shape is often clearer than a dense stack of `Pick`, `Omit`, conditionals, and intersections.
- [ ] **Avoid exposing implementation-only classes solely to carry data.** Plain objects and functions often produce simpler structural APIs.

### Generics

- [ ] **Introduce a type parameter when it relates two or more positions or preserves caller-specific information.** A generic used once often should be a concrete or union type.
- [ ] **Constrain generics to the operations the implementation performs.** Do not use `object`, `{}`, or broad records as substitutes for a precise requirement.
- [ ] **Prefer inference at call sites.** Require explicit type arguments only when inference cannot express the intended choice safely.
- [ ] **Use overloads for a small number of meaningfully distinct call contracts.** Prefer unions when behavior and return type do not depend on the input variant.
- [ ] **Keep conditional and recursive types shallow enough for users and tooling to understand.** Test their public behavior with compile-time type tests where valuable.
- [ ] **Do not make runtime architecture generic merely to showcase type machinery.** The implementation still needs a clear JavaScript data flow.

### Runtime Validation and Errors

- [ ] **Validate network, storage, environment, user, JSON, message, and untyped-library data at entry.** A type annotation or `as T` emits no runtime check.
- [ ] **Derive types from a runtime schema or keep validator and type visibly paired when practical.** Test rejection as well as accepted values to prevent drift.
- [ ] **Return or throw typed domain outcomes internally, while acknowledging that `catch` cannot guarantee what was thrown.** Preserve original errors with `cause` when wrapping.
- [ ] **Use result unions when failure is ordinary data that callers must branch on.** Use exceptions for failure propagation when that matches the surrounding API.
- [ ] **Validate numeric ranges, dates, URL/path components, and identifiers beyond structural shape.** Structural typing alone cannot enforce semantic validity.
- [ ] **Keep authorization and security decisions in runtime code.** Types improve call-site discipline but are not a trust boundary.

### Async JavaScript Discipline

- [ ] **Return or await every promise unless background execution is explicit and supervised.** Configure linting to detect floating and misused promises.
- [ ] **Use `async`/`await` for sequential flow and promise combinators for intentional concurrency.** Never use `forEach(async ...)` when completion matters.
- [ ] **Bound concurrency over large or untrusted input.** `Promise.all` starts all mapped work eagerly and can overwhelm services or resources.
- [ ] **Thread `AbortSignal` through cancellable operations where the target APIs support it.** Stop underlying work and clean up listeners rather than merely ignoring results.
- [ ] **Keep CPU-heavy and synchronous work off latency-sensitive event-loop paths.** An `async` return type does not make execution nonblocking.
- [ ] **Model async state with discriminated unions.** Avoid independent `loading`, `error?`, and `data?` fields that admit contradictory combinations.

### Collections, Resources, and Testing

- [ ] **Use objects for known records, `Map` for arbitrary keys, `Set` for uniqueness, and arrays for ordered sequences.** Model the runtime collection actually used.
- [ ] **Pair resource acquisition with deterministic cleanup using `try`/`finally` or target-supported resource syntax.** Cover timers, listeners, subscriptions, streams, files, and sockets.
- [ ] **Apply backpressure and explicit shutdown to producers, streams, and owned background work.** Garbage collection is not lifecycle management.
- [ ] **Test observable behavior, runtime validation, error translation, cancellation, cleanup, and concurrency limits.** Add type-level tests for important inference and rejection contracts.
- [ ] **Run strict type-checking separately from tests when the test runner transpiles without checking.** Also run formatter, linter, and tests against supported runtimes.
- [ ] **Avoid real sleeps in async tests.** Use fake clocks, controllable promises, or injected dependencies for deterministic ordering.

---

## Smell List

### Type-System Escape Smells

- `any` entering core code without a narrow, documented interoperability boundary
- `as SomeType` applied to external data, JSON, DOM queries, or complex transformations without runtime evidence
- Double assertions such as `value as unknown as T`, which usually conceal an incompatible design
- Non-null assertions on values whose presence depends on timing, lookup, configuration, user input, or remote data
- Broad index signatures that claim every key exists or erase known property distinctions
- Type predicates and declaration files that promise more than their runtime implementation guarantees
- Suppression comments without a narrow explanation and a plan or invariant that makes the exception safe

### Modeling and Abstraction Smells

- Optional-property bags plus several booleans encoding states that should be a discriminated union
- Optional booleans where `undefined`, `false`, and `true` accidentally create an undocumented three-state API
- Strings used for closed states, event kinds, identifiers, or units with no checked vocabulary
- Generic parameters that appear once, cannot be inferred, or merely move a cast into the implementation
- Conditional-type puzzles that make error messages and declarations harder to understand than duplicated explicit types
- Brands applied to routine values with no credible mix-up risk or controlled construction boundary
- Java-style abstract class hierarchies, factories, and data classes where unions, objects, functions, and composition fit better
- Dogmatic interface-versus-type rules or blanket enum bans that ignore declaration merging, unions, runtime emission, and interoperability

### Runtime and Async Smells

- Treating static types as validation for parsed JSON, environment variables, messages, storage, or network responses
- Floating promises, `forEach(async ...)`, swallowed rejections, or background work with no lifecycle owner
- Unbounded `Promise.all` over arbitrary input or serial awaits where bounded parallelism is required
- Catch blocks that assume `error.message`, erase the cause, or translate cancellation into a domain failure
- Synchronous filesystem, parsing, compression, crypto, or CPU-heavy loops on a latency-sensitive event loop
- Mixed module systems or compiler resolution that differs from production runtime resolution
- Environment, locale, timezone, filesystem, DOM, or global API assumptions absent from the supported-target contract
- Listeners, timers, streams, subscriptions, and file handles without deterministic cleanup

### Maintenance Smells

- Public APIs inferred from implementation accidents and emitted as unreadable conditional or anonymous types
- Type-only imports emitted or removed incorrectly because toolchain semantics were not established
- Large `Partial<T>` update surfaces that bypass invariants and permit unrelated fields to change together
- Readonly annotations presented as proof of deep runtime immutability
- Tests that compile only through a transpiler and never run the strict type checker
- Type tests that mirror implementation details while runtime errors, validation, cleanup, and cancellation remain untested
