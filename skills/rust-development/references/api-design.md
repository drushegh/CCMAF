# API Design

Design APIs that are hard to misuse: compile-time errors over runtime
errors, and the type system guiding callers to correct usage.

## Builders for Complex Construction

```rust
use typed_builder::TypedBuilder;   // or `bon` — both enforce required fields at compile time

#[derive(TypedBuilder)]
pub struct Request {
    url: String,                       // required — .build() won't compile without it
    #[builder(default)]
    timeout_ms: Option<u64>,
    #[builder(default = vec![])]
    headers: Vec<(String, String)>,
}
```

Builders over public-field structs for anything evolving: adding a field
with `#[builder(default)]` is non-breaking; adding a public field breaks
every constructor downstream. For simple configs, `#[derive(Default)]` +
struct-update syntax (`Config { verbose: true, ..Default::default() }`).

## Flexible Inputs

```rust
pub fn set_name(&mut self, name: impl Into<String>) { self.name = name.into(); }
pub fn read_file(path: impl AsRef<Path>) -> io::Result<String> {
    read_inner(path.as_ref())
}
fn read_inner(path: &Path) -> io::Result<String> { /* all the logic */ }
```

Parameters: `&str` not `&String`; `&[T]` not `&Vec<T>`. The inner-function
delegation pattern limits monomorphisation bloat — the generic wrapper is
thin, the logic compiles once.

## Naming (Rust API Guidelines)

| Item | Convention |
|---|---|
| Types/traits | `PascalCase` |
| Functions/modules | `snake_case` |
| Constants | `SCREAMING_SNAKE_CASE` |
| Getters | `name()`, never `get_name()` |
| Predicates | `is_`, `has_`, `can_` |

Conversion prefixes carry cost semantics: `as_` free borrow → borrow;
`to_` expensive borrow → owned; `into_` consumes self. Misusing these
misleads callers about allocation.

## Visibility

Start most-restrictive: private → `pub(super)` → `pub(crate)` → `pub` only
when external crates need it. Same for struct fields. A small public
surface is a maintainable public surface.

## Traits

- **Associated types** when one natural type per implementation
  (`trait Parser { type Output; }`); **generic parameters** when one type
  implements for many arguments (`trait Convert<T>`).
- **Sealed traits** when only your crate should implement — preserves the
  right to add methods without a breaking release:

```rust
mod private { pub trait Sealed {} }
pub trait DatabaseDriver: private::Sealed { /* ... */ }
```

- **Extension traits** to add methods to foreign types
  (`trait IteratorExt: Iterator { ... } impl<I: Iterator> IteratorExt for I {}`).
- `#[diagnostic::do_not_recommend]` (1.85+) on impls that produce
  confusing trait-resolution errors.

## Documentation

`///` docs on all public items: what it does, `# Errors` (when it returns
`Result`), `# Panics` (if it can), and a usage example — doc examples are
compiled tests, so they can't rot. Enforce with
`clippy::missing_errors_doc`/`missing_panics_doc`.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Public struct, all public fields | Builder — fields become breaking changes |
| `get_` prefixes | Drop them — `name()` |
| Many positional params | Builder, or a params struct |
| `impl Trait` everywhere on big functions | Delegate to concrete inner fn |
| Runtime state checks on ordered operations | Typestate (see type-design.md) |
