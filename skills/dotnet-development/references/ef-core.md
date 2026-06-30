# EF Core

## See the Real SQL First

Before optimising, log what EF actually generates:

```csharp
optionsBuilder
    .UseSqlServer(connectionString)
    .LogTo(Console.WriteLine, LogLevel.Information)
    .EnableSensitiveDataLogging()   // parameter values — dev only!
    .EnableDetailedErrors();
```

Or via config: `"Microsoft.EntityFrameworkCore.Database.Command": "Information"`.

## N+1 — the #1 EF Performance Killer

Accessing lazy-loaded navigation properties in a loop issues one query per
row:

```csharp
// N+1: 1 query for orders + N for items
var orders = await db.Orders.ToListAsync(ct);
foreach (var order in orders) { var n = order.Items.Count; }

// Fix 1: eager load
var orders = await db.Orders.Include(o => o.Items).ToListAsync(ct);

// Fix 2: split query — avoids cartesian explosion with multiple/large Includes
var orders = await db.Orders.Include(o => o.Items).AsSplitQuery().ToListAsync(ct);

// Fix 3 (best for read paths): project exactly what's needed
var summaries = await db.Orders
    .Select(o => new OrderSummary(o.Id, o.Items.Sum(i => i.Price), o.Items.Count))
    .ToListAsync(ct);
```

Single vs split query: one `Include` level → single (default); multiple
Includes or large child collections → `AsSplitQuery()`; need point-in-time
consistency → single.

## Tracking

Change tracking has real overhead. Read-only queries:

```csharp
var products = await db.Products.AsNoTracking()
    .Where(p => p.IsActive).ToListAsync(ct);

// Read-heavy app: make NoTracking the default
options.UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking);
```

`AsNoTrackingWithIdentityResolution()` when an untracked query returns
duplicate entities and you want them deduplicated in memory.

## Compiled Queries for Hot Paths

```csharp
private static readonly Func<AppDbContext, int, Task<Order?>> GetOrderById =
    EF.CompileAsyncQuery((AppDbContext db, int id) =>
        db.Orders.Include(o => o.Items).FirstOrDefault(o => o.Id == id));

var order = await GetOrderById(db, orderId);   // skips query compilation
```

## Query Traps

| Trap | Problem | Fix |
|---|---|---|
| `ToList()` before `Where()` | Loads whole table | Filter first, materialise last |
| `Count()` to check existence | Scans all rows | `.Any()` |
| `.Include()` then `.Select()` | Include silently ignored | Projection alone fetches what it names |
| `.ToList()` inside `Select()` | Nested queries | Project all the way down |
| String concat into `FromSqlRaw` | SQL injection | `FromSqlInterpolated` (parameterised) |

## Bulk Operations (EF Core 7+)

Don't fetch-modify-save loops for set-based changes:

```csharp
await db.Products
    .Where(p => p.DiscontinuedAt < cutoff)
    .ExecuteDeleteAsync(ct);

await db.Orders
    .Where(o => o.Status == OrderStatus.Pending && o.CreatedAt < expiry)
    .ExecuteUpdateAsync(s => s.SetProperty(o => o.Status, OrderStatus.Expired), ct);
```

Note: these bypass the change tracker and SaveChanges interceptors.

## Lifetime and Hygiene

- `DbContext` is scoped (per request) — never cache or share one; don't
  keep it alive across requests.
- Lazy-loading proxies (`Microsoft.EntityFrameworkCore.Proxies`) silently
  create N+1s — prefer explicit loading strategies.
- Global query filters (`HasQueryFilter`) silently shape every query —
  check them when analysing performance; `IgnoreQueryFilters()` to bypass
  deliberately.
- Forward `CancellationToken` into every `ToListAsync` / `FirstOrDefaultAsync`
  / `SaveChangesAsync`.
- Database-side issues (missing indexes, schema) are not EF problems —
  check the query plan when SQL itself is slow.

## Validation Checklist

SQL log shows the expected query count (no N+1); read-only paths use
`AsNoTracking`; hot paths considered for compiled queries; no
client-evaluation warnings in logs; bulk changes use
`ExecuteUpdate`/`ExecuteDelete`.
