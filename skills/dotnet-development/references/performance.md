# .NET Performance Review

Severity-calibrated anti-pattern scanning. Two rules frame everything:
**only hot paths justify micro-optimisation** (never recommend changes on
cold code), and **report exact counts, not estimates** — 0 hits is a valid,
valuable finding.

## Severity Model

| Severity | Criteria | Action |
|---|---|---|
| 🔴 Critical | Deadlocks, crashes, security, >10x regressions | Must fix |
| 🟡 Moderate | 2–10x on hot paths, best practice | Fix on hot paths |
| ℹ️ Info | Applies, but path may be cold | Only if profiling shows impact |

Scale escalates: the same ℹ️ pattern appearing 11–50 times → 🟡; 50+ →
systematic codebase issue. If hot-path context is unknown, report Critical
unconditionally and Moderate with "impactful if this is a hot path".

## Async

- 🔴 `.Result` / `.Wait()` / `.GetAwaiter().GetResult()` on async code —
  deadlock and thread-pool starvation.
- 🔴 `async void` (except event handlers) — exceptions crash the process.
- 🟡 Missing `CancellationToken` propagation on I/O chains.
- ℹ️ `ConfigureAwait(false)` — library code only; not an app-code
  performance fix.
- ℹ️ `ValueTask` — only hot paths with frequent synchronous completion;
  don't recommend everywhere.

## Strings and Memory

- 🟡 `Equals`/`StartsWith`/`EndsWith`/`Contains`/`IndexOf` without
  `StringComparison` — culture-sensitive by default: both a correctness
  and a performance issue. Use `Ordinal`/`OrdinalIgnoreCase`.
- 🟡 `.ToLower()`/`.ToUpper()` for comparison — allocates; use
  `string.Equals(a, b, StringComparison.OrdinalIgnoreCase)`.
- 🟡 `+=` concatenation in loops — O(n²); use `StringBuilder` or
  `string.Join`. Count compound cases: `result += $"...{Foo().ToLower()}"`
  is multiple allocations per iteration.
- 🟡 Chained `.Replace()` calls — each allocates a full new string; count
  the chain across branches, not per line.
- ℹ️ `.Substring()` in hot paths — `AsSpan(start, length)` avoids the
  allocation.
- `Span<T>` is sync-only — use `Memory<T>` in async methods. Suggest
  `ArrayPool<T>` / `stackalloc` only with benchmark evidence; never
  `unsafe` for micro-optimisations.

## Collections and LINQ

- 🟡 `static readonly Dictionary<,>` never mutated after construction →
  `FrozenDictionary` (.NET 8+). Only if truly never mutated.
- 🟡 `new Dictionary`/`new List` rebuilt per call with constant contents —
  hoist to static.
- ℹ️ LINQ in tight loops/hot paths — foreach avoids
  enumerator/delegate overhead. **LINQ is fine on cold paths**, and since
  .NET 7 `Min`/`Max`/`Sum`/`Average` are vectorised — blanket LINQ bans
  are wrong.
- Pre-size collections when the count is known
  (`new List<T>(capacity)`).

## Regex

- 🟡 `new Regex(pattern)` per call — hoist to static.
- 🟡 Compile-time-literal patterns → `[GeneratedRegex]` source generator
  (.NET 7+). Not applicable to dynamic patterns.

## Structural

- ℹ️ Unsealed classes — `sealed` enables JIT devirtualisation (CA1852).
  Count the ratio (e.g. "3 of 185 sealed") — 0% is systematic, 80% is a
  consistency fix.
- 🟡 `new HttpClient()` per use — socket exhaustion; `IHttpClientFactory`.
  Check whether the factory is already wired before flagging.

## Serialisation and I/O

- 🟡 Reflection-based `JsonSerializer` under native AOT fails at runtime —
  source-generated `JsonSerializerContext`.
- 🟡 Sync I/O on request paths (`File.ReadAllText`, `Stream.Read`) — async
  equivalents.
- Batch database operations; see ef-core.md for query patterns.

## Measuring

```bash
dotnet-counters monitor --process-id <pid>     # live GC/threadpool/CPU counters
dotnet-trace collect --process-id <pid>        # CPU traces
```

BenchmarkDotNet for micro-benchmarks — never `Stopwatch` around a single
run in Release-mode guessing. Verify improvements with before/after
measurements; performance claims without numbers are speculation.

## Report Format

Group by severity, not file. Per finding: title + instance count, one-line
impact, locations as `File.cs:L42` list, one-line fix; code blocks only
for non-obvious transformations. Merge findings sharing one fix. Lead with
systemic issues ("80% of hot-path strings use culture-sensitive
comparison"), end with a severity/count summary table, and call out what
the code already does well.
