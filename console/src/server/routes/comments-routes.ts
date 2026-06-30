/**
 * comments-routes.ts — Fastify plugin for contract:console-comments-file endpoints.
 *
 * Registers:
 *   GET  /api/tasks/:id/comments  → CommentThread (empty if no file yet)
 *   POST /api/tasks/:id/comments  → CommentThread (appended; write-guarded)
 *
 * Plugin design mirrors verify-routes.ts:
 *   - Self-contained plugin; no edits to server.ts required from this file.
 *   - The write-guard preHandler is injected from server.ts so security
 *     config stays in one place.
 *   - Path-safety is enforced inside the io layer (resolveCommentsPath).
 *
 * Wiring into server.ts (to be done by the main session):
 *
 *   import { commentsRoutes } from "./routes/comments-routes.js";
 *   await fastify.register(commentsRoutes, { writeGuard });
 */

import type { FastifyInstance, FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import { readComments, appendComment } from "../comments/io.js";
import type { CommentThread } from "../comments/io.js";

export interface CommentsRoutesOptions {
  /** The write-guard preHandler from server.ts (token + origin check). */
  writeGuard: preHandlerHookHandler;
}

/**
 * Fastify plugin that registers the comment endpoints.
 *
 * Export name: commentsRoutes (named export, not default — mirrors the
 * plugin pattern used by stateRoutes / dashboardRoutes).
 */
export const commentsRoutes: FastifyPluginAsync<CommentsRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: CommentsRoutesOptions
) => {
  const { writeGuard } = opts;

  // ── GET /api/tasks/:id/comments ─────────────────────────────────────────────
  // Returns the comment thread for a task, or an empty thread if none exists.
  // 400 on bad task id.
  fastify.get<{
    Params: { id: string };
    Reply: CommentThread | { error: string };
  }>("/api/tasks/:id/comments", async (req, reply) => {
    try {
      const thread = readComments(req.params.id);
      return thread;
    } catch (err) {
      const e = err as { message: string };
      // readComments throws on bad id or corrupt file.
      if (e.message.includes("Invalid task id")) {
        void reply.code(400).send({ error: e.message });
        return;
      }
      // Corrupt file — surface as 500.
      void reply.code(500).send({ error: e.message });
      return;
    }
  });

  // ── POST /api/tasks/:id/comments ────────────────────────────────────────────
  // Body: { body: string (required, non-empty), author?: string }
  // 400 on empty body or bad id; 401/403 enforced by the writeGuard.
  fastify.post<{
    Params: { id: string };
    Body: { body: string; author?: string; statusAtComment?: string };
    Reply: CommentThread | { error: string };
  }>(
    "/api/tasks/:id/comments",
    { preHandler: [writeGuard] },
    async (req, reply) => {
      const taskId = req.params.id;
      const input = req.body;

      // Guard: body must be a non-null object (Fastify parses JSON body automatically).
      if (typeof input !== "object" || input === null) {
        void reply.code(400).send({ error: "Request body must be a JSON object" });
        return;
      }

      try {
        const updated = appendComment(taskId, {
          body: input.body,
          author: input.author,
          statusAtComment: input.statusAtComment,
        });
        return updated;
      } catch (err) {
        const e = err as { code?: string; message: string };
        if (e.message.includes("Invalid task id")) {
          void reply.code(400).send({ error: e.message });
          return;
        }
        if (e.code === "EMPTY_BODY") {
          void reply.code(400).send({ error: e.message });
          return;
        }
        // Unexpected IO error.
        void reply.code(500).send({ error: e.message });
      }
    }
  );
};
