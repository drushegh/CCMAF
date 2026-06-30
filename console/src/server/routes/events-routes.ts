/**
 * events-routes.ts — Fastify plugin: GET /api/events (SSE) (TASK-008).
 *
 * Replaces the inline 501 stub in server.ts. Registers a proper long-lived
 * Server-Sent Events stream. The orchestrator (main session) removes the
 * inline 501 stub from server.ts and adds:
 *
 *   import { eventsRoutes } from "./routes/events-routes.js";
 *   await fastify.register(eventsRoutes);
 *
 * Protocol (contract:console-http-api):
 *   GET /api/events → text/event-stream
 *   Events: `event: change\ndata: <JSON WatchChangeEvent>\n\n`
 *   Heartbeat: `: heartbeat\n\n`  every ~15 s (keeps proxies and browsers alive)
 *   Close: only on client disconnect (req.raw "close") — NEVER self-close.
 *
 * IMPORTANT (GOTCHAS.md): never call reply.send() / reply.raw.end() yourself.
 * That closes the HTTP response, causing a browser EventSource reconnect storm.
 * Only close when the client disconnects.
 *
 * contract:console-http-api, TASK-008
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import type { WatchChangeEvent } from "../watch/watcher.js";
import { getWatcher } from "../watch/watcher.js";

// ── SSE helpers ───────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 15_000;

/** Encode a named SSE event with a JSON data payload. */
function sseEvent(eventName: string, data: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Encode an SSE comment (heartbeat). Browsers and proxies ignore these. */
function sseComment(text: string): string {
  return `: ${text}\n\n`;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export const eventsRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  fastify.get("/api/events", async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = reply.raw;

    // ── SSE headers ──────────────────────────────────────────────────────────
    raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      // Disable Nginx / reverse-proxy buffering (common gotcha for SSE in dev)
      "X-Accel-Buffering": "no",
    });
    raw.flushHeaders();

    // ── Change listener ───────────────────────────────────────────────────────
    const watcher = getWatcher();
    const unsub = watcher.subscribe((evt: WatchChangeEvent) => {
      try {
        raw.write(sseEvent("change", evt));
      } catch {
        // Client disconnected between listener call and write — ignore
      }
    });

    // ── Heartbeat (keeps the stream alive through proxies and idle browsers) ─
    const heartbeat = setInterval(() => {
      try {
        raw.write(sseComment("heartbeat"));
      } catch {
        clearInterval(heartbeat);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // ── Clean up on client disconnect ─────────────────────────────────────────
    req.raw.on("close", () => {
      clearInterval(heartbeat);
      unsub();
      // Do NOT call raw.end() — the connection is already gone; calling end()
      // can throw ERR_HTTP_HEADERS_SENT in some Node versions.
    });

    // Return a never-resolving promise so Fastify does not end the response.
    // The stream is driven entirely by raw.write() in the listener above.
    return new Promise<void>(() => { /* intentionally never resolves */ });
  });
};
