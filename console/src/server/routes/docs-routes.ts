/**
 * docs-routes.ts — Fastify plugin for the Docs browser (TASK-028)
 *
 * Registers:
 *   GET /api/docs            → DocsTree         (recursive tree of docs/)
 *   GET /api/docs/raw?path=… → file bytes       (md/txt/json/images; allowlisted)
 *
 * All file access goes through docs-fs.ts, which confines every path to docs/
 * (traversal + symlink-escape rejected), allowlists extensions, and caps size.
 * Reads are unguarded (like the other GET endpoints) — the content is
 * human-authored docs, the server is loopback-only, and `<img>` tags can't send
 * the write token anyway. Confinement + allowlist are the protections.
 *
 * contract:console-http-api, contract:console-state-sources
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { buildDocsTree, readDoc } from "../docs/docs-fs.js";
import type { DocsTree } from "../types.js";

export const docsRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  // ── GET /api/docs ───────────────────────────────────────────────────────────
  // Fresh tree per request (no-state-projection). Empty state when docs/ absent.
  fastify.get<{ Reply: DocsTree }>("/api/docs", async () => {
    return buildDocsTree();
  });

  // ── GET /api/docs/raw?path=<relative> ───────────────────────────────────────
  // Serves a single allowlisted file from docs/ with the right content-type.
  // Any confinement / allowlist / size failure → 404 with a generic message
  // (never leak why, never leak a path).
  fastify.get<{ Querystring: { path?: string } }>(
    "/api/docs/raw",
    async (req, reply) => {
      const rel = req.query.path;
      if (!rel) {
        reply.code(400);
        return { error: "Missing path" };
      }
      try {
        const { buffer, contentType } = readDoc(rel);
        reply
          .header("Content-Type", contentType)
          // Defence-in-depth: never let a served doc be sniffed into something
          // executable, and forbid embedding it elsewhere.
          .header("X-Content-Type-Options", "nosniff")
          .header("Content-Security-Policy", "default-src 'none'; sandbox");
        return reply.send(buffer);
      } catch {
        reply.code(404);
        return { error: "Not found" };
      }
    }
  );
};
