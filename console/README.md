# Project Console

A localhost cockpit that projects a project's `.claude/` framework state as a UI
— dashboard, kanban, the human-verify loop, contracts, decisions, gotchas,
findings, docs, README — and writes the author's verdicts/handback back as files
the framework's agents read on the next pass. One loopback origin (sole
Console-side writer — the agent and Tester also write `TASKS.md`/verify files
directly, as coordinate writers; the Console guards its own writes with a
lightweight optimistic-concurrency check, not a lock); a machine-global tray
**Hub** opens a small flyout over every running console. **Personal / local
use only** — no auth, no multi-tenancy, no remote access.

## Run

```bash
npm install
npm run build && npm run build:server   # SPA → dist/ ; server + Hub → dist-server/
npm run serve                           # → http://127.0.0.1:6120
npm run hub                             # the machine-global tray Hub (flyout)
```

The framework drives a project's console lifecycle via the launcher:

```bash
npm run console -- start|stop|open|restart   # idempotent; --root <project> optional
```

## Layout

- `src/app/` — React 18 SPA (the cockpit pages)
- `src/server/` — Fastify server (loopback, sole Console-side writer — see above), parsers, `routes/`
- `src/server/hub/` — the tray Hub: registry, launcher CLI, flyout, settings, openers
- `tests/` — Vitest suites

> The Console ships here as TypeScript source. Edit it under `src/` and rebuild with
> `npm run build && npm run build:server`. The framework drives its lifecycle for you
> via `tools/console.mjs` (see the framework's cold-start step 10.5).
