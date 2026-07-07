/**
 * sessions-routes.ts — Fastify plugin for the Sessions agent-visualisation view.
 *
 * Registers (all READ-ONLY, loopback-bound like every read route — no write
 * token; files are the truth, read fresh per request, DEC-002):
 *   GET /api/sessions                       → SessionSummary[]
 *   GET /api/sessions/:id/tree              → SessionTree | 404
 *   GET /api/sessions/:id/agents/:agentId   → AgentConversation (window) | 404
 *                                             (:agentId "root" = main transcript)
 *   GET /api/sessions/:id/tools/:toolUseId  → ToolResultDetail | 404
 *   GET /api/sessions/:id/search?q=…        → SessionSearchResult | 404
 *   GET /api/sessions/:id/stream            → SSE: `event: change` when the
 *                                             session's transcripts change
 *
 * PAGINATION / TAIL-DEFAULT (Sessions API v2 — behaviour change): the agents
 * endpoint now returns a WINDOW, not the whole conversation. Query params:
 *   ?before=<turnUuid>  page the `limit` turns immediately BEFORE that turn
 *   ?limit=<n=200>      window size (default 200; clamped to >= 1)
 *   ?all=1              escape hatch — the FULL conversation (back-compat)
 * With NO params the response is the TAIL of the last `limit` turns (the view
 * opens at the end), NOT the whole transcript. The payload carries `total`,
 * `hasMore`, and `oldestUuid` (the cursor for the next "load earlier"). Callers
 * that want everything must pass `all=1`.
 *
 * Source is Claude Code's own transcript store (~/.claude/projects/<slug>/),
 * NOT the project tree — the transcript-parser resolves the dir (slug +
 * cwd-match fallback, CLAUDE_PROJECTS_DIR override). The parser validates the
 * :id/:agentId params against strict character classes, so no client-supplied
 * path ever reaches the filesystem un-checked.
 *
 * The SSE stream is per-session (unlike /api/events, which watches the
 * project read-set via the singleton watcher): each open stream fs.watches
 * the sessions dir + the session's subagents dir, debounced ~500ms. Same
 * discipline as events-routes.ts: never self-close, heartbeat every 15s,
 * clean up only on client disconnect.
 *
 * contract:console-http-api
 */

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";

import { getProjectRoot } from "../project-root.js";
import {
  listSessions,
  readAgentConversation,
  readSessionTree,
  readToolResult,
  resolveProjectSessionsDir,
  searchSession,
  sessionExists,
} from "../parsers/transcript-parser.js";
import type {
  AgentConversation,
  SessionSearchResult,
  SessionSummary,
  SessionTree,
  ToolResultDetail,
} from "../types.js";

const HEARTBEAT_INTERVAL_MS = 15_000;
const STREAM_DEBOUNCE_MS = 500;

