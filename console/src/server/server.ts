/**
 * server.ts — Console HTTP server (TASK-002).
 *
 * Architecture (DEC-008):
 *   - Fastify v5 on 127.0.0.1:6120 (loopback-only, DEC-002/SPEC §5)
 *   - Idempotent start: if port is busy, probe health to detect our own
 *     instance before falling back to the next free port.
 *   - Serves the built SPA from dist/ in production; in dev, Vite runs
 *     separately on the same port (vite.config.ts port:6120) so one URL works.
 *   - Per-launch token injected into the served index.html (SPEC §5).
 *   - Origin/Host guard + per-launch token required on write endpoints.
 *   - No authoritative state — files are the truth (DEC-002).
 *
 * Route skeleton: all endpoints return typed stubs; TASK-003/004 fill them.
 * Only /api/health is fully implemented.
 */

import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import staticPlugin from "@fastify/static";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";

import { getProjectRoot } from "./project-root.js";
import {
  LAUNCH_TOKEN,
  TOKEN_HEADER,
  isValidToken,
  isAllowedOrigin,
  isAllowedHost,
} from "./security.js";
import {
  assignPort,
  projectName,
  registerConsole,
  deregisterConsole,
  entryMtimeMs,
  isHeartbeatStale,
  sameRoot,
} from "./hub/registry.js";
import type { HealthResponse } from "./types.js";

import { stateRoutes } from "./routes/state-routes.js";
import verifyRoutes from "./routes/verify-routes.js";
import { dashboardRoutes } from "./routes/dashboard-routes.js";
import { eventsRoutes } from "./routes/events-routes.js";
import { tasksWriteRoutes } from "./routes/tasks-write-routes.js";
import { commentsRoutes } from "./routes/comments-routes.js";
import { analyticsRoutes } from "./routes/analytics-routes.js";
import { docsRoutes } from "./routes/docs-routes.js";
import { shellRoutes } from "./routes/shell-routes.js";
import { settingsRoutes } from "./routes/settings-routes.js";
import { hubRoutes } from "./routes/hub-routes.js";
import { sessionsRoutes } from "./routes/sessions-routes.js";
import { getWatcher } from "./watch/watcher.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const APP_ID = "ccmaf-console";
/**
 * Real package version, so /api/health.version and the registry `version` field
 * are truthful (the Stage-2 version-skew handshake depends on it). package.json
 * sits at ../ from the built dist-server/server.js and at ../../ from the source
 * src/server/server.ts (dev/test) — try both so it resolves in every layout.
 */
function readPackageVersion(): string {
  const require = createRequire(import.meta.url);
  for (const rel of ["../package.json", "../../package.json"]) {
    try {
      return (require(rel) as { version?: string }).version ?? "0.0.0";
    } catch {
      /* try the next layout */
    }
  }
  return "0.0.0";
}
const VERSION = readPackageVersion();
/** Header carrying the per-instance shutdown token (TASK-037, DEC-025). */
const SHUTDOWN_HEADER = "x-console-shutdown";

/** Constant-time string compare (avoids leaking the shutdown token by timing). */
function tokensMatch(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// ── Port helpers ──────────────────────────────────────────────────────────────

/** Check if a port is currently in use. */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close(() => resolve(false));
    });
    server.listen(port, "127.0.0.1");
  });
}

/** Find the next free port starting from `start`. */
async function findFreePort(start: number): Promise<number> {
  let port = start;
  while (await isPortInUse(port)) {
    port++;
  }
  return port;
}

/**
 * Probe a port to see if OUR console (this same project) is already running there.
 * Returns the URL only if the health payload is a ccmaf-console AND serves the
 * same projectRoot — a different project's console (or another app) that happens
 * to hold the pinned port must NOT be adopted (idempotent-start would otherwise
 * return a URL pointing at the wrong project). Returns null otherwise.
 */
