---
name: rust-development
description: >-
  Modern Rust (2024 edition, 1.85+) engineering standards: type-driven
  design, error handling, async/tokio, ownership, serde, testing, and lint
  discipline, with detailed topic references loaded on demand. Use this
  skill whenever any .rs file or Cargo.toml is created, edited, reviewed,
  or debugged — even if the user doesn't mention standards. Triggers
  include: writing Rust code, structs, traits, or modules; borrow checker
  or lifetime errors; "future cannot be sent between threads"; async/await,
  tokio, channels, or spawn; .unwrap() or panic review; clippy warnings;
  serde/serialisation; Cargo workspaces; unsafe code or FFI review.
---

# Rust Development

Consolidated Rust engineering standards for agents writing production code.
The rules in this file always apply. Load `references/` files only when the
task touches that topic.

## Baseline

Rust 2024 edition (1.85+) for new projects; in existing repos match the
declared `edition` and `rust-version` — never silently upgrade. Read
`Cargo.toml` (including `[lints]`), `clippy.toml`, and `rustfmt.toml`
before writing code.

## Core Principles

1. **Make illegal states unrepresentable.** Enums with data for exclusive
   states — never sets of bools that can contradict. If the compiler
   accepts it, it should be valid.
2. **Validate at construction.** Newtypes with `TryFrom`/`new() -> Result`
   — a `Port` that rejects 0 at creation never needs re-validation. Once
   constructed, always valid.
3. **Newtypes over primitives** where confusion is possible: `UserId` not
   `String`; `transfer(from: AccountId, to: AccountId)` makes swapped
   arguments a compile error. IDs are strings, not integers — you don't do
   maths on them. Money is `rust_decimal`, never floats.
4. **Enums over bools** in signatures — `Priority::Urgent` reads;
   `send_email(addr, true, false)` doesn't.
5. **Functional core, imperative shell.** Pure domain logic (types,
   validation, rules) in modules that import no I/O crates; async and I/O
   at the edges; handlers gather → process (pure) → persist.

## Error Handling — non-negotiable

- **Libraries**: `thiserror` typed enums (`#[from]`/`#[source]`).
  **Applications**: `anyhow`/`color_eyre` with `.context("what you were
  doing")?` on every propagation.
- **Never `.unwrap()` or `.expect()` in production runtime code.**
  Acceptable only in: tests; compile-time-proven cases
  (`Regex::new(literal)`) with `.expect("reason")`; startup init
  (fail-fast). `Result of T, Infallible` → irrefutable `let Ok(x) = ...;`,
  not unwrap.
- **Hidden panic sources**: `vec[i]` → `.get(i)`; `&s[..n]` splits UTF-8 →
  `s.get(..n)`/`char_indices()`; integer overflow → `checked_*`/
  `saturating_*`; `split_at` past len.
- Never swallow errors with `.ok()` without a deliberate, commented
  reason. Details: [references/errors-and-lints.md](references/errors-and-lints.md).

## Tooling

```bash
cargo clippy --all-targets -- -D warnings   # the bar; never bare cargo check
cargo fmt
cargo nextest run                            # faster, better isolation (cargo test fallback)
cargo test --doc                             # nextest doesn't run doc tests
```

```toml
# Cargo.toml [lints] baseline for new projects
[lints.rust]
unsafe_code = "forbid"          # relax only for genuine FFI/perf crates

[lints.clippy]
unwrap_used = "deny"
expect_used = "warn"
pedantic = { level = "warn", priority = -1 }
```

**Lint discipline — fix first.** The answer to a lint is to fix the code
(~95% of cases), restructure if it signals design debt, and suppress only
for structural constraints — always `#[expect(lint, reason = "...")]`,
never bare `#[allow]` (expect self-cleans; allow rots). `dead_code`
suppressions are WIP markers: **zero remain at task end** — wire it up or
delete it. Code only used by tests IS dead code.

## Critical Pitfalls — always check

