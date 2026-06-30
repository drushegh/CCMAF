/**
 * settings-routes.ts — Hub settings read/write API (TASK-042; window folded into
 * the Hub flyout by TASK-043)
 *
 * Registers:
 *   GET  /api/settings   → ConsoleSettings                (read; no guard)
 *   PUT  /api/settings   → ConsoleSettings (merged patch) (write-guarded)
 *
 * Settings are per-USER / machine-global (the same `settings.json` the Hub reads),
 * NOT a project file — but the PUT still goes through the write-guard (Origin +
 * per-launch token) so a stray local page can't flip the user's open-mode. The Hub
 * flyout (`/hub`) embeds the token and edits settings inline via these endpoints.
 *
 * `writeSettings` runs `normalizeSettings`, so an unknown/garbage field in the PUT
 * body is dropped rather than persisted.
 *
 * contract:console-http-api
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  preHandlerHookHandler,
} from "fastify";
import { readSettings, writeSettings } from "../hub/settings.js";
import type { ConsoleSettings } from "../hub/settings.js";

export interface SettingsRoutesOptions {
  /** The write-guard preHandler from server.ts (token + origin check). */
  writeGuard: preHandlerHookHandler;
}

export const settingsRoutes: FastifyPluginAsync<SettingsRoutesOptions> = async (
  fastify: FastifyInstance,
  opts,
) => {
  const { writeGuard } = opts;

  // ── GET /api/settings ─────────────────────────────────────────────────────
  fastify.get<{ Reply: ConsoleSettings }>("/api/settings", async (_req, reply) => {
    reply.header("cache-control", "no-store");
    return readSettings();
  });

  // ── PUT /api/settings ─────────────────────────────────────────────────────
  // Body is a partial patch; writeSettings merges over current + normalises.
  fastify.put<{ Body: Partial<ConsoleSettings> }>(
    "/api/settings",
    { preHandler: [writeGuard] },
    async (req) => {
      const patch =
        req.body && typeof req.body === "object"
          ? (req.body as Partial<ConsoleSettings>)
          : {};
      return writeSettings(patch);
    },
  );
};
