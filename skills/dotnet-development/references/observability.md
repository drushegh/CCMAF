# Observability — OpenTelemetry in .NET

## Packages — exactly these

```bash
dotnet add package OpenTelemetry.Extensions.Hosting      # NOT bare OpenTelemetry — hosting has the DI integration
dotnet add package OpenTelemetry.Instrumentation.AspNetCore
dotnet add package OpenTelemetry.Instrumentation.Http
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol   # OTLP: traces + metrics + logs
```

Optional, matched to what the app actually uses:
`OpenTelemetry.Instrumentation.EntityFrameworkCore`, `...SqlClient`,
`...Runtime` (GC/threadpool metrics). Console exporter is dev-only —
never ship it.

## Program.cs — all three signals

```csharp
builder.Services.AddOpenTelemetry()
    .ConfigureResource(resource => resource
        .AddService(serviceName: builder.Environment.ApplicationName))
    .WithTracing(tracing => tracing
        .AddAspNetCoreInstrumentation(options =>
        {
            options.Filter = httpContext =>           // keep health checks out of traces
                !httpContext.Request.Path.StartsWithSegments("/healthz");
        })
        .AddHttpClientInstrumentation(options => options.RecordException = true)
        .AddSource("MyApp.Orders"))                   // must match ActivitySource names
    .WithMetrics(metrics => metrics
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddMeter("MyApp.Metrics"))                   // must match Meter names
    .WithLogging(logging => logging.IncludeScopes = true)
    .UseOtlpExporter();   // one exporter, all signals; reads OTEL_EXPORTER_OTLP_ENDPOINT (default localhost:4317)
```

`.WithLogging()` correlates ILogger output with traces automatically —
every log entry carries TraceId/SpanId. No separate log exporter wiring.

## Custom Spans

```csharp
public class OrderService(ILogger<OrderService> logger)
{
    private static readonly ActivitySource Source = new("MyApp.Orders");  // static, name matches AddSource

    public async Task<Order> ProcessOrderAsync(CreateOrderRequest request, CancellationToken ct)
    {
        using var activity = Source.StartActivity("ProcessOrder");
        activity?.SetTag("order.customer_id", request.CustomerId);
        try
        {
            var order = await DoProcessAsync(request, ct);
            activity?.SetStatus(ActivityStatusCode.Ok);
            return order;
        }
        catch (Exception ex)
        {
            activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
            // Log the exception via ILogger (trace-correlated) rather than
            // activity.RecordException — OTel is moving exception recording to logs.
            logger.LogError(ex, "Order processing failed for {CustomerId}", request.CustomerId);
            throw;
        }
    }
}
```

**#1 debugging issue: `StartActivity` returns null because the
`ActivitySource` name doesn't exactly match an `AddSource()` registration.**
Unmatched sources are silently ignored.

## Custom Metrics

Create meters via `IMeterFactory` from DI (lifetime + testability), never
`new Meter()`:

```csharp
public class OrderMetrics
{
    private readonly Counter<long> _ordersProcessed;          // only goes up
    private readonly Histogram<double> _processingDuration;   // distributions (latency)
    private readonly UpDownCounter<int> _activeOrders;        // up and down

    public OrderMetrics(IMeterFactory meterFactory)
    {
        var meter = meterFactory.Create("MyApp.Metrics");     // matches AddMeter
        _ordersProcessed = meter.CreateCounter<long>("orders.processed", "orders", "Total processed");
        _processingDuration = meter.CreateHistogram<double>("orders.processing_duration", "ms", "Processing time");
        _activeOrders = meter.CreateUpDownCounter<int>("orders.active", "orders", "In-flight orders");
    }
}
// builder.Services.AddSingleton<OrderMetrics>();
```

**Never use high-cardinality values (user IDs, request IDs, GUIDs) as
metric tags** — it explodes storage. Tags are for low-cardinality
dimensions: region, status, type.

## Propagation

HTTP propagation is automatic with `AddHttpClientInstrumentation()`. For
queues/messaging, inject/extract manually with
`Propagators.DefaultTextMapPropagator` into message headers, then start the
consumer activity with the extracted parent context
(`ActivityKind.Consumer`).

## Pitfalls

| Pitfall | Fix |
|---|---|
| No traces in backend | OTLP gRPC is port 4317, HTTP is 4318; protocol mismatch → set `OtlpExportProtocol.HttpProtobuf` |
| `StartActivity` returns null | Source name must exactly match `AddSource()` |
| Missing HttpClient spans | Register `AddHttpClientInstrumentation()` |
| Metrics cardinality explosion | Low-cardinality tags only |
| Health checks polluting traces | Filter in `AddAspNetCoreInstrumentation` |
