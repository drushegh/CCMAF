# Power Fx and Delegation

## Delegation — the mechanics

Power Fx delegates a query when the whole expression translates to the
data source's query language; the source filters/sorts and returns only
matching rows. If **any part** of the expression is non-delegable, nothing
is delegated: the app pulls the first **500 records** (raisable to 2,000
in Settings → Data row limit) and evaluates locally. Result: silently
wrong answers on large data — filters that miss records, aggregates over
a fraction of the table.

- Delegation warnings: yellow triangle on the control, blue squiggle in
  the formula bar. Treat as defects.
- **Test trick**: set the data row limit to 1 — anything non-delegable
  returns one record and fails tests immediately, instead of passing on
  dev data and failing at scale.
- Delegability is **per data source**: Dataverse supports the most
  (including `in`, subject to its 15-table query limit); SharePoint and
  SQL have long per-function caveat lists; Excel is barely delegable
  (~2,000 row practical cap). When data exceeds a few hundred rows and
  the source is weakly delegable, the fix is usually *move it to
  Dataverse*, not formula gymnastics.
- Dataverse specifics: `CountRows` returns a cached count (use
  `CountIf(table, True)` for exact ≤50k); aggregates cap at 50,000 rows;
  aggregates don't work on views; `FirstN` not delegable.
- Near-miss patterns: `IsBlank(col)` doesn't delegate where
  `col = Blank()` does (SQL/SharePoint); `StartsWith(col, "x")` delegates
  but `StartsWith("x", col)` doesn't. `UpdateIf`/`RemoveIf` only simulate
  delegation up to the row limit.
- Keep payloads small: filter and `ShowColumns`/explicit column selection
  at the source; galleries bound directly to a source page in 100-record
  increments — don't `ClearCollect` an entire table to "speed things up".

## Named formulas and user-defined functions

Declare shared values and logic once in `App.Formulas`:

```text
// Named constants — recalculated only when dependencies change
MaxItems = 100;
ColorPrimary = RGBA(52, 120, 246, 1);

// UDFs with typed parameters and return
GetStatusColor(status: Text): Color =
  If(
    status = "complete", Color.Green,
    status = "pending", Color.Yellow,
    Color.Gray
  );
```

Prefer named formulas over `Set` in `App.OnStart` for derived/static
values — declarative, lazily evaluated, no load-order bugs.

## Formula patterns

```text
// State: initialise in OnVisible, update sequentially with ;
OnVisible:  Set(counter, 0); Set(status, "ready")

// Conditionals — If with multiple condition/result pairs beats nesting
Text: If(status = "complete", "Done!",
         status = "pending",  "In Progress",
         "Not Started")

// Guard clauses
OnSelect: If(!IsBlank(txtName.Value), SubmitForm(frmMain))

// Strings
Text: firstName & " " & lastName
Visible: searchText <> ""
```

Gotchas with teeth:

- **Date format strings are lowercase**: `Text(d, "dddd, mmmm d, yyyy")`,
  `"hh:mm:ss"` — `MM` is not month.
- **Escaping with single quotes** when names contain spaces/specials or
  start with digits: `'Account Status'.Active`,
  `'ButtonCanvas.Appearance'.Transparent`, `DecimalPrecision.'2'`,
  `someList.'Color Tag'`.
- Behavioural chaining uses `;` — and the whole chain belongs in a `|-`
  YAML block (see canvas-apps.md).
- `Patch`/`Collect` errors: a failed create returns *blank* — check
  `Errors(DataSource)` and surface column-level messages near the field,
  record-level near Save.

## Error handling

Wrap fallible operations: `IfError(Patch(...), Notify("Save failed: " &
FirstError.Message, NotificationType.Error))`. `App.OnError` catches
unhandled errors app-wide — log, don't swallow.

Docs: https://learn.microsoft.com/power-apps/maker/canvas-apps/delegation-overview ·
https://learn.microsoft.com/power-apps/maker/canvas-apps/connections/connection-common-data-service ·
https://learn.microsoft.com/power-apps/maker/canvas-apps/small-data-payloads
