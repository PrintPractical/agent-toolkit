# C++ Idioms Pack

Language-specific power-checklist and smell-list for C++ projects. Loaded by `architect`, `specify`, and `implement` when `manifest.language = cpp`.

## Core principle

**Modern C++ (C++17+) has the tools to be both safe and efficient. Use them.** The language has evolved dramatically from C++98. Code that looks like C or Java written in C++ is not idiomatic — it sacrifices safety, clarity, and performance for familiarity with a worse language. The standard library and language features exist precisely to avoid manual resource management, raw loops, and unchecked casts.

Flag any proposal that reaches for a raw pointer, a manual loop, or a `new`/`delete` pair when modern C++ eliminates the need.

---

## Power Checklist

### Resource Management (RAII)

- [ ] **Every resource is owned by an RAII type.** Files, sockets, memory, mutex locks, database connections — all wrapped in types whose destructor releases the resource. No manual resource release outside a destructor or deleter.
- [ ] **Use `std::unique_ptr` for single ownership, `std::shared_ptr` for shared ownership.** Raw owning pointers (`T*` that are `delete`d) are banned. Raw non-owning pointers (`T*`, `T&`) are fine — they observe, they don't own.
- [ ] **Use `std::lock_guard` or `std::scoped_lock` for mutex locking.** Never call `mutex.lock()` manually without a paired `mutex.unlock()` — that is an RAII violation.
- [ ] **Use `std::vector`, `std::string`, `std::array` instead of C arrays.** They manage their own memory, have bounds-checking (in debug mode), and have standard interfaces.

### Move Semantics

- [ ] **Pass large objects by value when the callee needs ownership, and let move semantics eliminate the copy.** `void process(std::vector<Data> v)` — callers can `std::move` into it.
- [ ] **Implement move constructors and move assignment for resource-owning types.** The rule of five: if you define one of (destructor, copy ctor, copy assign, move ctor, move assign), define all five.
- [ ] **Prefer `std::move` explicitly when transferring ownership.** Don't rely on implicit move — make intent clear.
- [ ] **Use `std::exchange` in move constructors** to null out the source in one expression: `ptr_ = std::exchange(other.ptr_, nullptr)`.

### const-Correctness

- [ ] **Mark all member functions that don't modify state `const`.** `size_t size() const;`
- [ ] **Pass read-only parameters by `const T&` (large types) or by value (small, cheap-to-copy types).** Never accept a `T&` for a parameter you don't intend to modify.
- [ ] **Use `const` for all local variables that are not mutated after initialization.** `const auto result = compute();` — this is the default; mutable is the exception.
- [ ] **Use `constexpr` for compile-time constants and pure functions.** `constexpr int kMaxRetries = 3;` instead of `#define` or a non-const global.

### Standard Library Usage

- [ ] **Use `<algorithm>` instead of raw loops.** `std::sort`, `std::find_if`, `std::transform`, `std::accumulate`, `std::any_of`, `std::all_of`. Challenge any manual loop that reimplements one of these.
- [ ] **Use range-based for loops over index loops.** `for (const auto& item : container)` over `for (size_t i = 0; i < container.size(); ++i)` when the index is not needed.
- [ ] **Use `std::optional<T>` instead of nullable pointers or sentinel values for optional returns.** `std::optional<User> findUser(id)` instead of `User* findUser(id)` returning `nullptr`.
- [ ] **Use `std::variant<Ts...>` for type-safe unions.** Never use raw `union` for type-polymorphic storage.
- [ ] **Use `std::string_view` for read-only string parameters.** Accepts `std::string`, `const char*`, and string literals without copying.
- [ ] **Use `std::span<T>` for non-owning array views** instead of `(T* ptr, size_t len)` pairs (C++20).

### Error Handling

