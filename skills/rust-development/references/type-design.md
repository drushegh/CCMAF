# Type-Driven Design

Design types so invalid data cannot be constructed and misuse doesn't
compile.

## Newtypes

```rust
// Manual — when you just need type distinction
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct UserId(String);

impl UserId {
    pub fn new(id: impl Into<String>) -> Self { Self(id.into()) }
    pub fn as_str(&self) -> &str { &self.0 }
}
```

Crate selection: `nutype` for validated/sanitised newtypes
(`#[nutype(sanitize(trim, lowercase), validate(len_char_min = 1))]`);
`aliri_braid` for string types needing owned+borrowed pairs
(`Name`/`NameRef` — take `&NameRef` in parameters); `derive_more` for
`From`/`Display`/`Into` derives (avoid deriving `Deref` on string newtypes
— it bypasses the type safety you built). Money: `rust_decimal::Decimal`,
never `f64`.

Braid gotchas: the macro generates `new(String)` — name your own
constructors `generate()` etc.; no-validator braids get infallible
`FromStr` — use `let Ok(x) = s.parse::<T>();`, not `.unwrap()`.

## Validate at Construction

```rust
use std::num::NonZeroU16;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Port(NonZeroU16);

impl TryFrom<u16> for Port {
    type Error = PortError;
    fn try_from(value: u16) -> Result<Self, Self::Error> {
        NonZeroU16::new(value).map(Port).ok_or(PortError::Zero)
    }
}
```

Validated once, trusted everywhere — no re-validation at call sites.

## Context-Carrying Types

When a value needs context to be consumed correctly (timezone, currency,
locale), embed it in the type. Method *absence* enforces category
distinctions:

```rust
pub struct LocatedTime(DateTime<chrono_tz::Tz>);   // anchored to a place
pub struct ViewerTime(DateTime<Utc>);               // viewer-relative

impl LocatedTime {
    pub fn iana_tz(&self) -> &'static str { self.0.timezone().name() }
}
// ViewerTime deliberately has no iana_tz() — misuse won't compile.
```

## Enums Over Bools

```rust
// ❌ send_email("a@b.com", true, false) — boolean blindness
// ✅ self-documenting at the call site
enum Priority { Normal, Urgent }
enum Attachment { None, Include(PathBuf) }
fn send_email(to: &EmailAddress, priority: Priority, attachment: Attachment) { /* ... */ }
```

Bools are fine as return values (`is_empty()`) — it's parameters that go
blind. Exclusive states are one enum, never parallel bools:

```rust
// ❌ is_connected + is_authenticated + is_error can contradict
// ✅ exactly one state, with state-specific data
enum ConnectionState {
    Disconnected,
    Connected,
    Authenticated { user: UserId },
    Error { reason: String },
}
```

**Match exhaustively on your own enums** — no `_ =>` arm; new variants
must break the build. Public library enums that may grow get
`#[non_exhaustive]` (forces consumers to handle future variants).

## Typestate — compile-time state machines

Operations that must happen in order become methods that only exist in the
right state:

```rust
use std::marker::PhantomData;

pub struct Connection<State> { inner: TcpStream, _state: PhantomData<State> }
pub struct Ready;
pub struct Running;

impl Connection<Ready> {
    pub fn start(self) -> Connection<Running> {
        Connection { inner: self.inner, _state: PhantomData }
    }
}
impl Connection<Running> {
    pub fn send(&mut self, data: &[u8]) -> Result<(), SendError> { /* ... */ }
    pub fn stop(self) -> Connection<Ready> {
        Connection { inner: self.inner, _state: PhantomData }
    }
}
// conn.send() before start() is a compile error — the method doesn't exist.
```

Use sparingly — the complexity is justified when invalid transitions cause
serious bugs (payments, connections, protocol states).

## RAII and Guards

Acquire in constructors, release in `Drop` — cleanup survives early
returns and panics:

```rust
struct TempFile { path: PathBuf }

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}
```

## Anti-Patterns

- **Stringly-typed code** — `fn process(cmd: &str) -> Result<String, String>`
  → typed `Command` enum and `thiserror` error enum.
- **God objects** — a struct with 10+ fields doing everything → split by
  responsibility (`UserService`, `NotificationService`).
- **Nested `Option<Result<Option<...>>>`** → flatten, or a purpose-built
  enum (`Found(T) / NotFound / Error(E)`).
- **Primitive obsession in signatures** — multiple same-typed parameters
  that could be swapped silently.
