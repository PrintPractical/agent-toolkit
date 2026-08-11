# Engineering Fundamentals

Use this reference to test material engineering choices during architecture, specification, planning, implementation, and review. It is not a demand to redesign every line. Bound discovery to the requested change, affected seams, acceptance criteria, and credible failure or workload risks; stop when those material concerns have evidence-backed decisions and tasks.

## Workload before structure

- Describe the operations that dominate the real workload before selecting a data structure: input size and upper bound, lookup/insert/delete/iteration mix, ordering and duplicate rules, access locality, mutation pattern, concurrency, latency target, and memory/resource budget.
- State the relevant expected, worst-case, or amortized time and space costs. Include constants only when they are material, and identify adversarial or skewed inputs that change the result.
- Prove bounds at trust boundaries and before allocation, indexing, recursion, conversion, and arithmetic. Account for overflow, truncation, empty input, maximum representable values, and aggregate limits across concurrent work.
- Choose by required operations. Concrete alternatives include a contiguous sequence for ordered scans and indexed access, a hash map/set for average keyed lookup or membership, an ordered tree/map for sorted traversal and range queries, a heap for repeated extrema, and a queue/deque for FIFO work. Do not replace a small bounded scan with an index whose maintenance costs more than it saves.

## States and transitions

- Represent a closed domain state with the language's strongest practical type: an enum/sum type/tagged union, or a validated named value when the language cannot close the set. Keep state-specific data on its variant rather than coordinating booleans, nulls, and unrelated fields.
- Define legal transitions in one visible operation or transition table. Construction and deserialization must validate states; mutation must reject illegal transitions; exhaustive handling should make a new state require a deliberate decision where the language supports it.
- Preserve compatibility deliberately when states cross a persistence, wire, plugin, or public API seam. An internal type improvement does not by itself authorize changing serialized names, numeric values, unknown-state behavior, or migration policy.

## Select the least costly abstraction

- Start concrete when one behavior and one representation exist. Extract a function when only an operation varies; use an enum/tagged union for a closed set of variants; use generics for compile-time variation that preserves type relationships; use an interface/trait/protocol for open substitution; use dynamic dispatch or type erasure only when runtime heterogeneity or decoupling requires it.
- Name the concrete alternatives and their costs. Compare, for example, a direct collaborator versus an interface, a closed enum versus plugin dispatch, a generic algorithm versus duplicated concrete functions, or a standard collection versus a custom index.
- Do not add an abstraction solely because a second implementation can be imagined. Require a current variation point, boundary, invariant, test seam, or measured workload benefit. Likewise, do not retain duplication when two material domain rules must evolve together.

## Standard machinery first

- Prefer the language's standard algorithms, collection operations, parsing/conversion facilities, and resource-management constructs when their contracts fit. They are usually more recognizable and better tested than bespoke loops or containers.
- Verify the actual contract: ordering and stability, comparator preconditions, mutation/invalidation, allocation, error and partial-result behavior, and complexity. A library call is not automatically correct merely because it is standard.
- Write a direct loop or focused local implementation when it makes stateful control flow clearer or when the standard operation cannot meet a demonstrated bound. Document the reason and test the boundary conditions.

## Equality, hashing, and ordering

- Define domain identity before implementing equality. Values considered equal must produce equal hashes, and ordering equivalence must agree with equality whenever an ordered collection or algorithm relies on that relationship.
- Keep keys stable while they are stored in hash- or order-based collections. Do not base identity on mutable, transient, locale-sensitive, randomized, or process-specific data unless that behavior is the explicit contract.
- Specify edge semantics that the language may not choose for the domain: case normalization, Unicode normalization, floating-point `NaN` and signed zero, absent values, object identity versus value equality, and tie-breaking for total order.

## Termination, fan-out, and resources

- Every loop, recursion, retry, poll, queue, stream, and background task needs a termination or cancellation condition. State maximum attempts/depth/duration where external progress is not guaranteed.
- Bound fan-out and buffering from the workload and downstream capacity. Define concurrency limits, queue capacity, backpressure, overload behavior, and who observes failures; "async" or "parallel" does not make work free.
- Pair every acquired resource with an owner and release path across success, error, cancellation, and partial initialization. Include memory, file descriptors, sockets, locks, transactions, temporary files, subscriptions, timers, threads/tasks, and external service quotas.

## Duplication and literals

- Treat duplicated literals as material when they encode the same domain fact or must change together: states, event kinds, protocol fields, units, limits, feature names, error codes, paths, header names, or serialization keys. Give those a typed value, named constant, schema, configuration entry, or single mapping at the appropriate ownership boundary.
- Do not deduplicate incidental text merely because words repeat. Logs, diagnostics, test descriptions, fixture prose, UI copy with different owners, and one-off explanatory strings may be clearer in place unless consistency, localization, policy, or coordinated change makes them domain data.
- Before extracting, say which future change the extraction keeps consistent. Before leaving material duplication, say why independent evolution is correct.

## Bounded review output

For each material finding, provide evidence, the affected workload or invariant, and at least one concrete alternative. Prefer decisions such as "use a deque because FIFO removal from this array is linear at the stated queue bound" over vague directions such as "improve performance" or "clean up abstractions." Record nonmaterial observations only when they are useful follow-up items; do not expand the task into an unbounded search for hypothetical gaps.
