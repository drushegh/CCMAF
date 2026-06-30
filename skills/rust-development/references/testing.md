# Testing

Run with `cargo nextest run` (faster, better isolation, cleaner output);
doc tests separately via `cargo test --doc` (nextest doesn't run them).
Test behaviour, not implementation — refactoring internals shouldn't break
tests.

## The Pyramid in Rust

| Kind | Where | Access | Use for |
|---|---|---|---|
| Unit | `#[cfg(test)] mod tests` in-file | private items via `use super::*` | pure functions, conversions, validation, error cases |
| Integration | `tests/` (separate crate) | public API only | multi-module workflows, API ergonomics |
| Doc tests | `///` examples | public API | every non-obvious public fn — docs that can't rot |

If an integration test is awkward to write, the public API probably needs
work — that's signal, not friction. Shared helpers: `tests/common/mod.rs`.

## Async and Time

```rust
#[tokio::test]
async fn fetches_data() {
    let result = fetch_data("key").await;
    assert!(result.is_ok());
}

// Time-dependent tests: pause the clock — instant and deterministic
#[tokio::test(start_paused = true)]
async fn test_timeout_path() {
    tokio::time::advance(Duration::from_secs(60)).await;   // no real waiting
    // sleep(3600s) completes instantly under paused time
}
```

Never real `sleep` in tests — paused time kills both the wait and the
flake.

## Mocking — prefer real implementations

Mocks test that you *call* things, not that the system *works*. Use them
only when the real thing is slow (network/DB), has side effects
(emails, payments), or for hard-to-trigger error paths. Prefer in-memory
implementations (`HashMap` behind a trait) over mock frameworks. If FCIS
is followed (pure domain core), most logic needs no mocks at all.

```rust
// Traits: mockall
#[cfg_attr(test, mockall::automock)]
trait Database {
    fn get_user(&self, id: &UserIdRef) -> Option<User>;
}

// HTTP: mockito
let mut server = mockito::Server::new_async().await;
let mock = server.mock("GET", "/api/users")
    .with_status(200)
    .with_body(r#"{"name": "Alice"}"#)
    .create_async().await;
```

## Property-Based Testing (proptest)

Finds edge cases you wouldn't write by hand. The property catalogue:

| Property | Shape | Good for |
|---|---|---|
| Roundtrip | `decode(encode(x)) == x` | serialisation, parsing |
| Idempotence | `f(f(x)) == f(x)` | normalisation, formatting |
| Invariant | holds before and after | sorted order, length limits |
| Commutativity | `f(a,b) == f(b,a)` | merging, set ops |
| No panic | any input survives | parsers, validators |

```rust
proptest! {
    #[test]
    fn json_roundtrip(value in any::<MyType>()) {
        let json = serde_json::to_string(&value).unwrap();
        let decoded: MyType = serde_json::from_str(&json).unwrap();
        prop_assert_eq!(value, decoded);
    }

    #[test]
    fn validation_consistent(s in "\\PC{0,200}") {
        if let Ok(username) = Username::try_new(&s) {
            prop_assert_eq!(Username::try_new(username.as_str()).unwrap(), username);
        }
    }
}
```

Validated newtypes (type-design.md) are prime proptest targets: valid
inputs roundtrip, invalid inputs always reject.

## Conventions

- `.unwrap()` is fine in tests — suppress the lint per test module with
  `#[expect(clippy::unwrap_used, reason = "test assertions")]`.
- `#[should_panic(expected = "...")]` for panic paths.
- Tests are independent — no shared mutable state, no order dependence.
- Every bug fix starts with a failing regression test.
- Run a focused subset while iterating: `cargo nextest run module::` —
  full suite before completion.
