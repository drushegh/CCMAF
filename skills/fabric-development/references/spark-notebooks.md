# Spark Notebooks in Fabric

A Fabric Notebook is a workspace item, not a local Jupyter file.
Languages: PySpark (default), Scala (`%%spark`), SparkR (`%%sparkr`),
SQL (`%%sql`) — switch with magics only, never by changing the cell
language attribute.

## Context and parameters

- `notebookutils.runtime.context` — current workspace/notebook IDs,
  `defaultLakehouseId`, `isForPipeline` (branch behaviour for pipeline
  vs interactive runs).
- **Parameter cell**: mark one cell as Parameters; pipeline parameters
  overwrite its values at run time.
- `%%configure` (first cell) sets session config, default lakehouse,
  mount points, environment — parameterisable from pipelines.
- **Variable Libraries** (`notebookutils.variableLibrary.getLibrary()`)
  centralise per-environment config — the alternative to hard-coded
  paths that break on promotion.

## Paths and tables

- Relative paths resolve against the **default lakehouse**:
  `Files/landing/...`, `Tables/...`; mounted at `/lakehouse/default/`
  for plain-Python file APIs.
- Cross-lakehouse/workspace: full ABFSS paths or four-part SQL names
  (`ws.lh.schema.table`); backtick names with specials.
- A notebook without a default lakehouse bound fails on relative paths
  — bind via `metadata.dependencies.lakehouse` (REST) or the UI; job
  runs pass `defaultLakehouse` (id **and** name) in execution config.

## notebookutils — the toolbelt

| Area | Calls |
| --- | --- |
| Files | `fs.ls/cp/fastcp/mv/rm/put/head/mkdirs/exists`; `fs.mount` for ADLS/Blob as local paths |
| Secrets/tokens | `credentials.getSecret(kvUri, name)`, `credentials.getToken(audience)` — Key Vault over hard-coded secrets, always |
| Lakehouse CRUD | `lakehouse.create/get/update/delete/list/listTables/loadTable` |
| Notebook CRUD | `notebook.create/get/update/updateDefinition/delete/list` |
| Orchestration | `notebook.run(name, timeout, params)`, `notebook.runMultiple(dag)` (parallel + dependencies + retry), `notebook.exit(value)` returns to caller/pipeline |
| Session | `session.stop()` (interactive only — **never in pipeline mode**), `session.restartPython()` after `%pip install` |

`%run` inlines another notebook (shared functions); `notebook.run`
executes it as a child with its own session semantics — pick
deliberately.

## REST-created notebooks: the .ipynb gotcha

Every code cell must include `"outputs": []` and
`"execution_count": null`, or execution fails with "Job instance failed
without detail error". After `updateDefinition` returns `Succeeded`,
trust it — don't re-poll `getDefinition` (it's an LRO; adds latency for
nothing).

## Authoring rules

- Idempotent cells: `CREATE TABLE IF NOT EXISTS`, `MERGE` over blind
  `INSERT`, `mode("overwrite")` with `replaceWhere` for partition
  rewrites.
- Heavy lifting in Spark DataFrames, not collected pandas; `display()`
  for inspection, never as logic.
- `%pip install` at the top, then `session.restartPython()`; better:
  bake libraries into an **Environment** item attached to the notebook
  for reproducible runs.
- Log with Python `logging` (secret redaction is built in), surface
  row-count/schema validation per layer, and `notebookutils.notebook.exit()`
  a machine-readable result for the pipeline to branch on.
- Sessions: high-concurrency session sharing cuts startup for
  interactive work; scheduled work runs as jobs (background CU
  classification — see capacity-administration.md).

Docs: https://learn.microsoft.com/fabric/data-engineering/author-execute-notebook ·
https://learn.microsoft.com/fabric/data-engineering/notebookutils/ ·
https://learn.microsoft.com/fabric/data-engineering/lakehouse-notebook-load-data
(plus microsoft/skills-for-fabric SPARK-NOTEBOOK-AUTHORING-CORE)
