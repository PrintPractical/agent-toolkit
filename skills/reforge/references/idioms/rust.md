# Rust Idioms Pack

Language-specific power-checklist and smell-list for Rust projects. Loaded by `architect`, `specify`, and `implement` when `manifest.language = rust`.

## Core principle

**Use Rust's type system to make illegal states unrepresentable.** If a bug can be expressed as a type error, it should be. Rust's power is not just memory safety — it is the ability to encode invariants in types that the compiler enforces for free.

Flag any proposal that treats Rust as "C with a borrow checker." That is the primary smell.

---

## Power Checklist

These are capabilities the agent should actively look for opportunities to use. When a proposal skips one of these in favor of a more manual approach, challenge it.

### Ownership and Borrowing

- [ ] **Leverage ownership for resource management.** Types that own a resource (file handle, connection, lock guard) should drop it on destruction. Avoid manual resource release unless inside a `Drop` impl.
- [ ] **Prefer borrows over clones.** A `clone()` on the hot path is a red flag unless clearly intentional. Ask: can we borrow instead?
- [ ] **Use lifetime annotations to express real relationships, not placate the compiler.** Lifetimes that exist only to silence a borrow-checker error without expressing intent are a smell. Name them meaningfully.
- [ ] **Prefer `&str` over `&String`, `&[T]` over `&Vec<T>` in function signatures.** Accept the most general reference type.

### Error Handling

- [ ] **Use `Result<T, E>` with a meaningful error type.** Never return sentinel values (`-1`, `null`, `""`) to indicate failure. Never panic on recoverable errors in library code.
- [ ] **Define domain error types as enums.** `enum Error { NotFound, InvalidInput(String), ... }`. A single `String` error type or `Box<dyn Error>` at the boundary is acceptable; inside a component it is not.
- [ ] **Use `?` to propagate errors naturally.** Explicit `match` on `Err` only when the error handling is non-trivial.
- [ ] **Use `anyhow` or `thiserror` appropriately.** `thiserror` for library errors (stable, typed API). `anyhow` for application/binary error handling (ergonomic, contextual). Do not mix.

### Types and Enums

- [ ] **Use newtypes to prevent primitive obsession.** `struct UserId(u64)` instead of passing raw `u64`. The compiler then prevents mixing up IDs of different types.
- [ ] **Model state as enums, not booleans + optional fields.** A `bool is_authenticated` combined with an `Option<User> user` that is only valid when `is_authenticated` is true is a type smell. Use `enum AuthState { Anonymous, Authenticated(User) }`.
- [ ] **Exhaust enum matches.** Avoid `_ => { /* ignore */ }` for enums you own. Every variant should be deliberate.
- [ ] **Use `#[non_exhaustive]` on public enums that may grow.** Prevents downstream code from matching exhaustively and breaking on new variants.

### Iterators and Collections

- [ ] **Prefer iterator combinators over manual loops.** `iter().filter().map().collect()` is clearer than a for loop with a mutable accumulator. Challenge manual loops.
- [ ] **Use `collect()` with type inference.** Let the type system drive collection shape.
- [ ] **Use `Entry` API for conditional HashMap updates.** `map.entry(k).or_insert_with(|| v)` instead of a get-then-insert pattern.
- [ ] **Avoid unnecessary intermediate collections.** Chain iterators lazily; only collect when the end consumer needs ownership.

### Concurrency

- [ ] **Use `Arc<Mutex<T>>` (or `Arc<RwLock<T>>`) only when shared mutation is genuinely required.** If data flows in one direction, channels (`mpsc`) are cleaner.
- [ ] **Use typed channels for inter-task communication.** `mpsc::channel::<Message>()` where `Message` is an enum of all possible messages.
- [ ] **Use `tokio` (or `async-std`) consistently — do not mix async runtimes.** One runtime per binary.
- [ ] **Avoid `unwrap()` and `expect()` in async contexts.** A panic in an async task silently drops the task in many executors. Use `?` or handle explicitly.

### Traits and Generics

- [ ] **Implement standard traits where they fit:** `Display`, `Debug`, `From/Into`, `Iterator`, `Default`. These integrate with the ecosystem for free.
- [ ] **Use `impl Trait` in function arguments for ergonomic generics.** Prefer `fn foo(bar: impl Display)` over `fn foo<T: Display>(bar: T)` for simple cases.
- [ ] **Derive before implementing manually.** `#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]` — only write manual impls when the derived behavior is wrong.

### Unsafe

- [ ] **Isolate `unsafe` code in clearly bounded modules.** Never scatter `unsafe` blocks throughout a codebase. Encapsulate invariants behind safe APIs.
- [ ] **Document every `unsafe` block with a SAFETY comment.** `// SAFETY: <why this invariant holds>`. No exceptions.
- [ ] **Challenge any `unsafe` that is not motivated by FFI, low-level performance, or fundamental data structure implementation.** Most `unsafe` in application code is unnecessary.

---

## Smell List

These patterns indicate Rust being written like another language. Challenge them immediately.

### C-style smells

- `malloc`/`free` thinking manifesting as manual resource tracking instead of RAII types
- Functions returning error codes as integers or sentinel values
- Global mutable state (`static mut`) instead of dependency injection
- `unsafe` pointer arithmetic where slice operations would work
- Manual string allocation/copying where `String`/`&str` methods exist

### Java/OOP smells

- Deep inheritance-like hierarchies built from `Box<dyn Trait>` chains when composition or enums would work
- Factory patterns that obscure what is being constructed — Rust's `::new()` conventions are clear
- Getter/setter methods on structs with private fields when the struct can simply be `pub` with direct field access
- Interfaces (`trait` objects) used for everything, even when generics (monomorphization) are better

### Python/dynamic smells

- `String` everywhere instead of typed enums or newtypes
- `HashMap<String, Box<dyn Any>>` for structured data instead of a typed struct
- `clone()` used liberally to avoid thinking about lifetimes
- `unwrap()` used broadly "because we know it won't fail" instead of expressing that knowledge in the type

### Async smells

- Blocking calls (`std::fs`, `std::thread::sleep`) inside async functions without `spawn_blocking`
- `Arc::clone` inside hot loops that could be avoided with message passing
- Spawning a thread per request instead of using the async executor's task model
- Holding a `Mutex` guard across an `.await` point

### General smells

- `Vec<(K, V)>` instead of `HashMap<K, V>` for lookup-heavy code
- Functions longer than ~50 lines — split into smaller, named functions
- Nested `match` blocks 3+ levels deep — extract inner matches into named functions
- `#[allow(dead_code)]` or `#[allow(unused)]` without a comment explaining why
- `todo!()`, `unimplemented!()`, or `panic!()` in paths that can be reached at runtime
