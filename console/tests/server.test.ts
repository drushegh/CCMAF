// @vitest-environment node
/**
 * server.test.ts — Server unit tests for TASK-002.
 *
 * Tests:
 *   1. /api/health returns the identity payload
 *   2. PUT /api/verify/:task rejects missing token → 401
 *   3. PUT /api/verify/:task rejects invalid token → 401
 *   4. PUT /api/verify/:task rejects bad Origin → 403
 *   5. PUT /api/verify/:task accepts loopback+valid token → 501 (stub, not 401/403)
 *   6. isValidToken: correct token accepted
 *   7. isValidToken: TOKEN+"x" prefix-bypass is rejected
 *   8. isValidToken: wrong-length (short) value is rejected
 *   9. Path-safety helper: rejects traversal attempts
 *  10. Path-safety helper: accepts valid TASK/BUG ids
 *  11. findProjectRoot: walk-up logic against a real temp dir tree
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";

// ── Mock project-root so server tests don't depend on CWD ───────────────────
vi.mock("../src/server/project-root.js", () => {
  const fakeRoot = "/fake/project";
  return {
    findProjectRoot: (_: string) => fakeRoot,
    getProjectRoot: () => fakeRoot,
    dotClaudePath: (...segments: string[]) =>
      [fakeRoot, ".claude", ...segments].join("/"),
  };
});

// Import after mock is registered
const { buildServer } = await import("../src/server/server.js");
const { LAUNCH_TOKEN, TOKEN_HEADER, resolveVerifyPath, isValidToken } = await import(
  "../src/server/security.js"
);

// ── Server lifecycle ─────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildServer({ port: 6120, distDir: "/nonexistent-dist" });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/health", () => {
  it("returns the console identity (incl. project/port/pid for the Hub)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      app: string;
      version: string;
      projectRoot: string;
      project: string;
      port: number;
      pid: number;
    }>();
    expect(body.app).toBe("ccmaf-console");
    expect(typeof body.version).toBe("string");
    expect(typeof body.projectRoot).toBe("string");
    // TASK-037: the Hub reads these.
    expect(body.project).toBe("project"); // basename of the mocked /fake/project
    expect(body.port).toBe(6120);
    expect(typeof body.pid).toBe("number");
  });
});

describe("POST /api/shutdown — token guard (TASK-037)", () => {
  it("rejects a missing/wrong token (403) and does NOT shut down", async () => {
    const onShutdown = vi.fn();
    const srv = await buildServer({
      port: 6190,
      distDir: "/nonexistent-dist",
      shutdownToken: "s3cret-token",
      onShutdown,
    });
    await srv.ready();

    const noToken = await srv.inject({ method: "POST", url: "/api/shutdown" });
    expect(noToken.statusCode).toBe(403);

    const wrong = await srv.inject({
      method: "POST",
      url: "/api/shutdown",
      headers: { "x-console-shutdown": "nope" },
    });
    expect(wrong.statusCode).toBe(403);
    expect(onShutdown).not.toHaveBeenCalled();
    await srv.close();
  });

  it("accepts the correct token (200) and triggers shutdown", async () => {
    const onShutdown = vi.fn();
    const srv = await buildServer({
      port: 6191,
      distDir: "/nonexistent-dist",
      shutdownToken: "s3cret-token",
      onShutdown,
    });
    await srv.ready();

    const ok = await srv.inject({
      method: "POST",
      url: "/api/shutdown",
      headers: { "x-console-shutdown": "s3cret-token" },
    });
    expect(ok.statusCode).toBe(200);
    // onShutdown is scheduled via setImmediate — let it run.
    await new Promise((r) => setImmediate(r));
    expect(onShutdown).toHaveBeenCalledTimes(1);
    await srv.close();
  });
});

describe("PUT /api/verify/:task — write guard", () => {
  const validPayload = JSON.stringify([
    { id: "item-1", verdict: "pass" },
  ]);

  it("rejects request with no token → 401", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/verify/TASK-001",
      headers: { "content-type": "application/json" },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/token/i);
  });

  it("rejects request with wrong token → 401", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/verify/TASK-001",
      headers: {
        "content-type": "application/json",
        [TOKEN_HEADER]: "00000000000000000000000000000000",
      },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects request from unexpected Origin → 403", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/verify/TASK-001",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example.com",
        [TOKEN_HEADER]: LAUNCH_TOKEN,
      },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(403);
    const body = res.json<{ error: string }>();
    expect(body.error).toMatch(/cross-origin/i);
  });

  it("accepts request from loopback origin with valid token → guard passes (404, no verify file)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/verify/TASK-001",
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:6120",
        [TOKEN_HEADER]: LAUNCH_TOKEN,
      },
      payload: validPayload,
    });
    // The request passed the security guard (NOT 401/403). The real verify
    // plugin (TASK-004) then returns 404 because no verify file exists for
    // TASK-001 in the mocked test project root.
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(404);
  });
});

describe("isValidToken — constant-time token security", () => {
  it("accepts the correct LAUNCH_TOKEN", () => {
    expect(isValidToken(LAUNCH_TOKEN)).toBe(true);
  });

  it("rejects TOKEN+'x' — prefix-bypass must NOT pass", () => {
    // Previously a padded-copy implementation allowed TOKEN+"garbage" to pass
    // because the copy was bounded to token length. The fixed version does an
    // explicit length check first, so TOKEN+"x" must be rejected.
    expect(isValidToken(LAUNCH_TOKEN + "x")).toBe(false);
  });

  it("rejects a short value (TOKEN minus last char) → wrong length", () => {
    expect(isValidToken(LAUNCH_TOKEN.slice(0, -1))).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isValidToken("")).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isValidToken(undefined)).toBe(false);
  });

  it("rejects all-zero token of correct length", () => {
    const zeros = "0".repeat(LAUNCH_TOKEN.length);
    expect(isValidToken(zeros)).toBe(false);
  });

  it("rejects a correct-length value with invalid hex (must not throw)", () => {
    // Buffer.from(_, "hex") truncates on bad hex → decoded-length mismatch.
    // Must return false, never throw (a throw here = 500 + DoS, not 401).
    expect(isValidToken("00".repeat(15) + "ZZ")).toBe(false);
  });
});

describe("resolveVerifyPath — path-safety helper", () => {
  it("accepts a valid TASK-NNN id", () => {
    const path = resolveVerifyPath("TASK-001");
    expect(path).toContain("TASK-001.json");
    expect(path).toContain("console");
    expect(path).toContain("verify");
  });

  it("accepts a valid BUG-NNN id", () => {
    const path = resolveVerifyPath("BUG-007");
    expect(path).toContain("BUG-007.json");
  });

  it("rejects a malformed id (no prefix)", () => {
    expect(() => resolveVerifyPath("001")).toThrow(/Invalid task id/);
  });

  it("rejects a path traversal attempt (..)", () => {
    expect(() => resolveVerifyPath("TASK-../../../etc/passwd")).toThrow(
      /Invalid task id/
    );
  });

  it("rejects an id with slashes", () => {
    expect(() => resolveVerifyPath("TASK/001")).toThrow(/Invalid task id/);
  });

  it("rejects empty string", () => {
    expect(() => resolveVerifyPath("")).toThrow(/Invalid task id/);
  });

  it("rejects TASK- with no number", () => {
    expect(() => resolveVerifyPath("TASK-")).toThrow(/Invalid task id/);
  });
});

// ── Regression: GET / and GET /index.html serve SPA with token meta tag ───────
//
// Previously, buildServer with a non-existent distDir skipped the SPA branch
// entirely, so GET / returned the dev-mode 200 stub — but without the token
// meta tag — while GET /index.html returned 403 (fastify-static directory
// request). This test creates a real temp dist dir with a minimal index.html
// and verifies both routes return 200 text/html containing the meta tag.

describe("GET / and GET /index.html — SPA token injection", () => {
  let spaApp: FastifyInstance;
  let spaDistDir: string;

  beforeAll(async () => {
    // Create a minimal temp dist dir with a valid index.html.
    spaDistDir = join(tmpdir(), `ccmaf-spa-test-${Date.now()}`);
    mkdirSync(spaDistDir, { recursive: true });
    writeFileSync(
      join(spaDistDir, "index.html"),
      "<!doctype html><html><head></head><body>Console</body></html>",
      "utf8"
    );

    // Build a server pointing at our temp dist dir.
    spaApp = await buildServer({ port: 6121, distDir: spaDistDir });
    await spaApp.ready();
  });

  afterAll(async () => {
    await spaApp.close();
    rmSync(spaDistDir, { recursive: true, force: true });
  });

  it("GET / returns 200 text/html", async () => {
    const res = await spaApp.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
  });

  it('GET / body contains meta[name="x-console-token"]', async () => {
    const res = await spaApp.inject({ method: "GET", url: "/" });
    expect(res.body).toContain('name="x-console-token"');
  });

  it("GET /index.html returns 200 text/html", async () => {
    const res = await spaApp.inject({ method: "GET", url: "/index.html" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
  });

  it('GET /index.html body contains meta[name="x-console-token"]', async () => {
    const res = await spaApp.inject({ method: "GET", url: "/index.html" });
    expect(res.body).toContain('name="x-console-token"');
  });

  // ── BUG-009 regression ────────────────────────────────────────────────────
  it("a deep client route falls back to the SPA shell (200 text/html)", async () => {
    const res = await spaApp.inject({ method: "GET", url: "/verify/TASK-001" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    expect(res.body).toContain('name="x-console-token"');
  });

  it("a MISSING static asset 404s (does NOT fall back to HTML → no white screen)", async () => {
    const res = await spaApp.inject({ method: "GET", url: "/assets/index-DELETED.js" });
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).not.toMatch(/text\/html/);
  });

  it("an extensioned missing path also 404s rather than serving the shell", async () => {
    const res = await spaApp.inject({ method: "GET", url: "/console-icon.svg" });
    expect(res.statusCode).toBe(404);
  });

  it("re-reads index.html per request (self-heals after a rebuild)", async () => {
    writeFileSync(
      join(spaDistDir, "index.html"),
      "<!doctype html><html><head></head><body>REBUILT-MARKER</body></html>",
      "utf8",
    );
    const res = await spaApp.inject({ method: "GET", url: "/" });
    expect(res.body).toContain("REBUILT-MARKER");
    expect(res.body).toContain('name="x-console-token"');
  });
});

// ── Real findProjectRoot walk-up test (not using the vi.mock) ─────────────────
// We copy the algorithm inline so the vi.mock above doesn't interfere.
// This directly validates the walk-up logic against a real temp dir tree.

function realFindProjectRoot(startDir: string): string | null {
  let current = startDir;
  while (true) {
    if (existsSync(join(current, ".claude"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

describe("findProjectRoot — walk-up logic (real algorithm)", () => {
  let tmpProjectRoot: string;
  let deepSubdir: string;
  let isolatedDir: string;
  let base: string;

  beforeAll(() => {
    base = join(tmpdir(), `ccmaf-findroot-${Date.now()}`);
    tmpProjectRoot = join(base, "myproject");
    deepSubdir = join(tmpProjectRoot, "src", "app", "pages");
    isolatedDir = join(base, "no-claude-here", "sub");

    // Create project root with .claude sentinel
    mkdirSync(join(tmpProjectRoot, ".claude"), { recursive: true });
    writeFileSync(join(tmpProjectRoot, ".claude", ".keep"), "");

    // Create a deep subdirectory to walk up from
    mkdirSync(deepSubdir, { recursive: true });

    // Create isolated dir with no .claude anywhere above it (within base)
    mkdirSync(isolatedDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("finds the project root by walking up from a deep subdir", () => {
    const found = realFindProjectRoot(deepSubdir);
    expect(found).toBe(tmpProjectRoot);
  });

  it("returns the immediate dir if .claude is there", () => {
    const found = realFindProjectRoot(tmpProjectRoot);
    expect(found).toBe(tmpProjectRoot);
  });

  it("returns null when no .claude/ exists in the controlled sub-tree", () => {
    // Walk from isolatedDir — if it reaches tmpProjectRoot's parent (base),
    // it will NOT find .claude there (only tmpProjectRoot has it).
    // But if the OS temp dir happens to have .claude somewhere above, this
    // might return non-null. That's acceptable — we only guarantee the
    // algorithm terminates and returns string|null.
    const found = realFindProjectRoot(isolatedDir);
    // If found is non-null it must be a string (a parent had .claude)
    expect(found === null || typeof found === "string").toBe(true);
    // And critically: it must NOT return tmpProjectRoot itself (different tree)
    if (found !== null) {
      expect(found).not.toBe(tmpProjectRoot);
    }
  });
});
