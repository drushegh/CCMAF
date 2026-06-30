# Serde

## null vs Missing Keys — the trap

`serde_json` does NOT treat `null` and an absent key the same: `null` goes
through `deserialize_option()`; a missing key is handled by the **derive
macro**, implicitly. Make the contract explicit:

```rust
#[derive(Serialize, Deserialize)]
struct ApiResponse {
    id: String,

    // Key may be absent on input AND omitted on output — symmetric
    #[serde(default, skip_serializing_if = "Option::is_none")]
    metadata: Option<Metadata>,
}
```

**Always `#[serde(default)]` on `Option<T>` where the key may be absent**
("the tests pass without it" means your test data includes the key — real
APIs omit keys). **Always pair with `skip_serializing_if`** — otherwise
`None` serialises as `"field": null`, inflating payloads and breaking
PATCH semantics.

Generic gotcha: `#[serde(default)]` on `Option<T>` with `T` a type
parameter adds a spurious `T: Default` bound — omit it there or override
with `#[serde(bound = "...")]`.

## Three-State Fields (PATCH endpoints)

`Option<T>` collapses "absent" and "null" — fatal for PATCH ("don't
touch" vs "clear it"). Use `optional_field::Field<T>`:

```rust
use optional_field::{Field, serde_optional_fields};

#[serde_optional_fields]                 // adds default + skip_serializing_if per field
#[derive(Serialize, Deserialize)]
struct EventPatch {
    enabled: Field<bool>,                // Missing = leave, Present(None) = clear, Present(Some) = set
    description: Field<String>,
}
```

## Common Attributes

```rust
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct User {
    #[serde(rename = "type")]
    user_type: String,
    #[serde(alias = "user_name", alias = "username")]
    name: String,
    #[serde(default = "default_timeout")]
    timeout_ms: u64,
    #[serde(skip)]
    internal: String,
}

fn default_timeout() -> u64 { 5000 }
```

## Enum Representations

| Style | Attribute | Wire shape |
|---|---|---|
| Externally tagged (default) | — | `{"Click": {...}}` |
| Internally tagged | `#[serde(tag = "type")]` | `{"type": "Click", ...}` — REST standard |
| Adjacently tagged | `tag = "t", content = "c"` | `{"t": "Click", "c": {...}}` |
| Untagged | `#[serde(untagged)]` | tries variants in order — slow, last resort |

Internally tagged doesn't support tuple variants.

## Validation on Deserialise

```rust
#[derive(Deserialize)]
#[serde(try_from = "String")]
struct Email(String);

impl TryFrom<String> for Email {
    type Error = &'static str;
    fn try_from(s: String) -> Result<Self, Self::Error> {
        if s.contains('@') { Ok(Email(s)) } else { Err("invalid email: missing @") }
    }
}
```

Pairs with validate-at-construction (type-design.md): deserialised data is
validated data. `serde_with` for common conversions (`DisplayFromStr`,
`NoneAsEmptyString`, `OneOrMany`).

## Zero-Copy and Performance

```rust
#[derive(Deserialize)]
struct Document<'a> {
    id: u32,
    name: &'a str,                       // borrows from input — zero copy
    #[serde(borrow)]
    title: Cow<'a, str>,                 // borrows when possible, owns when escaped
}
```

`DeserializeOwned` for data outliving the input buffer (streams).
Performance: prefer tagged over untagged; avoid `flatten` on hot paths;
`from_slice` over `from_reader`.

**`flatten` and `deny_unknown_fields` are incompatible** — on either
struct.

## Dead Fields

Declare only the fields you read — serde ignores the rest. Unread fields
are coupling: a renamed upstream column you never used breaks you for
nothing. **Never `_`-prefix a field to silence dead_code** — serde derives
the wire key from the identifier, so `_field` expects `"_field"` in the
JSON and deserialisation silently breaks. Delete the field and document
the full schema in a comment.
