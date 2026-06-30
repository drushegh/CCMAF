# Architecture and Frameworks

Decision-making guidance — choose for **this** context, not a default.
In an existing repo, match the established framework and structure. Ask the
user only for greenfield work where the choice is genuinely open.

## Framework Selection

```
API-first / microservices / AI-ML serving  → FastAPI (async-native, Pydantic)
Full-stack web / CMS / built-in admin      → Django (batteries included)
Trivial service / script / learning        → Flask or stdlib
Background workers                         → Celery/ARQ + any framework
```

Questions that decide it: API-only or full-stack? Admin interface needed?
Team comfortable with async? Existing infrastructure?

## Project Structure

```
Script:            main.py, utils.py, pyproject.toml

Medium API:        app/{main.py, models/, routes/, services/, schemas/}, tests/

Large application: src/myapp/{core/, api/, services/, models/}, tests/
```

Organise by layer (routes/services/models/schemas) or by feature
(`users/{routes,service,schemas}.py`) — by feature scales better for large
apps. **Business logic lives in services, never in routes/views.** Flow:
routes → services → repositories.

## FastAPI

- `async def` endpoints when using async drivers/HTTP calls; plain `def`
  for blocking work (FastAPI runs it in a threadpool automatically).
- **Dependency injection** (`Depends`) for DB sessions, auth/current user,
  config, shared resources — testable (mockable) with automatic cleanup via
  `yield` dependencies.
- Pydantic v2 models for request validation and response serialisation; the
  return type annotation becomes the response schema.
- Custom exception classes + registered exception handlers → consistent
  error format; log internals, never expose them.

## Django

- Fat models, thin views; managers for common queries; abstract base
  classes for shared fields.
- Class-based views for complex CRUD, function-based for simple endpoints;
  DRF viewsets for APIs.
- Queries: `select_related()` (FKs), `prefetch_related()` (M2M), `.only()`
  for specific fields — kill N+1s.
- Async views/middleware supported (5.0+, ASGI); ORM async support is
  limited. Use async for external API calls, Channels/WebSockets,
  high-concurrency views.

## Background Tasks

| Solution | Best for |
|---|---|
| FastAPI `BackgroundTasks` | Quick fire-and-forget, in-process, no persistence |
| Celery | Distributed, complex workflows, retries |
| ARQ | Async-native, Redis-based |
| RQ / Dramatiq | Simpler Redis queues |

Choose a real queue (Celery/ARQ) when you need persistence, retries,
distributed workers, or long-running tasks.

## Anti-Patterns

- Defaulting to one framework regardless of context
- Business logic in routes/views
- Sync libraries inside async code
- Skipping type hints on public APIs
- Ignoring N+1 queries
