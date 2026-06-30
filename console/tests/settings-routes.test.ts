// @vitest-environment node
/**
 * settings-routes.test.ts — GET/PUT /api/settings + GET /settings (TASK-042)
 *
 * GET is unguarded; PUT goes through the write-guard (token + loopback origin);
 * the page is served at /settings. Uses a temp state dir so writeSettings doesn't
 * touch the real per-user settings.json.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";

let stateDir: string;
beforeAll(() => {
  stateDir = mkdtempSync(join(tmpdir(), "ccmaf-settings-"));
  process.env.CCMAF_CONSOLE_STATE_DIR = stateDir;
});

const { buildServer } = await import("../src/server/server.js");
const { LAUNCH_TOKEN, TOKEN_HEADER } = await import("../src/server/security.js");

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildServer({ port: 6120, distDir: "/nonexistent-dist" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  delete process.env.CCMAF_CONSOLE_STATE_DIR;
  rmSync(stateDir, { recursive: true, force: true });
});

describe("GET /api/settings", () => {
  it("returns defaults when no settings.json exists", async () => {
    const res = await app.inject({ method: "GET", url: "/api/settings" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ openMode: string; windowStyle: string; autoOpenOnStart: boolean }>();
    expect(body.openMode).toBe("default");
    expect(body.windowStyle).toBe("single");
    expect(body.autoOpenOnStart).toBe(false);
  });
});

describe("PUT /api/settings — write guard + apply", () => {
  it("rejects a write with no token → 401", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ windowStyle: "tabbed" }),
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a cross-origin write → 403", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example.com",
        [TOKEN_HEADER]: LAUNCH_TOKEN,
      },
      payload: JSON.stringify({ windowStyle: "tabbed" }),
    });
    expect(res.statusCode).toBe(403);
  });

  it("applies a valid patch (loopback + token) and persists it", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:6120",
        [TOKEN_HEADER]: LAUNCH_TOKEN,
      },
      payload: JSON.stringify({ windowStyle: "tabbed", openMode: "app" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ windowStyle: string; openMode: string }>();
    expect(body.windowStyle).toBe("tabbed");
    expect(body.openMode).toBe("app");

    // Persisted: a fresh GET reflects it.
    const after = await app.inject({ method: "GET", url: "/api/settings" });
    expect(after.json<{ windowStyle: string }>().windowStyle).toBe("tabbed");
  });

  it("drops unknown/garbage fields rather than persisting them", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/settings",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:6120",
        [TOKEN_HEADER]: LAUNCH_TOKEN,
      },
      payload: JSON.stringify({ windowStyle: "bogus", evil: "x" }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Record<string, unknown>>();
    expect(body).not.toHaveProperty("evil");
    // bogus windowStyle normalised back to a valid value (not "bogus")
    expect(["single", "tabbed"]).toContain(body.windowStyle);
  });
});
