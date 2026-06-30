/**
 * shell-routes.ts — the tabbed shell + its registry feed (TASK-041, DEC-025)
 *
 * Registers:
 *   GET /shell          → the chromeless tabbed-shell HTML (one tab/iframe per console)
 *   GET /api/registry   → the machine-global console registry, secrets stripped
 *
 * `/shell` is the FRAMER, so its CSP must permit framing the loopback consoles
 * (`frame-src`); the consoles permit being framed via their own `frame-ancestors`
 * header (server.ts). `/api/registry` is read-only and loopback-only like the
 * other GET endpoints; it returns only project/port/rootPath — never the
 * shutdownToken (toShellConsoles drops it), so a browser page can't learn the
 * secret that would let it stop a console.
 *
 * contract:console-http-api, contract:console-tray-hub
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { readRegistry } from "../hub/registry.js";
import { renderShellPage, toShellConsoles } from "../shell/shell-page.js";
import type { ShellConsole } from "../shell/shell-page.js";

export const shellRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance,
) => {
  // ── GET /api/registry ───────────────────────────────────────────────────────
  // The live console list for the shell to render tabs. Read fresh per request
  // (no-state-projection); the Hub health-prunes stale files, so a momentarily
  // dead entry (hard-kill before its tab is removed) self-resolves within a poll.
  fastify.get<{ Reply: ShellConsole[] }>("/api/registry", async (_req, reply) => {
    reply.header("cache-control", "no-store");
    return toShellConsoles(readRegistry());
  });

  // ── GET /shell ──────────────────────────────────────────────────────────────
  // The chromeless tabbed shell page. Explicit route → takes precedence over the
  // SPA static/fallback handler. CSP allows framing only loopback consoles.
  fastify.get("/shell", async (_req, reply) => {
    return reply
      .code(200)
      .header("content-type", "text/html; charset=utf-8")
      .header(
        "content-security-policy",
        "default-src 'self'; " +
          "frame-src http://127.0.0.1:* http://localhost:*; " +
          "img-src 'self' data:; " +
          "style-src 'self' 'unsafe-inline'; " +
          "script-src 'self' 'unsafe-inline'",
      )
      .send(renderShellPage());
  });
};
