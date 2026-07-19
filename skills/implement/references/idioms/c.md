# C Idioms Pack

Language-specific power-checklist and smell-list for C projects. Loaded by `architect`, `specify`, and `implement` when `manifest.language = c`.

## Core principle

**C gives you maximum control and zero guardrails. That power requires discipline.** The language will not protect you from resource leaks, buffer overflows, use-after-free, or undefined behavior. Every pattern in this pack exists because C lets you do the wrong thing silently. The goal is to make discipline mechanical, not heroic.

Flag any proposal that relies on programmer alertness rather than structural enforcement.

---

## Power Checklist

### Ownership and Resource Management

- [ ] **Every allocation has a paired deallocation, documented at the allocation site.** `malloc` calls should be immediately followed by a null check and should have the corresponding `free` either in the same function or explicitly handed to a documented owner. Use `/* transferred to: <owner> */` comments when ownership moves.
- [ ] **Use opaque pointer patterns for encapsulation.** Forward-declare structs in headers (`typedef struct Foo Foo;`) and define them only in the implementation file. This enforces information hiding at the compiler level.
- [ ] **Use `const` aggressively.** `const char *str`, `const MyStruct *s`. Distinguish `T const *` (pointer to const T) from `T * const` (const pointer to T). `const` in function signatures is a contract, not a hint.
- [ ] **Use `restrict` on non-aliasing pointer arguments.** Enables optimizer improvements and documents aliasing intent.
- [ ] **Use designated initializers for struct initialization.** `MyStruct s = { .field1 = val, .field2 = val };` over positional initialization. Resilient to struct field reordering.

### Error Handling

- [ ] **Establish and document a consistent error-handling convention for each module.** Options: return code (`int`, `enum ErrorCode`), out-parameter for error (`int *err`), negative errno, or a result struct. Choose one per module and stay consistent.
- [ ] **Check every return value that can fail.** `malloc`, `fopen`, `read`, `write`, `pthread_mutex_lock` — all can fail. Unchecked returns are bugs waiting to happen.
- [ ] **Use `errno` correctly.** Only check `errno` immediately after a failed syscall/library call. Reset to 0 before calls that set it when you intend to check it.
- [ ] **Propagate errors up, don't swallow them.** A function that detects an error must return it. Logging and continuing is not error handling.
- [ ] **Avoid `assert()` for runtime error handling.** `assert` is for invariants that must hold during development. It is typically compiled out in release builds. Use explicit checks and returns for production error paths.

### Memory Safety

- [ ] **Zero-initialize structs and arrays at declaration.** `MyStruct s = {0};`. Avoids reading uninitialized memory.
- [ ] **Prefer stack allocation over heap when the lifetime is clear and the size is bounded.** Heap allocation for small, fixed-lifetime objects is unnecessary complexity.
- [ ] **Use `snprintf`, not `sprintf`.** Always. No exceptions. Same for `strncpy` over `strcpy`, `strncat` over `strcat`.
- [ ] **Track buffer sizes alongside buffer pointers.** A `char *buf` is incomplete. A `char *buf, size_t buf_len` pair is complete. Never pass a buffer without its size.
- [ ] **Use `valgrind` or ASAN/UBSAN as standard practice,** not as a last resort. Enable sanitizers in debug/test builds by default.

### Concurrency (POSIX threads)

- [ ] **Protect every shared mutable resource with a mutex.** Document which mutex protects which data with `/* guarded by mutex_name */` comments.
- [ ] **Initialize mutexes statically when possible.** `pthread_mutex_t m = PTHREAD_MUTEX_INITIALIZER;`
- [ ] **Avoid holding a mutex longer than necessary.** Do work outside the critical section; only protect the data access.
- [ ] **Use condition variables correctly.** Always check the predicate in a `while` loop, not `if`, to handle spurious wakeups.

### API Design

- [ ] **Use `size_t` for sizes and counts, not `int`.** `int` overflow on 64-bit sizes is a real bug class.
- [ ] **Use `typedef enum` for flag/state values.** Named enum values are self-documenting and prevent magic numbers.
- [ ] **Separate interface (`.h`) from implementation (`.c`) cleanly.** Headers expose the minimum surface. Implementation details stay in `.c`.
- [ ] **Use `static` for internal functions.** `static` at file scope limits visibility and enables the compiler to optimize more aggressively.

---

## Smell List

### Memory smells

- `malloc` without null check — crash on OOM, undefined behavior on use
- `free` without setting pointer to `NULL` afterward — double-free risk if the pointer is reused
- `char buf[N]` without zero-initialization before passing to functions that may read it
- `strcpy`/`sprintf`/`gets` — buffer overflow as a feature
- Casting `malloc` result in C (unnecessary, masks missing `#include <stdlib.h>`)
- Using a freed pointer — use-after-free

### Error handling smells

- Ignoring return values from `malloc`, `fopen`, `read`, `write`, `close`
- `assert()` on a condition that can be false in production
- Silent swallowing: calling a function, checking nothing, continuing as if it succeeded
- Global error variable instead of returned error codes (creates race conditions in concurrent code)

### Ownership smells

- Functions that allocate and return pointers without documenting the caller's responsibility to free
- Mixed ownership: sometimes the caller frees, sometimes the callee frees, with no documentation
- Long-lived pointers into short-lived stack memory (classic stack escape bug)
- `realloc` result assigned back to the original pointer — lost on failure

### Concurrency smells

- Reading shared data without a lock, assuming "it won't change right now"
- Using `sleep()` for synchronization instead of condition variables
- Signal handlers that call non-async-signal-safe functions
- `volatile` used to implement atomics instead of `_Atomic` / `stdatomic.h`

### Portability smells

- `int` used where `int32_t` (or `size_t`, `ptrdiff_t`) is needed for cross-platform correctness
- Assuming `char` is signed or unsigned — it is implementation-defined
- `sizeof(int)` assumed to be 4
- Bit-field packing order assumed to be defined — it is implementation-defined
- Undefined behavior relied upon as if it were specified (signed integer overflow, pointer arithmetic past one-past-end)
