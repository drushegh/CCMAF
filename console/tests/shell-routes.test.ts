// @vitest-environment node
/**
 * shell-routes.test.ts — GET /shell + GET /api/registry (TASK-041)
 *
 * Exercises the two endpoints that back the tabbed shell against a temp registry:
 *   - /api/registry returns the live consoles WITHOUT the shutdown secret
 *   - /shell serves the tabbed-shell HTML with a frame-src CSP (it's the framer)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";

let stateDir: string;
beforeAll(() => {
  stateDir = mkdtempSync(join(tmpdir(), "ccmaf-shell-"));
  process.env.CCMAF_CONSOLE_STATE_DIR = stateDir;
});

const { buildServer } = await import("../src/server/server.js");
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
  registerConsole({
    schemaVersion: 1,
    project: "beta",
    rootPath: "F:/p/beta",
    port: 6121,
    pid: 22,
    version: "0.1.0",
    startedAt: "2026-06-29T00:00:00Z",
    shutdownToken: "beta-secret",
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

describe("GET /api/registry", () => {
  it("returns the live consoles (project/port/rootPath), sorted by port", async () => {
    const res = await app.inject({ method: "GET", url: "/api/registry" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ project: string; port: number; rootPath: string }[]>();
    expect(body.map((c) => c.port)).toEqual([6120, 6121]);
    expect(body[0]).toEqual({ project: "alpha", port: 6120, rootPath: "F:/p/alpha" });
  });

  it("never leaks the shutdown token to the browser", async () => {
    const res = await app.inject({ method: "GET", url: "/api/registry" });
    expect(res.body).not.toContain("alpha-secret");
    expect(res.body).not.toContain("beta-secret");
    expect(res.body).not.toContain("shutdownToken");
  });
});

describe("GET /shell", () => {
  it("serves the tabbed-shell HTML", async () => {
    const res = await app.inject({ method: "GET", url: "/shell" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain('role="tablist"');
    expect(res.body).toContain("/api/registry");
  });

  it("sends a frame-src CSP so it can frame the loopback consoles", async () => {
    const res = await app.inject({ method: "GET", url: "/shell" });
    const csp = String(res.headers["content-security-policy"] ?? "");
    expect(csp).toContain("frame-src");
    expect(csp).toContain("http://127.0.0.1:*");
  });
});
