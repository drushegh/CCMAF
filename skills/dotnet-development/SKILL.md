---
name: dotnet-development
description: >-
  Modern .NET (8/9/10) and C# engineering standards, ASP.NET Core and EF
  Core patterns, testing, and agent workflow rules, with detailed topic
  references loaded on demand. Use this skill whenever any .cs, .csproj,
  .sln, or MSBuild file is created, edited, reviewed, or debugged — even if
  the user doesn't mention standards or patterns. Triggers include: writing
  C# code, Web APIs, minimal APIs, or controllers; EF Core queries or
  DbContext work; nullable reference warnings (CS8602, CS8618, any CS86xx);
  running or writing tests (MSTest/xUnit/NUnit/TUnit, dotnet test);
  Directory.Build.props, NuGet, or central package management; performance
  review of .NET code; quick C# scripts or prototypes.
---

# .NET Development

Consolidated .NET engineering standards for agents writing production C#.
Distilled from Microsoft's official dotnet/skills repo. The rules in this
file always apply. Load files from `references/` only when the task touches
that topic — do not load them speculatively.

## Baseline

Modern .NET (8 LTS / 9 / 10 LTS) with C# 12+. In existing repos, match the
established target framework, style, and conventions — never silently
upgrade or mix styles. Repo-wide settings belong in `Directory.Build.props`:

set `Nullable` and `ImplicitUsings` to enable, and `TreatWarningsAsErrors` and `EnforceCodeStyleInBuild` to true, inside a `PropertyGroup`.

## Code Standards

- **Nullable reference types enabled, warnings fixed honestly.** Never
  silence with scattered `!`, never `return null!` to keep a non-nullable
  signature — if a method can return null, its return type is `T?`. Each
  `!` is a claim the value is provably non-null; wrong claims hide
  `NullReferenceException`s. Details:
  [references/nullable-reference-types.md](references/nullable-reference-types.md).
- **`sealed record` for DTOs** — positional for responses, `init`
  properties with validation attributes for requests. Never expose EF
  entities in API contracts. Seal classes not designed for inheritance.
- **`DateTimeOffset` over `DateTime`** for timestamps — preserves offset,
  serialises unambiguously. Never `DateTime.Now` in logic (untestable,
  timezone-ambiguous); inject `TimeProvider` where time matters.
- **`CancellationToken` on every async endpoint and service method**,
  forwarded through the whole call chain (EF queries, HttpClient, etc.).
- **`async`/`await` all the way down.** Never `.Result`, `.Wait()`, or
  `.GetAwaiter().GetResult()` on async code — deadlock and thread-pool
  starvation risk. Never `async void` except event handlers.
- **DI-first**: constructor injection, interfaces for services
  (`AddScoped` (interface to implementation)), `IHttpClientFactory`
  for HTTP clients (never `new HttpClient()` per call). Lifetimes:
  singleton for stateless services, scoped for anything touching
  `DbContext`; a singleton must never capture a scoped service (captive
  dependency — stale DbContext shared across requests).
- **File-scoped namespaces, pattern matching, expression-bodied members
  where they aid clarity** — modern C#, not C# 7 idioms.
- **String comparisons explicit**: `StringComparison.Ordinal`/
  `OrdinalIgnoreCase` on `Equals`/`StartsWith`/`Contains`/`IndexOf`.

## Tooling

```bash
dotnet build                 # zero errors AND zero warnings is the bar
dotnet test                  # platform-aware — see references/testing.md
dotnet format                # style + analyzer fixes
```

Verify which test platform (VSTest vs Microsoft.Testing.Platform) and SDK
version the repo uses before constructing `dotnet test` arguments — the
syntaxes are incompatible. Details: [references/testing.md](references/testing.md).

## Decision Rules

**API style** — match the existing project (controllers vs minimal APIs);
never mix in one project. Greenfield default: minimal APIs. Details:
[references/webapi.md](references/webapi.md).

**Data access** — EF Core by default; project to DTOs with `.Select()`,
`AsNoTracking()` for read-only paths, eager-load deliberately. Details:
[references/ef-core.md](references/ef-core.md).

