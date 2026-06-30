# TMDL and PBIP: Models as Files

PBIP (Power BI Project) splits a `.pbix` into folders:
`<name>.SemanticModel/definition/` (TMDL) and `<name>.Report/definition/`
(PBIR JSON) — diffable, reviewable, git-native.

## TMDL file layout

| File | Contents |
| --- | --- |
| `model.tmdl` | model config, `ref table` entries, query groups |
| `database.tmdl` | compatibility level, model ID |
| `relationships.tmdl` | all relationships |
| `expressions.tmdl` | shared M expressions/parameters |
| `functions.tmdl` | DAX user-defined functions |
| `tables/<Name>.tmdl` | columns, measures, hierarchies, partitions |
| `roles/<Role>.tmdl` | RLS filters, members, OLS |
| `cultures/<locale>.tmdl` | translations, linguistic schema |

## Syntax rules that break models when violated

- **Indentation is semantic** — depth = nesting level. PBIP uses one
  **tab** per level (TOM serializer default); spaces are legal but never
  mix. Table properties depth 1; column/measure properties depth 2;
  multi-line DAX bodies **two levels deeper than the declaration**.
- **`///` sets the Description property** of the immediately following
  declaration — no blank line between; multiple `///` lines concatenate.
  `//` is a plain comment.
- **Quote names** containing spaces/dots/specials or starting with a
  digit: `'Product Name'`, `'1) Selected Metric'`; escape embedded
  quotes by doubling. Simple identifiers (`Product`, `_Measures`) stay
  unquoted.
- **M expressions and tables share a namespace** — `expression Sales`
  plus `table Sales` fails the load with `duplicate member`. Convention:
  suffix the expression (`Sales Query`) and reference it from the
  partition via `source = #"Sales Query"`.

```tmdl
table Product
	lineageTag: abc-123

	/// Count of distinct products in the current filter context.
	measure '# Products' =
			COUNTROWS ( VALUES ( Product[Product Name] ) )
		formatString: #,##0
		displayFolder: Measures
		lineageTag: def-456

	column 'Product Name'
		dataType: string
		lineageTag: ghi-789
		summarizeBy: none
		sourceColumn: Product Name

		annotation SummarizationSetBy = Automatic
```

Multi-line DAX alternative: triple-backtick fenced block after `=` when
indentation inside the expression matters. Dynamic format strings:
`formatStringDefinition` nested under the measure.

## Hygiene defaults when editing TMDL

| Column type | `summarizeBy` |
| --- | --- |
| keys, attributes, dates, flags | `none` |
| additive numeric facts | `sum` |
| rates/percentages (non-additive) | `none` |

- Keep `lineageTag` stable — it's the identity that survives renames;
  Desktop generates them, don't invent collisions.
- Property order convention (columns): `dataType`, `isHidden`, `isKey`,
  `displayFolder`, `lineageTag`, `summarizeBy`, `sourceColumn`,
  `sortByColumn`, then annotations.
- Root-level objects only at indent 0: `model`, `database`, `table`,
  `relationship`, `role`, `expression`, `function`, `cultureInfo`,
  `perspective`, `queryGroup`.
- After hand-editing, **open in Desktop or validate with tooling**
  before committing — TMDL errors surface at load, and a broken model
  file blocks the whole project.

## PBIR (report definition) in brief

`definition/pages/<page>/visuals/<id>/visual.json` — one file per
visual; bindings reference model objects **by name**, which is why
renames must be propagated (lineage check first). Report-level measures
found here should generally migrate into the model. Theme JSON lives in
`StaticResources/`.

## Why PBIP at all

Diffable code review for models, CI validation (BPA/schema checks on
PR), merge-friendly parallel work, and Fabric Git integration syncs the
same folder shape from the workspace. `.pbix` binaries give you none of
that. New work should default to PBIP; converting existing `.pbix` is a
File → Save as project away (one-way for source-control purposes).

Docs: https://learn.microsoft.com/power-bi/developer/projects/projects-overview ·
https://learn.microsoft.com/analysis-services/tmdl/tmdl-overview ·
https://learn.microsoft.com/power-bi/developer/projects/projects-dataset ·
https://learn.microsoft.com/power-bi/developer/projects/projects-report