export async function probeExistingConsole(
  port: number,
  expectedRoot: string,
): Promise<string | null> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (resp.ok) {
      const body = (await resp.json()) as {
        app?: string;
        projectRoot?: string;
      };
      if (
        body.app === APP_ID &&
        typeof body.projectRoot === "string" &&
        sameRoot(body.projectRoot, expectedRoot)
      ) {
        return `http://127.0.0.1:${port}`;
      }
    }
  } catch {
    // Port in use by something else or fetch failed — not our console
  }
  return null;
}

// ── SPA html injection ────────────────────────────────────────────────────────

/**
 * Inject the per-launch token into the served index.html so the SPA can
 * read it from a meta tag and include it as X-Console-Token on write requests.
 *
 * The SPA reads: document.querySelector('meta[name="x-console-token"]').content
 */
function injectTokenIntoHtml(html: string, token: string): string {
  const meta = `<meta name="x-console-token" content="${token}" />`;
  // Insert before </head> if present, else prepend.
  if (html.includes("</head>")) {
    return html.replace("</head>", `  ${meta}\n</head>`);
  }
  return `${meta}\n${html}`;
}

// ── Write guard ───────────────────────────────────────────────────────────────

/**
 * Fastify preHandler hook for write endpoints (PUT /api/verify/:task).
 * Enforces:
 *   1. Origin check — rejects cross-origin requests (DNS-rebinding/CSRF)
 *   2. Per-launch token check — rejects missing/invalid X-Console-Token
 */
function makeWriteGuard(port: number) {
  return function writeGuard(
    req: FastifyRequest,
    reply: FastifyReply,
    done: () => void,
  ): void {
    // 1. Origin check (DNS-rebinding / CSRF defence)
    const origin = req.headers.origin as string | undefined;
    if (!isAllowedOrigin(origin, port)) {
      void reply
        .code(403)
        .send({ error: "Forbidden: cross-origin write rejected" });
      return;
    }

    // 2. Per-launch token check
    const token = req.headers[TOKEN_HEADER] as string | undefined;
    if (!isValidToken(token)) {
      void reply.code(401).send({
        error: "Unauthorized: missing or invalid x-console-token",
      });
      return;
    }

    done();
  };
}

// ── Server factory ────────────────────────────────────────────────────────────