**Test framework** — match the repo's existing framework (MSTest, xUnit,
NUnit, TUnit). Greenfield: xUnit or MSTest are safe defaults.

**Validation boundary** — validate external input at the API boundary
(data annotations + `AddValidation()` for minimal APIs on .NET 10+, or
FluentValidation if the repo uses it); domain models enforce invariants in
constructors; DTOs crossing trust boundaries treat incoming data as
potentially null regardless of declared types.

## Critical Pitfalls — always check

```csharp
// 1. Sync-over-async — deadlocks and starves the thread pool
var result = await GetDataAsync();        // never .Result / .Wait()

// 2. N+1 queries — load related data deliberately
var orders = await db.Orders.Include(o => o.Items).ToListAsync(ct);

// 3. HttpClient lifetime — socket exhaustion
// inject via IHttpClientFactory, never new HttpClient() per request

// 4. Exposing entities from APIs — leaks navigation properties & internals
// map to sealed record DTOs in a service layer

// 5. Swallowing exceptions
catch (SpecificException ex) { logger.LogError(ex, "context"); throw; }
```

Also forbidden: secrets in code or config committed to git (use user
secrets / Key Vault / env), `catch { }`, mutable public DTOs, raw SQL via
string concatenation (use `FromSqlInterpolated` — parameterised), enum
serialised as int in new APIs (configure `JsonStringEnumConverter`).

## Error Handling

Global exception handling (`IExceptionHandler` + `AddProblemDetails()`),
not per-endpoint try/catch. All API errors return RFC 7807 Problem Details;
log internals, never put exception messages or stack traces in responses.
Custom domain exceptions map to status codes in one place. Details:
[references/webapi.md](references/webapi.md).

## Agent Workflow Rules

1. **Zero warnings, not just zero errors.** `dotnet build` warnings are
   defects; fix them properly rather than suppressing. Use clean builds
   (`--no-incremental`) when validating warning counts — incremental
   builds hide warnings in unchanged files.
2. **Inspect before writing**: check `Program.cs`, existing
   endpoints/services, `Directory.Build.props`, and `global.json` first so
   new code follows the project's established style and wiring.
3. **Behaviour-preserving vs behaviour-changing fixes are separate
   commits.** Annotation-only nullable fixes, formatting, and refactors
   must not be mixed with null guards, `?.` insertions, or logic changes.
4. **Performance**: flag anti-patterns on hot paths with severity
   calibrated to context; never recommend micro-optimisations on cold
   code. Details: [references/performance.md](references/performance.md).
5. **Before completion**: `dotnet build` (clean), `dotnet test`,
   `dotnet format --verify-no-changes`. Remove debug artefacts and
   scratch files.
6. **Quick experiments**: use file-based C# apps (`dotnet run app.cs`,
   .NET 10+) instead of scaffolding throwaway projects. Details:
   [references/csharp-scripts.md](references/csharp-scripts.md).

## Reference Index

| Load when the task involves... | File |
|---|---|
| API endpoints, DTOs, OpenAPI, error handling middleware, service layer | [references/webapi.md](references/webapi.md) |
| EF Core queries, N+1, tracking, DbContext, bulk operations | [references/ef-core.md](references/ef-core.md) |
| Writing tests, running `dotnet test`, framework/platform detection, test quality | [references/testing.md](references/testing.md) |
| Nullable warnings (CS86xx), enabling NRTs, annotation decisions | [references/nullable-reference-types.md](references/nullable-reference-types.md) |
| Performance review: async, strings, collections, LINQ, regex, memory | [references/performance.md](references/performance.md) |
| Repo structure, Directory.Build.props/targets, central package management | [references/project-setup.md](references/project-setup.md) |
| Quick C# scripts / file-based apps / prototyping | [references/csharp-scripts.md](references/csharp-scripts.md) |
| Logging, tracing, metrics, OpenTelemetry setup | [references/observability.md](references/observability.md) |
| DevExpress components: product choice, NuGet/license setup, XPO vs EF Core, XtraReports, XAF | [references/devexpress.md](references/devexpress.md) |
