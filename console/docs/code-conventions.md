# Project Console — Code Conventions

This file is **project-owned**. Do NOT edit `.claude/framework/agent_docs/code-conventions.md` — it is framework-managed and will be overwritten on framework update.

## Styling — Tailwind v4 + `@layer components` (no injected `<style>`)

**Established:** 2026-06-23 (review round TASK-001/002; Architect-approved refactor)

### Rule

All component styles live in **`src/styles/components.css`** under `@layer components`. React components use only:

1. **Tailwind v4 utility classes** — for one-off layout values directly in JSX.
2. **Named component classes** from `components.css` — for genuinely repeated patterns (cards, list rows, stat tiles, shell chrome, kanban columns, etc.).

Do **not** inject `<style>` tags in React components (no `<style>{cssString}</style>` patterns). This was the original approach and was refactored out in the TASK-001/002 fix round.

### Tokens

All design tokens come from **`src/styles/theme.css`** which is vendored from Harvey's `@theme` block (see ECOSYSTEM.md "Design Tokens"). Never hard-code colour or spacing values — always reference a CSS custom property (`var(--surface-2)`, `var(--color-accent)`, etc.).

When updating the token source:
1. Copy the `@theme` block and `:root` OKLCH tiers from the Harvey source.
2. Update the header comment in `theme.css` with the new Harvey commit SHA.
3. Record the update in `.claude/DECISIONS.md`.

### Adding new component classes

When a pattern appears in 2+ places, extract it to `components.css` under the relevant `@layer components` block (each page/component group has its own comment section). Keep the block name consistent with the TSX class name.

---

## Logging — `console.*` (deliberate choice)

**Established:** 2026-06-23 (review finding: `logger:false` + `console.*` at ~6 sites)

### Rule

The server uses `logger: false` in Fastify (disables pino) and routes all diagnostic output through `console.*` directly. This is a **deliberate choice**, not an oversight.

**Rationale:**
- The server is a small, single-process localhost tool — not a production service.
- Pino's structured JSON output is useful in log aggregation pipelines, which this app doesn't need.
- `console.*` output is immediately readable in the tray launcher's terminal without extra tooling.
- Switching to Fastify's pino logger would require threading a logger instance through every module and changes the API at several call sites — not worth the cost for a localhost console.

**Constraint:** Keep `console.*` calls to startup, fatal errors, and meaningful lifecycle events only. Do not add debug-level `console.log` in request handlers — the absence of structured logging means noisy handler logs have no easy way to be silenced.

If this project ever moves to a multi-process or multi-user deployment, revisit and enable Fastify's logger at that time.

---

## TypeScript

- Strict mode enabled (`"strict": true` in `tsconfig.json`). All code must compile without errors.
- Use explicit return types on exported functions; inference is acceptable for internal helpers.
- Server types live in `src/server/types.ts`; shared app types alongside their component if single-use.

---

## Tray Hub (DEC-025 / DEC-028; the per-instance tray TASK-009 was retired)

**Established:** 2026-06-24 (per-instance tray) → **reshaped 2026-06-29** into one machine-global Hub. The original `src/tray/` is gone; its logic lives under `src/server/hub/` + `src/server/routes/`.

### Library: `systray2` v2.1.4

Chosen over the original `systray` (unmaintained) and Electron/Tauri shells (deferred per DEC-006/DEC-009 — a true native flyout is the Harvey-phase upgrade). MIT, minimal deps, ships a pre-built Go binary for Windows/macOS/Linux (no native compile). **Limitation:** the tray is not unit-testable (needs a live OS tray) and `systray2` only fires *menu-item* clicks — no icon-click / left-vs-right event (see GOTCHAS). So the menu is minimal (**Open Hub**) and the real UI is a window.

### CJS interop pattern (still used by the Hub)

`systray2` is CommonJS (`__esModule:true`, `exports.default`). A standard ESM `import` under `NodeNext` causes constructor-signature errors. Use `createRequire` + a cast:

```ts
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const SysTrayModule = require("systray2") as { default: SysTrayClass; ... };
const SysTray = SysTrayModule.default;
```

### Architecture (one Hub over a file registry)

N per-project **headless console servers** self-register into a per-user state dir; ONE machine-global **Hub** (single tray icon) opens a small console-served **flyout window** (`GET /hub`) that lists/controls them. No console↔hub IPC — disk is the truth. Compiled by `tsconfig.server.json` (no separate tray tsconfig).

- `src/server/hub/registry.ts` — the per-user registry + pinned ports (`registry/<port>.json`, `ports.json`, `userStateDir()`).
- `src/server/hub/launcher.ts` — `start|stop|open|restart` CLI (the framework's integration handle; `npm run console -- <verb>`).
- `src/server/hub/hub.ts` — the systray launcher: menu = Open Hub / Quit; pid-lockfile singleton; health-prune; auto-exit. `npm run hub`.
- `src/server/hub/hub-page.ts` + `routes/hub-routes.ts` — the flyout HTML + `/api/hub/{state,open,end,start,quit}`.
- `src/server/hub/open.ts` — chromeless `--app` openers (singleton via dedicated `--user-data-dir`; `bottomRightPosition`).
- `src/server/hub/settings.ts` + `hub-state.ts`, `shell/shell-page.ts` + `routes/shell-routes.ts` — settings + tabbed shell.

### Single-instance

The Hub is a singleton via a **pid lockfile** (`<userStateDir>/hub.lock`) — NOT a port bind (Windows reserves shifting port blocks → EACCES; see GOTCHAS). The flyout/cockpit windows are single-instance via Chrome's per-URL focus under a dedicated `--user-data-dir`.

---

## File layout (reference)

```
01_Project/
  src/
    main.tsx            — entry point; imports globals.css
    app/
      App.tsx           — router root
      components/
        Shell.tsx       — top-level chrome (header, nav rail, status bar)
        PageLayout.tsx  — per-page frame (title, badge, body)
      pages/            — one file per route
    server/
      server.ts         — Fastify instance + route definitions
      security.ts       — token validation, origin check, path safety
      project-root.ts   — walk-up auto-detection
      types.ts          — shared TypeScript interfaces
      routes/           — one plugin per area (state, verify, hub, shell, settings, …)
      hub/              — Tray Hub: registry, launcher (start|stop|open|restart),
                          hub (systray), hub-page (flyout), open, settings, hub-state, icon
      shell/            — the chromeless tabbed-shell page
    styles/
      globals.css       — global resets + imports chain
      theme.css         — vendored Harvey design tokens (@theme + :root)
      components.css    — @layer components (all named component classes)
  public/
    console-icon.svg    — favicon (cockpit/activity glyph, Harvey teal)
  docs/
    code-conventions.md — this file
  tests/
    smoke.test.tsx      — UI smoke (React Testing Library + jest-dom)
    server.test.ts      — server unit tests (Vitest node environment)
    registry/launcher/hub/hub-page/hub-routes/shell-*/settings-*.test.ts
                        — Tray Hub unit suites (registry, launcher CLI, flyout
                          markup + actions guard, tabbed shell, settings API)
```
