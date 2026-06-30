# Testing in .NET

## Framework Detection

Match the repo's existing framework. Markers:

| Framework | Class marker | Method markers | Parametrised |
|---|---|---|---|
| MSTest | `[TestClass]` | `[TestMethod]` | `[DataRow]` / `[DynamicData]` |
| xUnit | none (convention) | `[Fact]`, `[Theory]` | `[Theory]` + `[InlineData]` |
| NUnit | `[TestFixture]` | `[Test]` | `[TestCase]` / `[TestCaseSource]` |
| TUnit | none (convention) | `[Test]` | `[Arguments]` |

**TUnit assertions are async and must be awaited**
(`await Assert.That(x).IsEqualTo(y)`) — a forgotten `await` means the
assertion never runs and the test silently passes.

## Running Tests — VSTest vs Microsoft.Testing.Platform (MTP)

Two incompatible argument syntaxes. Detect the platform BEFORE constructing
commands. Check, in order: `dotnet --version`, `global.json`, `.csproj`,
`Directory.Build.props`, `Directory.Packages.props`.

| Signal | Means |
|---|---|
| `global.json`: `"test": { "runner": "Microsoft.Testing.Platform" }` | MTP on SDK 10+ — args passed directly, no `--` |
| `<TestingPlatformDotnetTestSupport>true` (csproj or Directory.Build.props) | MTP on SDK 8/9 — MTP args after `--` |
| Neither (Microsoft.NET.Test.Sdk + adapter) | VSTest |

**Critical cross-platform mistakes:**

| Never do | Because |
|---|---|
| `--logger trx` on MTP / `--report-trx` on VSTest | Each platform has its own TRX flag |
| `dotnet test -- --arg` on SDK 10+ | SDK 10+ takes MTP args directly |
| Omitting `--` before MTP args on SDK 8/9 | Required separator on old SDKs |
| Bare positional path on SDK 10+ | Use `--project <path>` / `--solution <path>` |
| VSTest `--filter "Class=..."` with xUnit v3 on MTP | xUnit v3 uses `--filter-class`/`--filter-method`/`--filter-trait` |
| `--blame` on MTP | MTP splits it: `--blame-crash`, `--blame-hang-timeout` |

MSBuild flags (`--framework`, `--no-build`, `--configuration`) always go
BEFORE `--` regardless of platform. Multi-TFM projects: pick one with
`--framework net8.0`. When the user names a category ("integration tests"),
translate to the framework's filter (`TestCategory=` for MSTest/NUnit,
`--filter-trait "Category=..."` for xUnit v3 on MTP) — don't run the whole
suite.

## Writing Good Tests

- **AAA structure** (Arrange-Act-Assert), visually separated.
- **Names state scenario and expectation**:
  `Add_NegativeNumber_ThrowsArgumentException` — not `Test1`.
- **Parametrise** 3+ near-identical tests (`[Theory]`/`[DataRow]`/
  `[TestCase]`); but separate tests for distinct boundary conditions (zero
  vs negative vs null) are correct, not duplicates.
- **Exception tests use framework assertions**, never try/catch:

```csharp
var ex = Assert.Throws<InvalidOperationException>(
    () => processor.ProcessOrder(emptyOrder));
Assert.Equal("Order must contain at least one item", ex.Message);
```

- Assert specific exception types with message checks — not bare
  `Assert.Throws<Exception>`.
- Mock externals (HTTP via `DelegatingHandler` override, DB via in-memory
  or test containers); don't mock types you own without cause.
- Cover failure paths and edge cases, not just the happy path; every bug
  fix starts with a failing regression test.

## Test Anti-Patterns — never write, flag when found

**Critical (false confidence):** tests with no assertions; assertions
that can't fail (`Assert.IsTrue(true)`, `Assert.AreEqual(x, x)`);
self-referential round-trip assertions on identity operations; swallowed
exceptions (`catch { }`) in tests; assert-only-in-catch (passes when
nothing throws); un-awaited async assertions (TUnit/xUnit
`Assert.ThrowsAsync` without `await` — silent pass); commented-out
assertions.

**High (flaky/painful):** `Thread.Sleep`/`Task.Delay` for synchronisation;
`DateTime.Now` without abstraction (inject `TimeProvider`); unseeded
`new Random()`; hard-coded environment paths; static mutable state across
tests; ordering dependencies; over-mocking (more setup than test);
testing private members via reflection.

**Medium:** magic values without explanation; giant multi-behaviour tests
(>~30 lines); assertion messages that restate the assertion instead of the
business meaning.

Calibrate honestly: well-written tests deserve to be called well-written —
don't inflate findings. Integration tests legitimately touch real
resources; mark them (`[TestCategory("Integration")]`, `[Trait("Category",
"Integration")]`) so they're filterable.

## Assertion Quality

Diverse assertions catch more bugs than repeated equality checks: verify
structure, exceptions, state transitions, side effects, and negatives
(what should NOT happen), not just `AreEqual` on one field. A lone
`Assert.IsNotNull(result)` is trivial — it passes without verifying
correctness. Exception-focused tests are legitimately single-assertion.

## Setup/Teardown

| Framework | Per-test setup | Per-test teardown |
|---|---|---|
| MSTest | `[TestInitialize]` / ctor | `[TestCleanup]` / `IDisposable` |
| xUnit | constructor | `IDisposable.Dispose` |
| NUnit | `[SetUp]` | `[TearDown]` |
| TUnit | `[Before(Test)]` / ctor | `[After(Test)]` / `IDisposable` |

Dispose what you create (`HttpClient`, streams, temp files). Explicit
per-test setup over shared mutable fixtures — isolation beats DRY in
tests.