- [ ] **Use exceptions for truly exceptional conditions** (construction failures, unrecoverable states). Use return values or `std::expected` (C++23) / `std::optional` for expected failure modes (not found, parse error).
- [ ] **Never throw from destructors.** Destructors that throw during stack unwinding call `std::terminate`.
- [ ] **Catch by `const` reference, not by value.** `catch (const std::exception& e)`.
- [ ] **Use RAII to guarantee cleanup in the presence of exceptions.** Never write `try { … } catch (…) { cleanup(); throw; }` when a destructor can do the cleanup.

### Type System

- [ ] **Use `enum class` instead of `enum`.** Scoped enums don't pollute the namespace and don't implicitly convert to integers.
- [ ] **Use `explicit` on single-argument constructors and conversion operators.** Prevents silent implicit conversions.
- [ ] **Use `[[nodiscard]]` on functions whose return value must not be ignored.** Error codes, resource handles, expensive computations.
- [ ] **Use structured bindings (C++17).** `auto [key, value] = *it;` over `auto key = it->first; auto value = it->second;`.
- [ ] **Prefer `auto` when the type is clear from context or verbose.** `auto it = container.find(key);` over `std::map<std::string, MyType>::iterator it = ...`.

### Object-Oriented Design

- [ ] **Prefer composition over inheritance.** Deep inheritance hierarchies are a design smell. Favor members + interfaces (`virtual` base classes with pure virtuals only).
- [ ] **Make base classes either concrete leaf types or abstract interfaces.** A non-abstract, non-final base class that is also derived from is a design smell.
- [ ] **Use `override` on all virtual overrides.** Prevents silent mismatch when base class signatures change.
- [ ] **Use `final` on classes and virtual functions that must not be overridden.**
- [ ] **Avoid virtual functions in performance-critical hot paths.** Prefer templates, `std::variant` + `std::visit`, or CRTP.

---

## Smell List

### Pre-modern C++ smells

- `new T` / `delete t` outside of a constructor/`make_unique`/`make_shared` — manual memory management in 2020+ code
- `T* arr = new T[n]; delete[] arr;` — use `std::vector<T>` instead
- `NULL` instead of `nullptr` — `NULL` is `0`, `nullptr` is a typed null pointer constant
- C-style casts `(T*)ptr` instead of `static_cast<T*>`, `reinterpret_cast<T*>` — hides intent and bypasses type system
- `#define CONSTANT 42` instead of `constexpr int kConstant = 42`
- `printf` / `scanf` in new C++ code — use `<iostream>`, `std::format` (C++20), or `fmt::format`
- Non-`const` global variables — prefer dependency injection or function-local statics

### C-style smells (as above, plus)

- Raw char arrays for strings — use `std::string` or `std::string_view`
- `memcpy`/`memset` on non-trivially-copyable types — undefined behavior
- `strlen`, `strcpy`, `strcmp` — use `std::string` methods

### Java/OOP smells

- `new` on everything — stack allocation is free and often faster
- `AbstractBaseFactoryFactory` class hierarchies — flatten with templates or `std::variant`
- Getter/setter pairs for every field — expose data directly or use meaningful methods
- Using inheritance for code reuse when composition with members would be cleaner

### Resource safety smells

- Pointer stored across a coroutine suspension point without ensuring it stays valid
- Iterator invalidation: modifying a container while iterating over it
- `shared_ptr` cycles — use `weak_ptr` to break them
- Storing `this` or a reference to a local in a lambda that outlives the scope

### Concurrency smells

- `volatile` used for thread synchronization — use `std::atomic<T>`
- `std::shared_ptr` used as the synchronization mechanism — it is thread-safe for reference counting only, not for the pointed-to data
- Race condition on `shared_ptr::use_count()` — it is not a reliable synchronization primitive
- Holding a lock while calling into unknown code (callbacks, virtual functions) — risk of deadlock

### Performance smells

- Returning large objects by value from virtual functions (forces heap allocation in some ABIs)
- `std::vector<std::vector<T>>` for a matrix — use a flat `std::vector<T>` with manual indexing
- Unnecessary copies: `for (auto item : container)` when `for (const auto& item : container)` is correct
- `std::endl` — it flushes; use `'\n'` unless a flush is intentional
