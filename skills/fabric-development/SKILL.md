---
name: fabric-development
description: >-
  Microsoft Fabric development: OneLake, lakehouses and warehouses, Delta
  tables and V-Order, Spark notebooks and PySpark, medallion architecture,
  data pipelines and Dataflows Gen2, Direct Lake, capacities and CU
  throttling, fab CLI, and Fabric CI/CD. Use this skill whenever Fabric
  work is created, edited, reviewed, or debugged — even if the user says
  "the lakehouse", "OneLake", "a notebook", or "data engineering".
  Triggers include: lakehouse/warehouse design, bronze/silver/gold layers,
  Spark or PySpark code, Delta OPTIMIZE/VACUUM/Z-ORDER, OneLake shortcuts,
  data pipelines, Dataflows Gen2, eventstreams/KQL, Fabric REST API or fab
  CLI, capacity throttling, workspace git integration, or Direct Lake
  semantic model plumbing.
---

# Fabric Development

Consolidated Microsoft Fabric engineering for agents, grounded in
Microsoft's official skills-for-fabric repo and MS Learn. The semantic
model and report layers (DAX, TMDL, deployment of models) belong to
power-bi-development; this skill owns the data platform: storage,
compute, ingestion, orchestration, and administration.

## Everything Is Delta in OneLake

One tenant-wide lake; every item's data lives as Delta/Parquet under a
workspace path. All engines (Spark, SQL endpoint, Direct Lake, KQL via
shortcuts) read the same files — so **file layout is the performance
contract**: V-Order and right-sized files for read layers, no small-file
sprawl, no format forks.

## Medallion Non-Negotiables (from Microsoft's own skill)

- Separate lakehouse per layer; default to **separate workspaces** per
  layer for governance (single workspace only as an explicit POC choice).
- Bronze: append-only raw + metadata columns (ingestion timestamp,
  source file, batch ID), partitioned by ingestion date.
- Silver: dedup/validate/conform, schema enforcement, partition-aware
  overwrite. Never skip Silver.
- Gold: pre-aggregated, read-optimised (V-Order + Optimize Write +
  OPTIMIZE/Z-ORDER), feeding Direct Lake / SQL endpoint.
- Layers physically materialised — no shortcut chains between layers.

## The Rules That Prevent Lost Days

- **Spark cannot read external HTTP/HTTPS URLs.** Land data in
  `Files/` first (pipeline Copy activity, OneLake API, shortcut), then
  read the lakehouse path.
- **Token audiences**: Fabric API `api.fabric.microsoft.com/.default`;
  OneLake **only** `storage.azure.com/.default`; SQL endpoints
  `database.windows.net/.default`. Wrong audience = the most common 401.
- Notebooks created via REST need every code cell to carry
  `"outputs": []` and `"execution_count": null` or jobs fail with no
  useful error.
- Direct Lake validates nothing at design time — one-side relationship
  uniqueness fails **at query time**; exercise joins with a real query
  after changes.
- `VACUUM` only after checking downstream dependencies and time-travel
  needs.

## The Workspace Confirmation Rule (MANDATORY)

Before the FIRST operation that touches a workspace/capacity — item
creation, `fab` writes, pipeline runs, git sync: state the target
(workspace + capacity), verify (`fab auth status`, `fab ls`), confirm.
Once confirmed for a session+target, don't re-ask per operation.

## Capacity Awareness

CU usage is smoothed (interactive ≥5 min, background over 24h) with
bursting on top — so trouble arrives as **progressive throttling**:
overage protection (≤10 min future capacity) → 20s interactive delays →
interactive rejection (>60 min) → total rejection (>24h). A "sudden"
outage usually means accumulated background debt. Design heavy work as
background/scheduled, watch the Capacity Metrics app, and treat
sustained >100% utilisation as a sizing or design defect, not a
throttling bug. Details: references/capacity-administration.md.

## Agent Workflow Rules

- Discover, don't hard-code: resolve workspace/item IDs by name via API
  or `fab`; never bake GUIDs or FQDNs into code or docs.
- `fab` is the operational CLI: `fab auth status` first, `--help` per
  command before first use, `-f` for non-interactive runs, `fab exists`
  /`fab ls` to verify names before acting. Never delete/move without
  explicit instruction.
- Prefer notebooks for transforms, pipelines for orchestration and
  copy, Dataflows Gen2 only for low-code/self-service shaping —
  decision table in references/ingestion-orchestration.md.
- Parameterise everything per environment (Variable Libraries), and
  verify execution end-to-end: deploy → bind lakehouse → run Bronze →
  Silver → Gold → validate counts — don't stop at "notebook created".

## References

| File | Load when |
| --- | --- |
| references/topology-onelake.md | Tenant/workspace/item model, OneLake paths, auth, REST |
| references/lakehouse-medallion.md | Lakehouse anatomy, schemas, medallion patterns |
| references/spark-notebooks.md | Notebook authoring, notebookutils, sessions, jobs |
| references/delta-optimization.md | V-Order, OPTIMIZE, partitioning, Direct Lake interplay |
| references/ingestion-orchestration.md | Pipelines vs dataflows vs notebooks vs shortcuts; RTI |
| references/capacity-administration.md | Capacities, throttling, fab CLI, git/CI-CD, governance |
