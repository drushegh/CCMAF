# Plug-in Development

Grounded in Microsoft Learn's plug-in guidance and best-practice set.

## The Shape

```csharp
public class CreateAccountNickname : IPlugin
{
    // Constants and constructor-config are the ONLY allowed state
    private const string Target = "Target";
    private readonly string _config;

    public CreateAccountNickname(string unsecureConfig, string secureConfig)
    {
        _config = unsecureConfig;
    }

    public void Execute(IServiceProvider serviceProvider)
    {
        var context = (IPluginExecutionContext)serviceProvider.GetService(typeof(IPluginExecutionContext));
        var tracing = (ITracingService)serviceProvider.GetService(typeof(ITracingService));
        var factory = (IOrganizationServiceFactory)serviceProvider.GetService(typeof(IOrganizationServiceFactory));
        var service = factory.CreateOrganizationService(context.UserId);

        tracing.Trace("Stage {0}, Message {1}, Depth {2}", context.Stage, context.MessageName, context.Depth);

        if (!context.InputParameters.Contains(Target) ||
            context.InputParameters[Target] is not Entity entity)
        {
            return;
        }

        try
        {
            // business logic — fast, stateless, transactional-aware
        }
        catch (InvalidPluginExecutionException)
        {
            throw;                                    // already user-shaped
        }
        catch (Exception ex)
        {
            tracing.Trace("Unhandled: {0}", ex.ToString());
            throw new InvalidPluginExecutionException(
                "Account nickname processing failed. Contact your administrator.", ex);
        }
    }
}
```

**Stateless is the law**: the platform caches and reuses plug-in
instances across invocations — instance fields/properties create
thread-safety bugs and memory leaks (sandbox worker crashes). Per-call
state lives in the execution context only.

## Assembly Constraints

.NET Framework **4.6.2** target (Microsoft plans 4.8 runtime support
~Q4 2026 — verify before assuming); ≤ **16 MB**; **signed** (unless
using dependent-assembly packages); `Microsoft.CrmSdk.CoreAssemblies`
references are provided by the sandbox — not uploaded with you. One
assembly can hold many plug-in classes; consolidate rather than
sprawl, and keep each assembly's definition in a single solution.

## Pipeline and Registration

| Stage | Number | Use for |
|---|---|---|
| PreValidation | 10 | early rejection, outside transaction |
| PreOperation | 20 | modify the Target before save (no extra update needed) |
| PostOperation | 40 | react to saved data; ids available |

- **Sync** holds the user's operation hostage — complete fast or
  register **async** (runs after the core operation; ordering vs other
  async plugins not guaranteed).
- **Filtering attributes on every Update step** — otherwise you fire on
  every save of anything.
- Never duplicate step registrations (double-fire); minimise sync steps
  on Retrieve/RetrieveMultiple (every read pays); PreOperation
  RetrieveMultiple filters must handle ALL query types (QueryExpression,
  FetchXML, OData).
- `context.Depth` guards against recursion loops (plugin updates →
  triggers itself), but fix the design rather than just checking depth.

## Execution Context Essentials

- `InputParameters["Target"]` — the Entity/EntityReference of the
  operation. Read into early-bound via `.ToEntity<Account>()`; **never
  assign an early-bound instance back** (SerializationException).
- **Pre/Post Entity Images** — snapshots before/after the operation;
  register only the attributes you need. Pre-images replace extra
  Retrieves in Update plugins.
- `SharedVariables` — pass data between plugins in the same pipeline.
- In PreOperation, mutate the Target directly — don't call Update on the
  record being saved.

## Transactions — the rule that bites

Inside a synchronous plug-in, **any data-operation failure ends the
whole transaction**. The try/catch-and-continue pattern that works in
client apps produces "ISV code reduced the open transaction count" /
"no active transaction" errors here. If an `IOrganizationService` call
fails, the only correct move is to surface
`InvalidPluginExecutionException`. Related: **no
`ExecuteMultipleRequest`/`ExecuteTransactionRequest`** and **no
parallel threading** inside plug-ins — unsupported.

## External Calls

Allowed in sandbox (HTTPS out), but: set an explicit **`Timeout`**, set
**`KeepAlive = false`**, verify certificate chains, and remember the
2-minute plugin execution limit — anything slow belongs in async or out
of the pipeline entirely (webhooks/Service Bus via service endpoints).

## Debugging

`ITracingService.Trace(...)` everywhere meaningful — traces surface in
the Plug-in Trace Log (enable in environment settings). The **Plug-in
Profiler** (Plug-in Registration tool) captures real invocations for
local replay-debugging — the professional path for hard bugs.

## Checklist (per plug-in)

- [ ] Stateless; context-only state; constants/config exceptions only
- [ ] Registered: right message/stage/mode; filtering attributes; no dupes
- [ ] Images instead of Retrieves where possible
- [ ] All exceptions → `InvalidPluginExecutionException`, traced first
- [ ] External calls: timeout + KeepAlive=false
- [ ] Signed, ≤16MB, 4.6.2; in the solution; step activated on import
