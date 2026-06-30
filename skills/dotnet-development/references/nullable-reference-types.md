# Nullable Reference Types

For maintaining NRT-enabled code and migrating codebases to
`<Nullable>enable</Nullable>`. Goal: zero CS86xx warnings with annotations
that tell the truth — the type system is a contract, not a warning
suppressor.

## The Golden Rules

1. **Never `return null!` (or `default!`) to keep a non-nullable return
   type.** If a method can return null by design, the return type is `T?`.
   Callers trust the signature; hiding null behind it converts a
   compile-time warning into a runtime `NullReferenceException`. Methods
   named `*OrDefault`, `Find*`, `TryGet*`, and DB `ExecuteScalar` patterns
   are nullable by definition.
2. **Don't sprinkle `!`.** Each `!` claims "provably non-null here". Use it
   only when a code path the compiler can't see guarantees it — with a
   comment saying why.
3. **Don't use `?.` as a warning fix.** Replacing `obj.Method()` with
   `obj?.Method()` silently changes behaviour (skip instead of throw).
   Only when null-tolerance is intended.
4. **Decide intended nullability first, then annotate.** Don't let warnings
   drive annotations — `?` everywhere forces pointless null checks on
   callers; `!` everywhere hides bugs.
5. **Annotation-only changes vs behaviour changes are separate commits.**
   Adding `?`/`!`/attributes is metadata; adding guards or `?.` changes
   runtime behaviour.

## Per-Warning Decision

For each CS86xx warning: **Is null a valid value here by design?** Yes →
make it nullable (`T?`). No → can you prove it's never null at this point?
Provable via invisible code path → `!` with a comment. Provable by adding
a guard → guard (separate behaviour-change commit). Not provable → it
should be nullable after all. Public API and unclear intent → ask, don't
guess.

| Warning | Meaning | Typical fix |
|---|---|---|
| CS8602 | Dereference of possibly null | Nullable upstream type, or justified `!` |
| CS8600/CS8601 | Possible null assigned to non-nullable | `?` on target if null valid |
| CS8603 | Possible null return | Return type becomes `T?` — never `null!` |
| CS8604 | Possible null argument | Nullable parameter if null valid |
| CS8618 | Non-nullable member not initialised | Initialise, `required` (C# 11+), `?`, or `= null!` for framework-set fields |
| CS8625 | Null literal to non-nullable | Make target nullable or supply a value |

## Useful Techniques

- **Framework-initialised fields**: one `= null!` on the declaration (with
  `[MemberNotNull(nameof(field))]` on the init method), not fifty `!` at
  use sites.
- **`[NotNullWhen(true)]`** on boolean helpers (`if (IsValid(x))` implies
  `x != null`) — metadata-only, removes downstream `!`.
- **`Debug.Assert(x != null)`** informs flow analysis but is stripped in
  Release — public API boundaries need `ArgumentNullException.ThrowIfNull`.
- **Unconstrained generics**: `[return: MaybeNull] T`, not `T?` (which
  turns value types into `Nullable<T>`, changing the signature).
- **LINQ `Where(x => x != null)` does not narrow** — use `.OfType<T>()`.
- **`Equals(object?)` overrides**: add `[NotNullWhen(true)]`; reference
  types implement `IEquatable<T?>`.
- **`?` on value types changes the runtime type** (`Nullable<T>`) — only
  for reference types is `?` metadata-only.

## DTOs vs Domain Models — where migrations go wrong

**DTOs/serialisation models** cross trust boundaries: deserialised data can
be null regardless of declared types. Properties nullable by default, or
enforced via `required` (C# 11+) / `[JsonRequired]` / runtime validation.
**Domain models** enforce invariants: non-nullable properties with
constructor enforcement — invalid state unrepresentable. Treating a DTO as
a domain model → runtime NREs; the reverse → needless null checks
everywhere.

## Migration Workflow (existing codebases)

1. **Preconditions**: C# 8+ (`LangVersion`), .NET Core 3.0+/.NET 5+. Stop
   and confirm with the user if retargeting is needed.
2. **Strategy**: small/medium project → enable project-wide and fix all.
   Large/active → `<Nullable>warnings</Nullable>` first, fix, then flip to
   `enable`. Very large legacy → file-by-file `#nullable enable`.
3. **Order**: dependency order — shared libraries before consumers; core
   models/DTOs/utilities before services/controllers. Fixing the centre
   eliminates cascading warnings outward. One PR per project or layer.
4. **Clean builds at every checkpoint** (`dotnet build --no-incremental`)
   — incremental builds hide warnings in unchanged files. Track the
   warning count down from the baseline.
5. **Public libraries**: record every contract change (T→T?, T?→T, new
   guards) in a breaking-changes file for release notes — `?` on a
   reference type is source-breaking for NRT-enabled consumers.
6. **Don't remove existing `ArgumentNullException` guards** — annotations
   are compile-time only; reflection, other languages, and `!` still pass
   null at runtime. Flag missing guards on public APIs as TODO comments
   rather than adding them mid-migration (behaviour change).
7. **Finish**: zero warnings, then lock in with
   `<WarningsAsErrors>nullable</WarningsAsErrors>`; audit remaining
   suppressions (`#nullable disable`, `!`, `#pragma warning disable CS86`)
   — each survivor gets a justifying comment.
