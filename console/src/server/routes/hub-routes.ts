/**
 * hub-routes.ts — the Hub flyout window + its actions (TASK-043, DEC-028)
 *
 * The Hub UI is a console-served page (the tray just opens it in a small window),
 * so the console — a privileged local node process — performs the lifecycle
 * actions a browser page can't: spawn/open/stop consoles. Machine-global: any
 * console can act on any other (it reads the full registry, incl. shutdownTokens).
 *
 * Registers:
 *   GET  /hub              → the flyout HTML (token embedded)
 *   GET  /api/hub/state    → { running, stopped, settings }   (read; no guard)
 *   POST /api/hub/open     → open a cockpit  {port} | {root}  (write-guarded)
 *   POST /api/hub/end      → stop a console  {port}           (write-guarded)
 *   POST /api/hub/start    → start a project {root}           (write-guarded)
 *
 * Writes go through the same write-guard (Origin + per-launch token) as every
 * other write; the page embeds the token. start/open-by-root are fire-and-forget
 * (the spawn is detached) — the flyout polls /api/hub/state to see the result.
 *
 * contract:console-http-api
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  preHandlerHookHandler,
} from "fastify";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readEntry, deregisterConsole, userStateDir } from "../hub/registry.js";
import { readHubState } from "../hub/hub-state.js";
import type { HubState } from "../hub/hub-state.js";
import { renderHubPage } from "../hub/hub-page.js";
import { openConsoleUrl } from "../hub/open.js";
import { start as startProject, open as openProject } from "../hub/launcher.js";
import { readSettings } from "../hub/settings.js";
import { LAUNCH_TOKEN } from "../security.js";

export interface HubRoutesOptions {
  writeGuard: preHandlerHookHandler;
  /** This console's bound port — the stable host for the one tabbed-shell window. */
  port: number;
}

/** Stop a console by port: graceful shutdown via its token, then force-kill + clean. */
async function endByPort(port: number): Promise<void> {
  const e = readEntry(port);
  if (!e) return;
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: "POST",
      headers: { "x-console-shutdown": e.shutdownToken },
      signal: AbortSignal.timeout(3000),
    });
    if (resp.ok) return;
  } catch {
    /* fall through to force-kill */
  }
  try {
    process.kill(e.pid);
  } catch {
    /* already gone */
  }
  deregisterConsole(port);
}

export const hubRoutes: FastifyPluginAsync<HubRoutesOptions> = async (
  fastify: FastifyInstance,
  opts,
) => {
  const { writeGuard, port: selfPort } = opts;

  // ── GET /hub — the flyout page ──────────────────────────────────────────────
  fastify.get("/hub", async (_req, reply) => {
    return reply
      .code(200)
      .header("content-type", "text/html; charset=utf-8")
      .header(
        "content-security-policy",
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'",
      )
      .send(renderHubPage(LAUNCH_TOKEN));
  });

  // ── GET /api/hub/state ──────────────────────────────────────────────────────
  fastify.get<{ Reply: HubState }>("/api/hub/state", async (_req, reply) => {
    reply.header("cache-control", "no-store");
    return readHubState();
  });

  // ── POST /api/hub/open — open a cockpit ─────────────────────────────────────
  // TABBED → always open the ONE shell window, hosted on THIS console (a stable
  // URL → openConsoleUrl's per-URL singleton focuses it instead of stacking a
  // second tabbed window per console). The shell tabs every running console
  // itself, so a stopped-project "Open" just needs the console started → it
  // appears as a tab. SINGLE → open that console's own cockpit window.
  fastify.post<{ Body: { port?: number; root?: string } }>(
    "/api/hub/open",
    { preHandler: [writeGuard] },
    async (req) => {
      const { port, root } = req.body ?? {};
      const s = readSettings();
      if (s.windowStyle === "tabbed") {
        if (typeof root === "string" && root) void startProject(root); // → new tab
        openConsoleUrl(`http://127.0.0.1:${selfPort}/shell`, s);
      } else if (typeof port === "number") {
        openConsoleUrl(`http://127.0.0.1:${port}`, s);
      } else if (typeof root === "string" && root) {
        void openProject(root); // ensureRunning + open (detached) — don't block
      }
      return { ok: true };
    },
  );

  // ── POST /api/hub/end — stop a console ──────────────────────────────────────
  fastify.post<{ Body: { port?: number } }>(
    "/api/hub/end",
    { preHandler: [writeGuard] },
    async (req) => {
      const { port } = req.body ?? {};
      if (typeof port === "number") await endByPort(port);
      return { ok: true };
    },
  );

  // ── POST /api/hub/start — start a project ───────────────────────────────────
  fastify.post<{ Body: { root?: string } }>(
    "/api/hub/start",
    { preHandler: [writeGuard] },
    async (req) => {
      const { root } = req.body ?? {};
      if (typeof root === "string" && root) void startProject(root); // detached
      return { ok: true };
    },
  );

  // ── POST /api/hub/quit — stop the tray Hub (the popup's Quit button) ─────────
  // The flyout can't signal the tray process directly, but it can ask its console
  // to: read the Hub's pid lockfile and kill it. Leaves consoles running (same
  // semantics as the old tray "Quit Hub"). Idempotent if the Hub is already gone.
  fastify.post("/api/hub/quit", { preHandler: [writeGuard] }, async () => {
    try {
      const pid = Number(readFileSync(join(userStateDir(), "hub.lock"), "utf8").trim());
      if (Number.isFinite(pid)) process.kill(pid);
    } catch {
      /* no Hub running / already gone */
    }
    return { ok: true };
  });
};
