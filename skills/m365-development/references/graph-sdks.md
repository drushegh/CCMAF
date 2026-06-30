# Microsoft Graph SDK Patterns (.NET / TypeScript / Python)

Construct one `GraphServiceClient` and reuse it (token caching is
internal). Pass an Azure Identity credential — never build raw HTTP
auth yourself. Verify current SDK versions in the changelogs; the full
per-language references live in the saved msgraph-sdk reference skill
(`awesome-copilot-extracts/msgraph-sdk/references/`).

## .NET (Microsoft.Graph v5+)

```csharp
using Azure.Identity;
using Microsoft.Graph;

// Azure-hosted (preferred): managed identity with local-dev fallback
var graphClient = new GraphServiceClient(new DefaultAzureCredential());

// Daemon: client credentials (prefer ClientCertificateCredential in prod)
var credential = new ClientSecretCredential(
    Environment.GetEnvironmentVariable("AZURE_TENANT_ID"),
    Environment.GetEnvironmentVariable("AZURE_CLIENT_ID"),
    Environment.GetEnvironmentVariable("AZURE_CLIENT_SECRET"));
var client = new GraphServiceClient(credential);

// Fluent calls — always $select, always async
var users = await client.Users.GetAsync(rc =>
{
    rc.QueryParameters.Select = new[] { "id", "displayName", "mail" };
    rc.QueryParameters.Filter = "accountEnabled eq true";
    rc.QueryParameters.Top = 100;
});

// Pagination
var iterator = PageIterator<User, UserCollectionResponse>.CreatePageIterator(
    client, users, u => { Process(u); return true; });
await iterator.IterateAsync();
```

Packages: `Microsoft.Graph` (5.*), `Azure.Identity`.

## TypeScript / JavaScript

```typescript
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider }
  from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import { DefaultAzureCredential } from "@azure/identity";

const authProvider = new TokenCredentialAuthenticationProvider(
  new DefaultAzureCredential(),
  { scopes: ["https://graph.microsoft.com/.default"] });
const graphClient = Client.initWithMiddleware({ authProvider });

const users = await graphClient
  .api("/users")
  .select("id,displayName,mail")
  .filter("accountEnabled eq true")
  .top(100)
  .get();
```

Packages: `@microsoft/microsoft-graph-client`, `@azure/identity`,
dev-dependency `@microsoft/microsoft-graph-types` for typings. Browser
(SPA) scenarios use `@azure/msal-browser` with auth-code+PKCE instead
of `DefaultAzureCredential`.

## Python

```python
from azure.identity.aio import DefaultAzureCredential
from msgraph import GraphServiceClient

client = GraphServiceClient(
    credentials=DefaultAzureCredential(),
    scopes=["https://graph.microsoft.com/.default"])
# Async throughout; request configuration objects carry $select/$filter.
```

Package: `msgraph-sdk` (+ `azure-identity`). The Python SDK is fully
async — structure callers accordingly.

## Cross-SDK rules

- Middleware handles retry/throttling — configure, don't bypass.
- Batch via the SDK batch request builders (20-request limit applies).
- For SPFx, do NOT bring these SDKs: use the context-provided
  `MSGraphClientV3` / `AadHttpClient` (`spfx-development.md`) — they
  handle auth via the SharePoint Online client extensibility principal.
- In Copilot Studio / Power Platform contexts, prefer the Microsoft
  Graph connector or HTTP-with-Entra actions over embedding SDKs.
