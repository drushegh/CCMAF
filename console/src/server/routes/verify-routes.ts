/**
 * verify-routes.ts — Fastify plugin for contract:console-http-api verify endpoints.
 *
 * Registers:
 *   GET  /api/verify         → VerifyRef[]    (Ready-for-Test queue)
 *   GET  /api/verify/:task   → VerifyFile
 *   PUT  /api/verify/:task   → VerifyFile     (body: VerdictPatch[]; write-guarded)
 *
 * Plugin design:
 *   - Self-contained (no edits to server.ts required — TASK-003 runs in parallel).
 *   - The write-guard preHandler is passed in from the caller (defined in server.ts)
 *     so security config stays in one place.
 *   - Path-safety is enforced inside the io layer (resolveVerifyPath).
 *
 * IMPORTANT: Do NOT register this plugin from server.ts yet — the main session
 * wires it after TASK-003 and TASK-004 are both merged, then removes the stub
 * verify routes. See task brief for the exact lines to add/remove.
 */

import type { FastifyInstance, FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { VerifyRef, VerdictPatch } from "../types.js";
import type { VerifyFile } from "../verify/schema.js";
import { listVerifyRefs, readVerifyFile, writeVerifyFile, applyPatches } from "../verify/io.js";

export interface VerifyRoutesOptions {
  /** The write-guard preHandler from server.ts (token + origin check). */
  writeGuard: preHandlerHookHandler;
}

/**
 * Fastify plugin that registers the verify endpoints.
 *
 * Usage in server.ts (after both TASK-003 and TASK-004 are merged):
 *
 *   import verifyRoutes from "./routes/verify-routes.js";
 *   await fastify.register(verifyRoutes, { writeGuard });
 *
 * Then remove the three stub routes:
 *   - GET  /api/verify          (stub: returns [])
 *   - GET  /api/verify/:task    (stub: returns 501)
 *   - PUT  /api/verify/:task    (stub: returns 501)
 */
const verifyRoutesPlugin: FastifyPluginAsync<VerifyRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: VerifyRoutesOptions
) => {
  const { writeGuard } = opts;

  // ── GET /api/verify — list all verify files as queue entries ────────────────
  fastify.get<{ Reply: VerifyRef[] }>("/api/verify", async (_req, _reply) => {
    return listVerifyRefs();
  });

  // ── GET /api/verify/:task — read and return a single verify file ────────────
  fastify.get<{
    Params: { task: string };
    Reply: VerifyFile | { error: string };
  }>("/api/verify/:task", async (req, reply) => {
    try {
      const file = readVerifyFile(req.params.task);
      return file;
    } catch (err) {
      const e = err as { code?: string; message: string };
      if (e.code === "ENOENT") {
        void reply.code(404).send({ error: `No verify file for ${req.params.task}` });
        return;
      }
      // Invalid task id (bad format) → 400; corrupt file → 422
      const status = e.message.includes("Invalid task id") ? 400 : 422;
      void reply.code(status).send({ error: e.message });
    }
  });

  // ── PUT /api/verify/:task — apply VerdictPatch[] + write the file ──────────
  fastify.put<{
    Params: { task: string };
    Body: VerdictPatch[];
    Reply: VerifyFile | { error: string };
  }>(
    "/api/verify/:task",
    { preHandler: [writeGuard] },
    async (req, reply) => {
      const taskId = req.params.task;
      const patches = req.body;

      // Body must be an array.
      if (!Array.isArray(patches)) {
        void reply.code(400).send({ error: "Request body must be a VerdictPatch[] array" });
        return;
      }

      try {
        // Read the existing file first — sole writer reads then writes.
        const existing = readVerifyFile(taskId);
        // Apply patches (validates each patch entry; throws on bad input).
        const updated = applyPatches(existing, patches);
        // Write back (validates the full file before touching disk).
        writeVerifyFile(updated);
        // Return the updated file.
        return updated;
      } catch (err) {
        const e = err as { code?: string; message: string };
        if (e.code === "ENOENT") {
          void reply.code(404).send({ error: `No verify file for ${taskId}` });
          return;
        }
        if (e.message.includes("Invalid task id")) {
          void reply.code(400).send({ error: e.message });
          return;
        }
        // Validation failure on patch content or output file.
        void reply.code(422).send({ error: e.message });
      }
    }
  );
};

export default verifyRoutesPlugin;
