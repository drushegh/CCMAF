// @vitest-environment node
/**
 * hub-routes.test.ts — Hub flyout page + action endpoints (TASK-043)
 *
 * GET /hub + GET /api/hub/state are reads; the POST actions are write-guarded.
 * We exercise the guard + the read shape against a temp registry, and a no-op
 * end (fake port) for the success path — without spawning/killing anything.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";

let stateDir: string;
beforeAll(() => {
  stateDir = mkdtempSync(join(tmpdir(), "ccmaf-hubroutes-"));
  process.env.CCMAF_CONSOLE_STATE_DIR = stateDir;
});

const { buildServer } = await import("../src/server/server.js");
const { LAUNCH_TOKEN, TOKEN_HEADER } = await import("../src/server/security.js");
const { registerConsole } = await import("../src/server/hub/registry.js");

let app: FastifyInstance;
beforeAll(async () => {
  registerConsole({
    schemaVersion: 1,
    project: "alpha",
    rootPath: "F:/p/alpha",
    port: 6120,
    pid: 11,
    version: "0.1.0",
    startedAt: "2026-06-29T00:00:00Z",
    shutdownToken: "alpha-secret",
    autoStart: true,
  });
  app = await buildServer({ port: 6120, distDir: "/nonexistent-dist" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  delete process.env.CCMAF_CONSOLE_STATE_DIR;
  rmSync(stateDir, { recursive: true, force: true });
});

const loopback = { origin: "http://127.0.0.1:6120", [TOKEN_HEADER]: LAUNCH_TOKEN };

describe("GET /hub", () => {
  it("serves the flyout page with the token embedded", async () => {
    const res = await app.inject({ method: "GET", url: "/hub" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain("Console Hub");
    expect(res.body).toContain(LAUNCH_TOKEN);
  });
});

describe("GET /api/hub/state", () => {
  it("returns running consoles + settings (no shutdownToken)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/hub/state" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ running: { port: number }[]; settings: { openMode: string } }>();
    expect(body.running.map((c) => c.port)).toContain(6120);
    expect(body.settings.openMode).toBe("default");
    expect(res.body).not.toContain("alpha-secret");
  });
});

describe("POST /api/hub/* — write guard", () => {
  it("rejects open/end/start/quit with no token → 401", async () => {
    for (const url of ["/api/hub/open", "/api/hub/end", "/api/hub/start", "/api/hub/quit"]) {
      const res = await app.inject({
        method: "POST",
        url,
        headers: { "content-type": "application/json" },
        payload: "{}",
      });
      expect(res.statusCode).toBe(401);
    }
  });

  it("end on a non-existent port (token+loopback) no-ops → 200", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/hub/end",
      headers: { "content-type": "application/json", ...loopback },
      payload: JSON.stringify({ port: 59999 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ ok: boolean }>().ok).toBe(true);
  });
});
