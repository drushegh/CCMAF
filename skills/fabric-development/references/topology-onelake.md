# Fabric Topology, OneLake, Auth, REST

## Hierarchy

Tenant (one per Entra tenant) → **Capacity** (F-SKU compute pool; every
workspace is assigned to one) → **Workspace** (collaboration + security
boundary) → **Item** (Lakehouse, Warehouse, Notebook, SemanticModel,
Pipeline… each with a GUID `itemId`). "My workspace" is personal — no
workspace identity, no sharing; nothing of production value lives there.

## OneLake

Tenant-wide lake; every item's data is Delta/Parquet under
`https://onelake.dfs.fabric.microsoft.com/<workspace>/<item>/...`.
Lakehouse paths split into `Tables/` (managed Delta) and `Files/`
(unmanaged). ABFSS form for Spark:
`abfss://<workspace>@onelake.dfs.fabric.microsoft.com/<lakehouse>.Lakehouse/Tables/<schema>/<table>`.

**Shortcuts** mount data without copying: internal (other
workspace/item) or external (ADLS Gen2, S3, GCS, Dataverse). Use them to
expose Gold data to consumer workspaces and to ingest already-lake-borne
data; don't chain them between medallion layers.

## Authentication

All REST calls need an Entra OAuth2 bearer token — no API keys, no SAS
for the Fabric API. **Audience must match the target**:

| Target | Scope |
| --- | --- |
| Fabric REST API | `https://api.fabric.microsoft.com/.default` |
| OneLake DFS/Blob | `https://storage.azure.com/.default` (only this) |
| Warehouse / SQL endpoint (TDS) | `https://database.windows.net/.default` |
| XMLA / Power BI REST | `https://analysis.windows.net/powerbi/api/.default` |
| KQL/Kusto | `https://kusto.kusto.windows.net/.default` |

Identities: user principal (broadest support), service principal
(requires tenant setting "Service principals can use Fabric APIs" +
admin consent), managed identity, and **workspace identity** (Fabric-
managed SPN, no secret — usable by shortcuts, pipelines, semantic
models; not for token acquisition from notebooks).

## REST essentials

Base `https://api.fabric.microsoft.com/v1`. Long-running operations
return 202 + `x-ms-operation-id`/`Location` — poll until terminal;
`Retry-After` governs both LRO polling and 429 backoff. Item CRUD:
`POST /workspaces/{id}/items` (type + displayName + optional
`creationPayload`), definitions via
`POST .../items/{id}/updateDefinition` (base64 parts). Job execution:
`POST .../items/{id}/jobs/instances?jobType=RunNotebook` (or
`Pipeline`). Discovery without a known workspace: the catalog/admin
search APIs — resolve by name, then work by GUID.

## Naming and discovery discipline

Resolve workspace and item IDs **at runtime by name**; never hard-code
GUIDs, connection strings, or regional FQDNs in notebooks, pipelines, or
docs — they differ per environment and break promotion. Centralise
per-environment values in **Variable Libraries** (notebooks read them
via `notebookutils.variableLibrary.getLibrary()`).

Docs: https://learn.microsoft.com/rest/api/fabric/articles/scopes ·
https://learn.microsoft.com/fabric/onelake/onelake-overview ·
https://learn.microsoft.com/fabric/onelake/onelake-shortcuts ·
https://learn.microsoft.com/rest/api/fabric/articles/long-running-operation
