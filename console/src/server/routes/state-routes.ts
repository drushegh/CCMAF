/**
 * state-routes.ts — Fastify plugin exposing read-only state endpoints (TASK-003)
 *
 * Registers:
 *   GET /api/tasks        → TaskBoard
 *   GET /api/contracts    → ContractSummary[]
 *   GET /api/decisions    → DecisionEntry[]
 *   GET /api/specs        → SpecRef[]
 *   GET /api/specs/:name  → SpecDoc | 404
 *   GET /api/readme       → ReadmeDoc
 *
 * All paths are resolved via project-root helpers — the server never trusts
 * client-supplied paths. Files are read fresh on every request (no-state-
 * projection, DEC-002).
 *
 * How to wire into server.ts:
 *   import { stateRoutes } from "./routes/state-routes.js";
 *   await fastify.register(stateRoutes);
 *   // Then remove the stub GET handlers for the six routes above.
 *
 * contract:console-state-sources, contract:console-http-api
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { statSync } from "node:fs";
import { join } from "node:path";

import { dotClaudePath, getProjectRoot } from "../project-root.js";
import { parseTasksFile } from "../parsers/tasks-parser.js";
import { parseContractsFile } from "../parsers/contracts-parser.js";
import { parseDecisionsFile } from "../parsers/decisions-parser.js";
import { parseSpecsList, readSpecDoc } from "../parsers/specs-parser.js";
import { parseReadmeFile } from "../parsers/readme-parser.js";
import { readReadmeAsset } from "../readme/readme-assets.js";
import type {
  TaskBoard,
  ContractSummary,
  DecisionEntry,
  SpecRef,
  SpecDoc,
  ReadmeDoc,
  StateDoc,
} from "../types.js";

/**
 * Whitelist of `.claude/` markdown state files exposed via GET /api/statedoc/:key
 * (TASK-027). The fixed key→filename map is the security boundary — there is NO
 * path interpolation, so `/api/statedoc/../../foo` can never resolve a file:
 * an unknown key 404s. Add a key here to surface a new state doc.
 */
const STATE_DOCS: Record<string, string> = {
  status: "STATUS.md",
  "review-findings": "review-findings.md",
  "test-findings": "test-findings.md",
};

export const stateRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance,
) => {
  // ── GET /api/tasks ──────────────────────────────────────────────────────────
  fastify.get<{ Reply: TaskBoard }>("/api/tasks", async () => {
    return parseTasksFile(dotClaudePath("TASKS.md"));
  });

  // ── GET /api/contracts ──────────────────────────────────────────────────────
  fastify.get<{ Reply: ContractSummary[] }>("/api/contracts", async () => {
    return parseContractsFile(dotClaudePath("ECOSYSTEM.md"));
  });

  // ── GET /api/decisions ──────────────────────────────────────────────────────
  fastify.get<{ Reply: DecisionEntry[] }>("/api/decisions", async () => {
    return parseDecisionsFile(dotClaudePath("DECISIONS.md"));
  });

  // ── GET /api/specs ──────────────────────────────────────────────────────────
  fastify.get<{ Reply: SpecRef[] }>("/api/specs", async () => {
    const specsDir = dotClaudePath("framework", "docs", "specs");
    return parseSpecsList(specsDir);
  });

  // ── GET /api/specs/:name ────────────────────────────────────────────────────
  fastify.get<{
    Params: { name: string };
    Reply: SpecDoc | { error: string };
  }>("/api/specs/:name", async (req, reply) => {
    const specsDir = dotClaudePath("framework", "docs", "specs");
    const doc = readSpecDoc(specsDir, req.params.name);
    if (doc === null) {
      return reply
        .code(404)
        .send({ error: `Spec '${req.params.name}' not found` });
    }
    return doc;
  });

  // ── GET /api/readme ─────────────────────────────────────────────────────────
  fastify.get<{ Reply: ReadmeDoc }>("/api/readme", async () => {
    const readmePath = join(getProjectRoot(), "README.md");
    return parseReadmeFile(readmePath);
  });

  // ── GET /api/readme/asset?path=<relative> ───────────────────────────────────
  // Serve a single IMAGE asset the root README references by a repo-root-relative
  // path (e.g. `.github/assets/hero.webp`), so the README tab renders the same
  // images GitHub does (BUG-015). Confined to the project root, images only,
  // size-capped (readme-assets.ts). Any failure → generic 404 (no path leak).
  fastify.get<{ Querystring: { path?: string } }>(
    "/api/readme/asset",
    async (req, reply) => {
      const rel = req.query.path;
      if (!rel) {
        reply.code(400);
        return { error: "Missing path" };
      }
      try {
        const { buffer, contentType } = readReadmeAsset(rel);
        reply
          .header("Content-Type", contentType)
          .header("X-Content-Type-Options", "nosniff")
          .header("Content-Security-Policy", "default-src 'none'; sandbox");
        return reply.send(buffer);
      } catch {
        reply.code(404);
        return { error: "Not found" };
      }
    },
  );

  // ── GET /api/statedoc/:key ──────────────────────────────────────────────────
  // Render a whitelisted `.claude/` markdown state file (TASK-027). The key→file
  // map (STATE_DOCS) is the only resolution path — an unknown key 404s, so there
  // is no traversal surface. Reuses parseReadmeFile for the {exists, markdown} read.
  // TASK-106 (§5.1): also reports the file's mtime so the DocPage header can say
  // "Last updated <ago>". Best-effort — a race between read and stat (file deleted
  // in between) simply omits the field; the client renders without it.
  fastify.get<{ Params: { key: string }; Reply: StateDoc }>(
    "/api/statedoc/:key",
    async (req, reply) => {
      const file = STATE_DOCS[req.params.key];
      if (!file) {
        reply.code(404);
        return { key: req.params.key, exists: false, markdown: "" };
      }
      const path = dotClaudePath(file);
      const doc = parseReadmeFile(path);
      let mtimeMs: number | undefined;
      if (doc.exists) {
        try {
          mtimeMs = statSync(path).mtimeMs;
        } catch {
          /* deleted between read and stat — omit the field */
        }
      }
      return {
        key: req.params.key,
        exists: doc.exists,
        markdown: doc.markdown,
        ...(mtimeMs !== undefined ? { mtimeMs } : {}),
      };
    },
  );
};
