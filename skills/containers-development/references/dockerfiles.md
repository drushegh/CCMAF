# Dockerfiles

Write Dockerfiles with BuildKit (default in Docker Engine 23+). Declare the
syntax so feature parsing stays current:

```dockerfile
# syntax=docker/dockerfile:1
```

## Multi-stage structure

Separate build from runtime. The runtime stage starts from a minimal base and
receives only built artefacts.

```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-bookworm AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
USER nonroot
EXPOSE 3000
CMD ["dist/main.js"]
```

Name stages with `AS`; copy across with `COPY --from=<stage>`. Stages that
nothing depends on are skipped. Use `--target` to build an intermediate stage
(e.g. a `test` stage in CI).

## Base image selection

- Pin to a specific tag, and a digest for production:
  `FROM python:3.13-slim@sha256:…`. `:latest` is banned in committed files.
- Prefer **distroless / chiselled** runtime images (no shell, no package
  manager — minimal CVE surface), then `-slim`, then Alpine. Alpine uses musl,
  not glibc: validate native dependencies and DNS behaviour before adopting it.
- Match the architecture you deploy to. For multi-arch, build with
  `docker buildx build --platform linux/amd64,linux/arm64`.

## Layer caching and ordering

Each instruction is a layer; a changed layer invalidates all that follow.
Order least-volatile first.

- Copy dependency manifests and install **before** copying source, so code
  edits don't re-trigger dependency resolution.
- Use BuildKit cache mounts for package caches:
  `RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt`.
- Collapse related commands and clean in the same layer:

```dockerfile
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
```

## .dockerignore

Shrinks the build context and prevents secrets/junk entering the image:

```
.git
.gitignore
**/node_modules
**/__pycache__
dist
build
bin
obj
*.env
.env*
Dockerfile*
.dockerignore
**/.DS_Store
```

## Non-root user

```dockerfile
RUN groupadd --system app && useradd --system --gid app --uid 10001 app
USER 10001
```

Use a numeric UID so Kubernetes `runAsNonRoot` can verify it. Distroless
images ship a `nonroot` user (UID 65532) — `USER nonroot` or `USER 65532`.
Set ownership when copying: `COPY --chown=10001:10001 …`.

## Build-time secrets (never bake them in)

```dockerfile
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci
```

```bash
docker build --secret id=npmrc,src=$HOME/.npmrc -t app .
```

The secret is mounted only for that `RUN` and never persists in a layer.
Anti-pattern: `ARG NPM_TOKEN` / `ENV NPM_TOKEN=…` — both are recoverable from
image metadata.

## ENTRYPOINT, CMD and signals

- Use **exec form** (`["executable","arg"]`), not shell form, so the process
  is PID 1 and receives `SIGTERM` directly for graceful shutdown.
- `ENTRYPOINT` for the fixed executable, `CMD` for default, overridable args.
- If you need shell features or signal forwarding for a wrapper, add an init
  (`tini`, or `docker run --init`) — a shell-form CMD swallows signals.

## HEALTHCHECK

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/app/healthcheck"]
```

Distroless has no shell or `curl`, so ship a small health binary or rely on
orchestrator probes (Kubernetes ignores Dockerfile `HEALTHCHECK` and uses its
own probes — see `references/kubernetes.md`).

## Review checklist

Multi-stage; pinned (+digest) minimal base; non-root numeric UID;
cache-friendly ordering with cleaned package caches; `.dockerignore` present;
no secrets in layers/ARG/ENV; exec-form ENTRYPOINT/CMD; health defined; image
scanned. Lint with `hadolint Dockerfile`.