export async function buildServer(opts: {
  port: number;
  distDir: string;
  /** Secret required to POST /api/shutdown (defaults to a fresh random token). */
  shutdownToken?: string;
  /** Called after a token-valid /api/shutdown (defaults to graceful close+exit). */
  onShutdown?: () => void;
}) {
  const { port, distDir } = opts;
  const projectRoot = getProjectRoot();
  const shutdownToken = opts.shutdownToken ?? randomBytes(24).toString("hex");

  const fastify = Fastify({ logger: false });

  // DNS-rebinding defence for EVERY route (reads, SSE, the SPA): reject any request
  // whose Host header isn't loopback. Read routes carry no token, and the Sessions
  // feature exposes transcripts (secrets) + projectRoot, so loopback binding alone is
  // not enough — a rebound attacker page is same-origin but sends its own Host. Absent
  // Host (CLI callers) is allowed; the rebinding attack always carries one.
  fastify.addHook("onRequest", (req, reply, done) => {
    if (!isAllowedHost(req.headers.host)) {
      reply
        .code(403)
        .send({ error: "Forbidden: non-loopback Host header rejected" });
      return;
    }
    done();
  });

  const writeGuard = makeWriteGuard(port);

  // Default shutdown action: close the HTTP server, then exit. (Tests pass their
  // own onShutdown so the runner never exits.)
  const onShutdown =
    opts.onShutdown ??
    (() => {
      void fastify.close().finally(() => process.exit(0));
    });

  // Route plugins: TASK-003 read endpoints, TASK-004 verify endpoints,
  // TASK-007 dashboard aggregation, TASK-008 SSE events.
  await fastify.register(stateRoutes);
  await fastify.register(verifyRoutes, { writeGuard });
  await fastify.register(dashboardRoutes);
  await fastify.register(eventsRoutes);
  await fastify.register(tasksWriteRoutes, { writeGuard }); // TASK-010 status write-back
  await fastify.register(commentsRoutes, { writeGuard }); // TASK-013 comments
  await fastify.register(analyticsRoutes); // TASK-025 analytics
  await fastify.register(docsRoutes); // TASK-028 docs browser
  await fastify.register(shellRoutes); // TASK-041 tabbed shell + /api/registry
  await fastify.register(settingsRoutes, { writeGuard }); // TASK-042 settings window + /api/settings
  await fastify.register(hubRoutes, { writeGuard, port }); // TASK-043 Hub flyout window + actions
  await fastify.register(sessionsRoutes); // Sessions agent-visualisation (read-only)

  // File-watcher → SSE stream (TASK-008): start once per server; stop on close.
  getWatcher().start();
  fastify.addHook("onClose", async () => {
    getWatcher().stop();
  });

  // ── Health endpoint (fully implemented) ─────────────────────────────────────
  // Identity + liveness. The tray Hub reads project/port/pid to label and
  // health-prune the registry (TASK-037). `app` stays for the existing probe.
  fastify.get<{ Reply: HealthResponse }>("/api/health", async () => {
    return {
      app: APP_ID,
      version: VERSION,
      projectRoot,
      project: projectName(projectRoot),
      port,
      pid: process.pid,
    };
  });

  // ── Shutdown endpoint (TASK-037, DEC-025) ───────────────────────────────────
  // Graceful teardown for `/wrapup` → `console stop` and the tray "End". Guarded
  // by the per-instance shutdown token (held only in this console's registry
  // entry, which a browser page can't read) — loopback binding + token together
  // mean a stray local page can't kill the server. No Origin required (the
  // launcher calls this server-to-server, without one).
  fastify.post("/api/shutdown", async (req, reply) => {
    const header = req.headers[SHUTDOWN_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!tokensMatch(provided, shutdownToken)) {
      return reply
        .code(403)
        .send({ error: "Forbidden: invalid shutdown token" });
    }
    // Respond first, then tear down on the next tick.
    void reply.code(200).send({ ok: true });
    setImmediate(onShutdown);
  });

  // Endpoint ownership (all served by registered plugins, no inline stubs):
  //   /api/dashboard                         → dashboardRoutes (TASK-007)
  //   /api/tasks /contracts /decisions
  //     /specs /specs/:name /readme          → stateRoutes    (TASK-003)
  //   /api/verify /verify/:task (GET + PUT)  → verifyRoutes   (TASK-004); PUT behind writeGuard
  //   /api/events (SSE)                      → eventsRoutes   (TASK-008); fed by the file-watcher

  // ── SPA serving (production) ──────────────────────────────────────────────────
  // Check for index.html specifically — an empty dist/ dir would crash readFileSync.
  if (existsSync(join(distDir, "index.html"))) {
    const indexPath = join(distDir, "index.html");

    // Read index.html FRESH per request (BUG-009): if `npm run build` rewrites
    // dist/ while this server is running, a once-cached index.html would point
    // at a now-deleted asset hash → the asset 404s → SPA fallback returns HTML
    // → white screen. Reading per request self-heals after a rebuild. A read
    // that fails mid-rebuild falls back to the last good HTML.
    let lastGoodHtml = injectTokenIntoHtml(
      readFileSync(indexPath, "utf8"),
      LAUNCH_TOKEN,
    );
    const renderSpa = (): string => {
      try {
        lastGoodHtml = injectTokenIntoHtml(
          readFileSync(indexPath, "utf8"),
          LAUNCH_TOKEN,
        );
      } catch {
        /* mid-rebuild read race — serve the last good HTML */
      }
      return lastGoodHtml;
    };

    const sendSpa = (_req: FastifyRequest, reply: FastifyReply): void =>
      void reply
        .code(200)
        .header("content-type", "text/html; charset=utf-8")
        // Allow the loopback Hub shell to iframe this console (TASK-041 tabbed
        // mode), but nothing off-machine — replaces the implicit DENY.
        .header(
          "content-security-policy",
          "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*",
        )
        .send(renderSpa());

    // Serve the token-injected index.html explicitly for the document routes.
    // @fastify/static with index:false returns 403 for "/" (directory request)
    // and would serve the RAW (token-less) index.html for "/index.html"; explicit
    // routes take precedence over the static wildcard, so the browser AND the tray
    // always load the SPA with the per-launch token meta tag present.
    fastify.get("/", sendSpa);
    fastify.get("/index.html", sendSpa);

    // Serve static assets (JS, CSS, etc.)
    await fastify.register(staticPlugin, {
      root: distDir,
      prefix: "/",
      // index.html is served by the explicit routes above (with token injection)
      index: false,
      decorateReply: true,
    });

    // SPA fallback for deep links (extensionless client routes). A missing
    // STATIC ASSET must 404 loudly (BUG-009) — never fall back to HTML, which
    // would be parsed as JS/CSS and silently white-screen the app.
    fastify.setNotFoundHandler((req, reply) => {
      const path = req.url.split("?")[0];
      if (path.startsWith("/api/")) {
        void reply.code(404).send({ error: "Not found" });
        return;
      }
      const lastSegment = path.slice(path.lastIndexOf("/") + 1);
      if (path.startsWith("/assets/") || lastSegment.includes(".")) {
        // Looks like a file request (has an extension / under /assets/), not a
        // client route — 404 instead of returning the SPA shell.
        void reply.code(404).send({ error: `Asset not found: ${path}` });
        return;
      }
      void reply
        .code(200)
        .header("content-type", "text/html; charset=utf-8")
        .header(
          "content-security-policy",
          "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*",
        )
        .send(renderSpa());
    });
  } else {
    // Dev mode or empty dist/: index.html not found — serve API only with a clear message.
    // (dist/ may exist but be empty if a build was interrupted.)
    console.log(
      "[console] dist/index.html not found — running in API-only mode. " +
        "Run `npm run build` to serve the SPA, or `npm run dev` for Vite dev mode.",
    );
    fastify.setNotFoundHandler((_req, reply) => {
      void reply
        .code(200)
        .header("content-type", "text/html")
        .send(
          `<!doctype html><html><body>
          <p>Console API server running on port ${port}.</p>
          <p>Run <code>npm run dev</code> in a separate terminal for the SPA (Vite dev server).</p>
          <p>Or run <code>npm run build &amp;&amp; npm run serve</code> for production.</p>
        </body></html>`,
        );
    });
  }

  return fastify;
}