function sseEvent(eventName: string, data: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

function sseComment(text: string): string {
  return `: ${text}\n\n`;
}

export const sessionsRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance,
) => {
  // ── GET /api/sessions ───────────────────────────────────────────────────────
  fastify.get<{ Reply: SessionSummary[] }>("/api/sessions", async () => {
    return listSessions(getProjectRoot());
  });

  // ── GET /api/sessions/:id/tree ──────────────────────────────────────────────
  fastify.get<{
    Params: { id: string };
    Reply: SessionTree | { error: string };
  }>("/api/sessions/:id/tree", async (req, reply) => {
    const tree = readSessionTree(getProjectRoot(), req.params.id);
    if (tree === null) {
      return reply
        .code(404)
        .send({ error: `Session '${req.params.id}' not found` });
    }
    return tree;
  });

  // ── GET /api/sessions/:id/agents/:agentId (windowed) ────────────────────────
  fastify.get<{
    Params: { id: string; agentId: string };
    Querystring: { before?: string; limit?: string; all?: string };
    Reply: AgentConversation | { error: string };
  }>("/api/sessions/:id/agents/:agentId", async (req, reply) => {
    const { before, limit, all } = req.query;
    const parsedLimit = limit !== undefined ? Number(limit) : undefined;
    const convo = readAgentConversation(
      getProjectRoot(),
      req.params.id,
      req.params.agentId,
      {
        before: before || undefined,
        // NaN (junk ?limit=) falls through to the parser's default.
        limit:
          parsedLimit !== undefined && Number.isFinite(parsedLimit)
            ? parsedLimit
            : undefined,
        all: all === "1",
      },
    );
    if (convo === null) {
      return reply.code(404).send({
        error: `Agent '${req.params.agentId}' not found in session '${req.params.id}'`,
      });
    }
    return convo;
  });

  // ── GET /api/sessions/:id/tools/:toolUseId (full untruncated result) ─────────
  fastify.get<{
    Params: { id: string; toolUseId: string };
    Reply: ToolResultDetail | { error: string };
  }>("/api/sessions/:id/tools/:toolUseId", async (req, reply) => {
    const detail = readToolResult(
      getProjectRoot(),
      req.params.id,
      req.params.toolUseId,
    );
    if (detail === null) {
      return reply.code(404).send({
        error: `Tool '${req.params.toolUseId}' not found in session '${req.params.id}'`,
      });
    }
    return detail;
  });

  // ── GET /api/sessions/:id/search?q=… (in-session substring search) ──────────
  fastify.get<{
    Params: { id: string };
    Querystring: { q?: string };
    Reply: SessionSearchResult | { error: string };
  }>("/api/sessions/:id/search", async (req, reply) => {
    const result = searchSession(
      getProjectRoot(),
      req.params.id,
      req.query.q ?? "",
    );
    if (result === null) {
      return reply
        .code(404)
        .send({ error: `Session '${req.params.id}' not found` });
    }
    return result;
  });

  // ── GET /api/sessions/:id/stream (SSE liveness) ─────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    "/api/sessions/:id/stream",
    async (
      req: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const sessionId = req.params.id;
      // Validate via the parser (strict id charset + resolved dir) before
      // wiring any watcher — unknown session → plain 404, no stream.
      const sessionsDir = resolveProjectSessionsDir(getProjectRoot());
      if (!sessionsDir || !sessionExists(getProjectRoot(), sessionId)) {
        return reply
          .code(404)
          .send({ error: `Session '${sessionId}' not found` });
      }

      const raw = reply.raw;
      raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      raw.flushHeaders();

      // Debounced change push — transcript files are appended in bursts.
      let timer: ReturnType<typeof setTimeout> | null = null;
      const scheduleEmit = (): void => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          try {
            raw.write(sseEvent("change", { sessionId }));
          } catch {
            // client went away between event and write — ignore
          }
        }, STREAM_DEBOUNCE_MS);
      };

      // Watch the sessions dir (catches the main <id>.jsonl) filtered to this
      // session, plus the session's own dir RECURSIVELY (catches subagents/*).
      const handles: FSWatcher[] = [];
      const tryWatch = (
        dir: string,
        recursive: boolean,
        filter?: (filename: string) => boolean,
      ): void => {
        try {
          const h = watch(
            dir,
            { recursive, persistent: false },
            (_evt, filename) => {
              if (filter && filename && !filter(String(filename))) return;
              scheduleEmit();
            },
          );
          h.on("error", () => {
            // transient / dir deleted — the stream just goes quiet
          });
          handles.push(h);
        } catch {
          // dir may not exist (session without subagents) — skip
        }
      };

      // The session's own dir is created LAZILY (first subagents/snapshot write),
      // possibly AFTER this stream opened. `watch()` throws on a missing dir, so
      // attach idempotently: now if it exists, otherwise when the parent-dir
      // watcher first sees an event named for this session (the dir appearing).
      let sessionDirWatched = false;
      const watchSessionDir = (): void => {
        if (sessionDirWatched) return;
        if (!existsSync(join(sessionsDir, sessionId))) return;
        sessionDirWatched = true;
        tryWatch(join(sessionsDir, sessionId), true);
      };

      tryWatch(sessionsDir, false, (f) => {
        if (!f.startsWith(sessionId)) return false;
        watchSessionDir(); // the session dir may have just appeared
        return true;
      });
      watchSessionDir();

      const heartbeat = setInterval(() => {
        try {
          raw.write(sseComment("heartbeat"));
        } catch {
          clearInterval(heartbeat);
        }
      }, HEARTBEAT_INTERVAL_MS);

      req.raw.on("close", () => {
        clearInterval(heartbeat);
        if (timer !== null) clearTimeout(timer);
        for (const h of handles) {
          try {
            h.close();
          } catch {
            // already closed
          }
        }
        // Never call raw.end() — connection is already gone (events-routes.ts).
      });

      // Never resolve — the stream is driven by raw.write() above.
      return new Promise<void>(() => {
        /* intentionally never resolves */
      });
    },
  );
};
