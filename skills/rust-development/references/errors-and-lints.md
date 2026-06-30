# Errors and Lint Discipline

## Error Handling by Layer

| Context | Approach |
|---|---|
| Library / public API | `thiserror` — typed enums consumers can match |
| Application / `main` | `anyhow` or `color_eyre` with `.context()` / `.wrap_err()` |
| Tests | `.unwrap()` is fine — panics are the point |
| Compile-time-proven (regex literal) | `.expect("valid regex")` |
| Startup initialisation | `.expect("reason")` — fail fast |
| **Production runtime** | **Never unwrap/expect — `?` with context** |

```rust
// Library: typed errors
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("record not found: {id}")]
    NotFound { id: String },
    #[error("connection failed")]
    Connection(#[from] std::io::Error),      // From impl → automatic ?
    #[error("deserialization failed")]
    Deserialize(#[source] serde_json::Error), // chains without From
}

// Application: context on every propagation — bare ? loses the story
use anyhow::{Context, Result};

fn load_config(path: &Path) -> Result<Config> {
    let contents = std::fs::read_to_string(path)
        .context("failed to read config file")?;
    toml::from_str(&contents).context("failed to parse config")
}
```

Don't over-engineer error enums — if callers handle all variants the same
way, fewer variants or `#[error(transparent)]` wrapping is better. Never
`anyhow` in a library's public API.

`Result<T, Infallible>`: use the irrefutable pattern —
`let Ok(value) = parse_infallible(input);` — not `.unwrap()`.

## Hidden Panic Sources

| Operation | Panics when | Safe alternative |
|---|---|---|
| `&s[..n]` | n splits a UTF-8 char | `s.get(..n)`, `char_indices()` |
| `vec[i]` | out of bounds | `vec.get(i)` |
| `slice.split_at(n)` | n > len | check length first |
| integer arithmetic | overflow (debug) | `checked_*`, `saturating_*` |

Library code returns errors; `panic!` only for violated invariants that
indicate a bug. Never `.ok()` to silently discard an error you haven't
deliberately chosen to ignore.

## Clippy Configuration

```toml
[lints.rust]
unsafe_code = "forbid"

[lints.clippy]
unwrap_used = "deny"
expect_used = "warn"
pedantic = { level = "warn", priority = -1 }
must_use_candidate = "warn"
missing_errors_doc = "warn"
missing_panics_doc = "warn"
module_name_repetitions = "allow"
```

CI: `cargo clippy --all-targets --all-features -- -D warnings`. Worthwhile
restriction lints: `panic`, `todo`, `unimplemented`, `dbg_macro`,
`print_stdout` (use `tracing`).

Test modules get latitude:

```rust
#[cfg(test)]
#[expect(clippy::unwrap_used, reason = "test assertions — panics are the point")]
mod tests { /* ... */ }
```

## Fix First — the suppression hierarchy

1. **Fix the code** (~95% of lints — `collapsible_if`? collapse it).
2. **Restructure** when the lint flags real design debt
   (`too_many_arguments`, `cognitive_complexity`).
3. **Suppress only for structural constraints** you can't change —
   framework signatures, verified false positives, WIP markers.

Suppression mechanics: **always `#[expect(lint, reason = "...")]`, never
bare `#[allow]`** — expect warns when stale (self-cleaning); allow rots
silently. The reason states the structural constraint, making the
suppression reviewable:

```rust
#[expect(clippy::needless_pass_by_value, reason = "axum handler signature requires owned types")]
fn handler(body: Json<Request>) { /* ... */ }
```

Not valid reasons: "just a style lint", "more readable my way", "I'll fix
it later" — the fix is almost always smaller than the annotation.

## dead_code Rules

`#[expect(dead_code, reason = "...")]` is a mid-task WIP marker only.
**At task end, zero remain** — wire it up or delete it.

| Situation | Action |
|---|---|
| Building toward use this task | `#[expect(dead_code, reason = "wiring up in next commit")]` — temporary |
| Only tests call it | It IS dead — delete it; valuable tests refactor to live paths |
| Test infrastructure | Behind `#[cfg(test)]`, not suppressed |
| Tested now, wired later phase | `#[cfg_attr(not(test), expect(dead_code, reason = "..."))]` — still temporary |

Never `_`-prefix a serde field to silence dead_code — it changes the wire
key (see serde.md). Dead DTO fields are coupling, not schema safety —
serde ignores unknown fields; delete and comment the schema instead.