```rust
// 1. MutexGuard across .await — deadlock + !Send. Scope it:
let value = {
    let guard = mutex.lock().unwrap();
    guard.clone()
};                              // guard dropped
do_async(value).await;          // tokio::sync::Mutex only if you truly must hold

// 2. Blocking the async runtime (>100µs without .await)
let result = tokio::task::spawn_blocking(|| heavy_sync_work()).await?;

// 3. Untracked spawns — lost errors, no shutdown control
let mut set = tokio::task::JoinSet::new();
set.spawn(do_work());           // not bare tokio::spawn(...)

// 4. Wildcard match on your own enum — silently absorbs new variants
match state { State::A => a(), State::B => b() }   // no `_ =>`
```

Also: unbounded channels (no backpressure — bound them and handle full);
`Rc`/`RefCell` in spawned tasks (`Arc`/`Mutex` or `spawn_local`); serde
`Option of T` without `#[serde(default)]` when the key may be absent (null
and missing are different code paths); `_`-prefixing serde fields (changes
the wire key — silently breaks deserialisation); no timeout on network
operations (`tokio::time::timeout`).

## Anti-Rationalization — STOP before you...

| You're about to... | Instead |
|---|---|
| `.unwrap()` because "it can't fail here" | Prove it with `.expect("why")`, or use `?` |
| Skip a newtype because "it's just a String" | The boilerplate is the point — it prevents bugs |
| Hold a lock across await because "it's quick" | Clone, drop guard, then await |
| Suppress a lint because "more readable my way" | The idiom is less *familiar*, not less readable — fix it |
| Add `_ =>` because "don't want to update every match" | That's exactly why exhaustive matching exists |
| Write `unsafe` without a `// SAFETY:` comment | If you can't articulate the invariant, it isn't safe |
| Keep a dead DTO field because "matches the schema" | Serde ignores unknown fields — delete it, comment the schema |

## Agent Workflow Rules

1. **Read project config first**: `Cargo.toml` `[lints]`, `clippy.toml`,
   edition, MSRV, existing patterns. Some repos run stricter agent
   profiles (e.g. banned iterator chains, mandatory `for` loops) — follow
   the repo's rules when they exist; this skill's defaults are standard
   idiomatic Rust.
2. **Clone to make progress, then reassess.** Fighting the borrow checker
   with increasingly clever lifetimes wastes time — a `.clone()` with a
   `// PERF: clone acceptable here` note beats a wrong abstraction. But
   repeated clones of large data signal a design problem: restructure
   ownership.
3. **Compile early and often** — `cargo clippy` after each meaningful
   unit; Rust's compiler is the fastest feedback loop you have.
4. **Before completion**: `cargo clippy --all-targets -- -D warnings`,
   `cargo fmt`, `cargo nextest run` + `cargo test --doc`; zero
   `dead_code`/WIP suppressions; no stray `dbg!`/`println!` debugging.
5. **Unsafe code**: avoid unless genuinely required (FFI, proven hot
   path); every block gets `// SAFETY:` documenting the invariant; run
   Miri on crates containing unsafe.

## Reference Index

| Load when the task involves... | File |
|---|---|
| Newtypes, validation, typestate, enums, illegal states | [references/type-design.md](references/type-design.md) |
| Public APIs: builders, naming, Into/AsRef, sealed traits, visibility | [references/api-design.md](references/api-design.md) |
| Error types, thiserror/anyhow, clippy config, lint suppression rules | [references/errors-and-lints.md](references/errors-and-lints.md) |
| async/tokio: select, channels, spawn, mutexes, cancellation, Send/Sync | [references/async.md](references/async.md) |
| Serde: attributes, null-vs-missing, enums, zero-copy, PATCH semantics | [references/serde.md](references/serde.md) |
| Writing or running tests, mocking, property testing | [references/testing.md](references/testing.md) |
| Lifetimes, 'static, HRTBs, unsafe, Miri, project/workspace layout, 2024 edition | [references/ownership-projects.md](references/ownership-projects.md) |
