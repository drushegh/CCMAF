# DAX Performance

## The engine model (everything follows from this)

Every query splits between the single-threaded **Formula Engine** (FE)
and the multi-threaded, compressed-scan **Storage Engine** (SE,
VertiPaq; the source itself for DirectQuery). The FE requests datacaches
from SE scans; anything the SE can't compute natively triggers a
**callback** to the FE per row, making that scan effectively
single-threaded. The whole discipline: **push work into the SE,
minimise SE scans, eliminate callbacks.** Segments are the parallelism
unit — few/skewed segments cap throughput regardless of DAX (that's a
data-layout problem, not a formula problem).

## The patterns that pay (distilled from data-goblin's DAX001–021)

```dax
-- Column predicates, not table filters; split && into separate args
CALCULATE([X], KEEPFILTERS('Product'[Category] = "Electronics"))
-- not: CALCULATE([X], FILTER('Product', ...[Category] = "Electronics"))
CALCULATETABLE('Sales', Sales[Region] = "West", Sales[Amount] > 1000)

-- Grouping: SUMMARIZECOLUMNS over ADDCOLUMNS(SUMMARIZE(...))
SUMMARIZECOLUMNS('Sales'[ProductKey], "Profit", [Profit])

-- Boolean tests without IF (kills CallbackDataID)
SUMX('Products', INT([Sales Amount] > 10000000))
-- counting rows: drop the iterator entirely
CALCULATE(COUNTROWS('Sales'), Sales[Amount] > 1000)

-- Iterate at the required grain (5 distinct rates, not 100k customers)
SUMX(VALUES(Customer[DiscountRate]),
     CALCULATE(SUM(Sales[Amount])) * Customer[DiscountRate])
```

Further high-yield rules: cache genuinely repeated expressions in
variables (and only then — see dax-authoring.md for the freezing
semantics); `COUNTROWS` over `DISTINCTCOUNT` when the column is a real
unique key; remove redundant filters; precompute iterator inputs;
inside hot iterators replace `DIVIDE` with `/` *only* with a pre-filtered
non-zero denominator; keep branch measures SE-friendly (a `SWITCH` over
measures defeats fusion when branches diverge in shape).

## Workflow for a slow measure/visual

1. **Reproduce as a standalone DAX query** (Performance Analyzer →
   copy query; or author `EVALUATE SUMMARIZECOLUMNS(...)` shaped like
   the visual).
2. **Trace it** (DAX Studio / server timings): total ms, FE vs SE split,
   SE query count, callbacks present, parallelism factor
   (SE CPU ÷ SE duration; ≈1.0 = single-threaded).
3. Classify: callbacks → rewrite (DAX007/008/018 family); many SE
   queries → fusion-defeating shape; high FE share → iterator/grain
   problems; clean trace but slow → model problem (cardinality,
   segments, relationship type), not DAX.
4. Rewrite, **prove equivalence by diffing results across contexts**,
   re-trace, keep the numbers.

## Model-side levers (when the trace says "not the DAX")

High-cardinality columns are the VertiPaq enemy: split DateTime into
Date + Time columns, reduce precision, drop unused columns, prefer
integers over strings for keys. Hidden high-cardinality columns with
`isAvailableInMDX` on still build attribute hierarchies — turn it off.
Calc columns that should be measures bloat size ~4x. Unfiltered fact
history wants incremental refresh. Aggregation tables (`alternateOf`)
serve high-grain queries from a small table while detail stays
DirectQuery/large.

## Report-query hygiene

Visual-generated queries add `__ValueFilterDM` blocks when measure
filters are applied at visual level — heavy ones belong in the measure
or slicer design. Reduce query grain (top-N + other beats scrolling
10k-row tables). Blank-suppression changes result shape — removing it
is a semantics change, not an optimisation.

Source: data-goblin/power-bi-agentic-development dax skill (tiered
DAX001–021/QRY001–004 framework, engine-internals) — load that plugin
for the full per-pattern trace guidance ·
https://learn.microsoft.com/power-bi/guidance/dax-error-functions ·
https://learn.microsoft.com/analysis-services/tabular-models/tabular-models-ssas
