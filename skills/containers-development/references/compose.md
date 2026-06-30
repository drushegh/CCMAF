# Docker Compose (local development)

Compose is for **local development and single-host scenarios** — defining a
multi-container app you can bring up with one command. It is not a production
orchestrator; for that, target Kubernetes or Azure Container Apps (see
`references/azure-runtime.md`). Use the `docker compose` v2 plugin.

## File shape

The file is `compose.yaml` (preferred) or `docker-compose.yml`. The top-level
`version:` key is **obsolete and ignored** — omit it. Top-level keys:
`services` (required), `networks`, `volumes`, `secrets`, `configs`.

```yaml
name: myapp

services:
  api:
    build:
      context: .
      target: dev
    ports:
      - "8080:8080"
    environment:
      ASPNETCORE_ENVIRONMENT: Development
      ConnectionStrings__Default: Host=db;Database=app;Username=app;Password_file=/run/secrets/db_password
    env_file:
      - .env
    depends_on:
      db:
        condition: service_healthy
    networks:
      - backend
    develop:
      watch:
        - action: sync
          path: ./src
          target: /app/src
        - action: rebuild
          path: package.json
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 512M

  db:
    image: postgres:18
    environment:
      POSTGRES_DB: app
      POSTGRES_USER: app
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    volumes:
      - db_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - backend

volumes:
  db_data:

networks:
  backend:
    internal: true

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

## Patterns that matter

- **`depends_on` with `condition: service_healthy`** waits for the dependency's
  healthcheck to pass, not just for the container to start. Define a real
  `healthcheck` on stateful services so this means something.
- **Named volumes** for persistent data, never the container's writable layer.
  Bind-mount source only in development.
- **Secrets, not env vars, for credentials.** A file secret is mounted at
  `/run/secrets/<name>`; the app reads the file (`*_FILE` env conventions).
  Keep secret files out of git.
- **`develop.watch`** (`docker compose watch`) syncs source into the running
  container or rebuilds on manifest changes — fast inner loop without
  bind-mount permission headaches.
- **`profiles`** gate optional services (e.g. a `tools` or `seed` profile) so
  `docker compose up` stays lean; start them with `--profile`.
- **Internal networks** (`internal: true`) keep a tier (e.g. the database) off
  any published port. Only expose what must be reachable from the host.
- **`deploy.resources.limits`** apply under `docker compose` (the rest of
  `deploy:` is Swarm-only) — set CPU/memory so local runs mirror prod limits.

## Boundaries

- Don't model production topology in Compose and "promote" it — translate to
  manifests / Container Apps. Compose `deploy:` is not a Kubernetes spec.
- Multi-host orchestration, autoscaling, rolling updates → Kubernetes / ACA.
- Building and pushing images in CI → `devops-development`.
