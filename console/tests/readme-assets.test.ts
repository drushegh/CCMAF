/**
 * readme-assets.test.ts — README image asset reader (BUG-015)
 *
 * The security properties are the point: paths are confined to the project root,
 * ONLY image extensions are served, traversal/symlink escape is refused.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";

// Mock project-root so getProjectRoot() resolves to our tmp tree.
let tmpRoot = "";
vi.mock("../src/server/project-root.js", () => ({
  findProjectRoot: (_: string) => tmpRoot,
  getProjectRoot: () => tmpRoot,
  dotClaudePath: (...segments: string[]) =>
    [tmpRoot, ".claude", ...segments].join("/"),
}));

const { resolveReadmeAsset, readReadmeAsset } = await import(
  "../src/server/readme/readme-assets.js"
);
const { stateRoutes } = await import("../src/server/routes/state-routes.js");

beforeAll(() => {
  tmpRoot = join(tmpdir(), `ccmaf-readme-assets-${Date.now()}`);
  // A README + a .github/assets image (the GitHub idiom location).
  mkdirSync(join(tmpRoot, ".github", "assets"), { recursive: true });
  writeFileSync(join(tmpRoot, "README.md"), "# Hi", "utf8");
  // Minimal valid-ish bytes; the reader serves bytes, doesn't validate image content.
  writeFileSync(join(tmpRoot, ".github", "assets", "hero.webp"), "RIFFwebp", "utf8");
  writeFileSync(
    join(tmpRoot, ".github", "assets", "diagram.svg"),
    "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
    "utf8"
  );
  // A NON-image file inside the repo (must NOT be servable through this endpoint).
  writeFileSync(join(tmpRoot, ".github", "secret.env"), "TOKEN=xyz", "utf8");
  mkdirSync(join(tmpRoot, ".claude"), { recursive: true });
  // A file OUTSIDE the repo root — the traversal target.
  writeFileSync(join(tmpdir(), "ccmaf-outside-secret.txt"), "secret", "utf8");
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("resolveReadmeAsset — confinement + image allowlist", () => {
  it("resolves an image under .github/assets", () => {
    const { contentType } = resolveReadmeAsset(".github/assets/hero.webp");
    expect(contentType).toBe("image/webp");
  });

  it("resolves an svg with the right content-type", () => {
    expect(resolveReadmeAsset(".github/assets/diagram.svg").contentType).toBe(
      "image/svg+xml"
    );
  });

  it("REJECTS a non-image file even inside the repo", () => {
    expect(() => resolveReadmeAsset(".github/secret.env")).toThrow();
  });

  it("REJECTS a traversal escape", () => {
    expect(() => resolveReadmeAsset("../ccmaf-outside-secret.txt")).toThrow();
    expect(() => resolveReadmeAsset("../../../../etc/passwd")).toThrow();
  });

  it("REJECTS an absolute path outside the repo", () => {
    expect(() =>
      resolveReadmeAsset(join(tmpdir(), "ccmaf-outside-secret.txt"))
    ).toThrow();
  });

  it("REJECTS a NUL-poisoned path and a missing file", () => {
    expect(() => resolveReadmeAsset(".github/assets/hero.webp\0.txt")).toThrow();
    expect(() => resolveReadmeAsset(".github/assets/nope.png")).toThrow();
  });

  it("readReadmeAsset returns bytes + content-type", () => {
    const { buffer, contentType } = readReadmeAsset(".github/assets/hero.webp");
    expect(buffer.toString("utf8")).toContain("webp");
    expect(contentType).toBe("image/webp");
  });
});

describe("GET /api/readme/asset (route)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(stateRoutes);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("serves an allowlisted image with nosniff + CSP", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/readme/asset?path=" + encodeURIComponent(".github/assets/hero.webp"),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("image/webp");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("404s a non-image file", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/readme/asset?path=" + encodeURIComponent(".github/secret.env"),
    });
    expect(res.statusCode).toBe(404);
  });

  it("404s a traversal attempt", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/readme/asset?path=" + encodeURIComponent("../ccmaf-outside-secret.txt"),
    });
    expect(res.statusCode).toBe(404);
  });

  it("400s a missing path param", async () => {
    const res = await app.inject({ method: "GET", url: "/api/readme/asset" });
    expect(res.statusCode).toBe(400);
  });
});
