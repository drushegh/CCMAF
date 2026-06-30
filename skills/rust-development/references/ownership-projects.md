# Ownership, Unsafe, and Project Layout

## Lifetimes

Elision covers most cases: one input lifetime → applies to outputs;
`&self` → applies to outputs. Annotate only when the compiler can't infer
(multiple reference inputs feeding a reference output). Don't annotate
what elision handles — `&'a mut self` over-constrains borrows.

- **`'static` means "could live forever", not "lives forever"** — owned
  types (`String`, `Vec`) satisfy `T: 'static`. `tokio::spawn` requiring
  `'static` is solved by moving owned/cloned data in, not by leaking.
- **Scope borrows narrowly** — extract into a block or helper to release
  before further use of the data.
- **Own at API boundaries** — take `String`/`impl Into<String>` when
  storing; `Cow<'_, str>` when sometimes borrowing, sometimes allocating.
- **HRTBs** (`for<'a> F: Fn(&'a str) -> &'a str`) appear with closures
  that borrow from their arguments — "for all lifetime choices".
- **2024 edition**: `impl Trait` returns capture all in-scope lifetimes by
  default; opt out precisely with `+ use<T>` / `+ use<>` (1.82+). Old
  `Captures<'a>` workarounds can be deleted.

Fighting the borrow checker with clever lifetimes is usually the wrong
move — clone, or restructure ownership (who actually owns this data?).

## Unsafe

Default: `unsafe_code = "forbid"` in `[lints.rust]`. When genuinely needed
(FFI, proven hot paths):

- **Every block carries `// SAFETY:`** stating the invariant that makes it
  sound. Can't articulate it → it isn't safe.
- Keep blocks minimal — auditability shrinks with size.
- Prefer safe alternatives first: `from_ne_bytes`/`bytemuck`/`zerocopy`
  over `transmute`; `NonNull<T>` over nullable `*mut T`;
  `MaybeUninit` (never deprecated `mem::uninitialized`);
  `ptr::read_unaligned` for unaligned access.
- **Verify with Miri** (`cargo +nightly miri test`) — UB, use-after-free,
  leaks, races; and sanitizers (`-Z sanitizer=address|thread`) even on
  safe crates — dependencies may not be.
- 2024 edition: unsafe ops inside `unsafe fn` need their own
  `unsafe {}` block; `extern` blocks are `unsafe extern`;
  `#[no_mangle]`-style attributes become `unsafe(...)`;
  `std::env::set_var` is now unsafe.

## Project Layout

```
my_project/
├── Cargo.toml
└── src/
    ├── main.rs          # thin — calls into lib
    ├── lib.rs           # public API root
    ├── domain/          # functional core: types, validation, rules — no I/O imports
    ├── service/         # imperative shell: DB, HTTP, files
    └── handler/         # orchestration: gather → process (pure) → persist
```

The FCIS boundary is visible in signatures: returns `impl Future` / takes
a DB handle → shell; values in, values out → core. A domain module that
imports no `tokio`/`sqlx`/`reqwest` is provably pure — unit-testable with
zero mocks.

Workspaces for multi-crate projects: `[workspace.dependencies]` once,
`dep.workspace = true` in members; `crates/core` (domain), `crates/cli`,
`crates/api`.

## Edition 2024 / Recent Features Cheat Sheet

| Since | Feature |
|---|---|
| 1.75 | `async fn` in traits, RPITIT |
| 1.80 | `LazyLock`/`LazyCell` (drop `lazy_static`/`once_cell`), exclusive range patterns |
| 1.81 | `#[expect(lint)]`, `Error` in `core` |
| 1.82 | precise capture `+ use<..>` |
| 1.85 | edition 2024, async closures, `#[diagnostic::do_not_recommend]` |

2024-edition behaviour changes to know: RPIT captures all in-scope
lifetimes (above); `if let` temporaries drop earlier; `gen` is reserved;
Cargo resolves MSRV-aware. Migrate with `cargo fix --edition` before
flipping `edition = "2024"`.

```toml
[package]
edition = "2024"
rust-version = "1.85"
```

## Blessed Crates

| Need | Crate |
|---|---|
| Errors | `thiserror` (lib) / `anyhow` or `color_eyre` (app) |
| Async runtime | `tokio` (+ `tokio-util` for CancellationToken) |
| HTTP client / server | `reqwest` / `axum` |
| Serialisation | `serde` (+ `serde_with`, `optional_field`) |
| Validated newtypes | `nutype`, `aliri_braid`, `derive_more` |
| Builders | `typed_builder` or `bon` |
| Logging | `tracing` (structured; `#[instrument]`) |
| CLI | `clap` (derive mode) |
| Lazy statics | `std::sync::LazyLock` — no crate needed |
| Decimals/money | `rust_decimal` |
| Tests | `cargo-nextest`, `proptest`, `mockall`, `mockito` |
| CPU parallelism | `rayon` |

Match the repo's existing choices first; these are greenfield defaults.