// ── Start ──────────────────────────────────────────────────────────────────────

export async function startServer(): Promise<{ url: string; isNew: boolean }> {
  // __dirname in compiled output = dist-server/ (one level below 01_Project/).
  // dist/ is a sibling of dist-server/, so one level up then into dist/.
  const distDir = resolve(__dirname, "../dist");
  const projectRoot = getProjectRoot();

  // Preferred port: an explicit CONSOLE_PORT overrides everything (tests,
  // multi-instance runs); otherwise the project's PINNED port (assign-and-
  // remember → stable/bookmarkable, DEC-025). The actual bound port may still
  // fall back if it's taken; the registry records whatever we land on.
  const preferredPort = process.env.CONSOLE_PORT
    ? Number(process.env.CONSOLE_PORT)
    : assignPort(projectRoot);

  // Per-instance shutdown token — shared between the registry entry and the
  // /api/shutdown guard, so only something that can read the registry (the Hub /
  // launcher on this machine) can stop us.
  const shutdownToken = randomBytes(24).toString("hex");

  /** Bind, register in the tray registry, and wire graceful cleanup. */
  const launch = async (
    port: number,
  ): Promise<{ url: string; isNew: boolean }> => {
    const server = await buildServer({
      port,
      distDir,
      shutdownToken,
      onShutdown: () => {
        deregisterConsole(port);
        void server.close().finally(() => process.exit(0));
      },
    });
    await server.listen({ port, host: "127.0.0.1" });

    // Self-register so the Hub can discover us (DEC-025). Best-effort: a
    // registry write failure must never stop the server from serving.
    try {
      registerConsole({
        schemaVersion: 1,
        project: projectName(projectRoot),
        rootPath: projectRoot,
        port,
        pid: process.pid,
        version: VERSION,
        startedAt: new Date().toISOString(),
        shutdownToken,
        autoStart: true,
      });
    } catch (err) {
      console.warn(
        `[console] registry write failed (continuing): ${String(err)}`,
      );
    }

    // mtime self-reaper (DEC-025 backstop). Active ONLY when CONSOLE_REAP_GRACE_MIN
    // is set — the framework sets it when IT cold-starts us, because that's exactly
    // when it also heartbeats by touching our registry file's mtime. A manual
    // `console start` (no framework, no heartbeat) leaves it unset → no self-reap,
    // so a hand-started console lives until it's explicitly stopped. When set, a
    // session that goes away (window closed / crash, no `/wrapup`) stops touching
    // the file → mtime goes stale → we reap. `/wrapup` is still the real teardown.
    const graceMin = Number(process.env.CONSOLE_REAP_GRACE_MIN);
    if (Number.isFinite(graceMin) && graceMin > 0) {
      const graceMs = graceMin * 60_000;
      const checkMs = Math.min(60_000, graceMs);
      const reaper = setInterval(() => {
        // Never reap a console a browser is actively viewing: an open cockpit
        // holds an SSE stream (one watcher subscriber), so it keeps itself alive
        // even if the framework heartbeat hook isn't wired on this consumer
        // (settings.json isn't carried by apply-update — framework's caveat).
        if (getWatcher().subscriberCount() > 0) return;
        if (isHeartbeatStale(entryMtimeMs(port), graceMs, Date.now())) {
          console.log(
            `[console] reaper: heartbeat stale (>${graceMin}m), no cockpit open — shutting down`,
          );
          clearInterval(reaper);
          deregisterConsole(port);
          void server.close().finally(() => process.exit(0));
        }
      }, checkMs);
      reaper.unref(); // never keep the process alive just for the reaper
    }

    // Clean the registry on graceful exit (Ctrl-C / kill-with-signal). Ungraceful
    // exits leave a stale entry the Hub health-prunes.
    const cleanup = () => deregisterConsole(port);
    process.once("SIGINT", () => {
      cleanup();
      process.exit(0);
    });
    process.once("SIGTERM", () => {
      cleanup();
      process.exit(0);
    });
    process.once("exit", cleanup);

    const url = `http://127.0.0.1:${port}`;
    console.log(`[console] Started at ${url}  (token injected into SPA)`);
    return { url, isNew: true };
  };

  if (await isPortInUse(preferredPort)) {
    // Our console already there (same project)? Reuse it (idempotent launch).
    const existingUrl = await probeExistingConsole(preferredPort, projectRoot);
    if (existingUrl) {
      console.log(`[console] Already running at ${existingUrl} — no-op.`);
      return { url: existingUrl, isNew: false };
    }
    // Taken by something else — fall back to the next free port.
    const fallbackPort = await findFreePort(preferredPort + 1);
    console.warn(
      `[console] Port ${preferredPort} in use by another process. ` +
        `Falling back to port ${fallbackPort}.`,
    );
    return launch(fallbackPort);
  }

  return launch(preferredPort);
}
