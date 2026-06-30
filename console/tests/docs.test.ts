/**
 * docs.test.ts — Docs browser: tree + safe file access (TASK-028)
 *
 * The security properties are the point of this suite: paths are confined to
 * docs/, extensions are allowlisted, traversal is refused.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";

// ── Mock project-root so docsRoot() resolves to our tmp tree ──────────────────
let tmpRoot = "";
vi.mock("../src/server/project-root.js", () => ({
  findProjectRoot: (_: string) => tmpRoot,
  getProjectRoot: () => tmpRoot,
  dotClaudePath: (...segments: string[]) =>
    [tmpRoot, ".claude", ...segments].join("/"),
}));

const { buildDocsTree, resolveDocPath, readDoc } = await import(
  "../src/server/docs/docs-fs.js"
);
const { docsRoutes } = await import("../src/server/routes/docs-routes.js");

beforeAll(() => {
  tmpRoot = join(tmpdir(), `ccmaf-docs-${Date.now()}`);
  // docsRoot() resolves to <projectRoot>/01_Project/docs.
  const docs = join(tmpRoot, "01_Project", "docs");
  mkdirSync(join(docs, "inspiration"), { recursive: true });

  writeFileSync(join(docs, "README.md"), "# Docs\n\nHello.", "utf8");
  writeFileSync(join(docs, "inspiration", "about.md"), "# Inspiration", "utf8");
  writeFileSync(
    join(docs, "inspiration", "icon.svg"),
    "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
    "utf8"
  );
  // A dotfile (should be skipped by the tree) and a non-allowlisted file.
  writeFileSync(join(docs, ".gitkeep"), "", "utf8");
  writeFileSync(join(docs, "secret.js"), "alert(1)", "utf8");
  // A file just OUTSIDE the docs root — the traversal target (../outside.txt).
  writeFileSync(join(tmpRoot, "01_Project", "outside.txt"), "secret", "utf8");
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("buildDocsTree", () => {
  it("lists files + nested dirs, dirs first, dotfiles skipped", () => {
    const tree = buildDocsTree();
    expect(tree.exists).toBe(true);
    const names = tree.root!.children!.map((c) => c.name);
    // README.md + secret.js (files) + inspiration (dir); .gitkeep skipped.
    expect(names).toContain("inspiration");
    expect(names).toContain("README.md");
    expect(names).not.toContain(".gitkeep");
    // Dirs sort before files.
    expect(names[0]).toBe("inspiration");

    const insp = tree.root!.children!.find((c) => c.name === "inspiration")!;
    expect(insp.type).toBe("dir");
    const inspNames = insp.children!.map((c) => c.name).sort();
    expect(inspNames).toEqual(["about.md", "icon.svg"]);
  });

  it("returns {exists:false} when docs/ is absent", () => {
    const saved = tmpRoot;
    tmpRoot = join(tmpdir(), `ccmaf-docs-none-${Date.now()}`);
    try {
      const tree = buildDocsTree();
      expect(tree.exists).toBe(false);
      expect(tree.root).toBeNull();
    } finally {
      tmpRoot = saved;
    }
  });
});

describe("resolveDocPath — confinement + allowlist", () => {
  it("resolves an allowlisted file inside docs/", () => {
    const { ext } = resolveDocPath("README.md");
    expect(ext).toBe("md");
  });

  it("resolves a nested file", () => {
    const { ext } = resolveDocPath("inspiration/icon.svg");
    expect(ext).toBe("svg");
  });

  it("REJECTS a traversal escape (../outside.txt)", () => {
    expect(() => resolveDocPath("../outside.txt")).toThrow();
  });

  it("REJECTS a deep traversal escape", () => {
    expect(() => resolveDocPath("../../../../etc/passwd")).toThrow();
  });

  it("REJECTS an absolute path outside docs/", () => {
    expect(() => resolveDocPath(join(tmpRoot, "outside.txt"))).toThrow();
  });

  it("REJECTS a non-allowlisted extension (.js)", () => {
    expect(() => resolveDocPath("secret.js")).toThrow();
  });

  it("REJECTS a missing file", () => {
    expect(() => resolveDocPath("nope.md")).toThrow();
  });

  it("REJECTS a NUL-poisoned path", () => {
    expect(() => resolveDocPath("README.md\0.png")).toThrow();
  });

  it("readDoc returns bytes + content-type for an allowlisted file", () => {
    const { buffer, contentType } = readDoc("README.md");
    expect(buffer.toString("utf8")).toContain("Hello.");
    expect(contentType).toContain("text/markdown");
  });
});

describe("docsRoutes plugin", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(docsRoutes);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it("GET /api/docs returns the tree", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ exists: boolean; root: { children: unknown[] } }>();
    expect(body.exists).toBe(true);
    expect(Array.isArray(body.root.children)).toBe(true);
  });

  it("GET /api/docs/raw serves an allowlisted file with content-type", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/docs/raw?path=README.md",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/markdown");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body).toContain("Hello.");
  });

  it("GET /api/docs/raw 404s a traversal attempt", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/docs/raw?path=" + encodeURIComponent("../outside.txt"),
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/docs/raw 404s a non-allowlisted file", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/docs/raw?path=secret.js",
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/docs/raw 400s a missing path param", async () => {
    const res = await app.inject({ method: "GET", url: "/api/docs/raw" });
    expect(res.statusCode).toBe(400);
  });
});

// TASK-034 — dual-root: when BOTH <root>/docs and <root>/01_Project/docs exist,
// the tree presents each as a top-level node and the raw reader dispatches by key.
describe("buildDocsTree + resolveDocPath — dual-root (TASK-034)", () => {
  let savedRoot = "";
  let dualRoot = "";

  beforeAll(() => {
    savedRoot = tmpRoot;
    dualRoot = join(tmpdir(), `ccmaf-docs-dual-${Date.now()}`);
    // Root-level docs/ (framework scaffold home)
    mkdirSync(join(dualRoot, "docs"), { recursive: true });
    writeFileSync(join(dualRoot, "docs", "guide.md"), "# Root guide", "utf8");
    // App docs (CCMAF's own)
    mkdirSync(join(dualRoot, "01_Project", "docs", "diagrams"), {
      recursive: true,
    });
    writeFileSync(
      join(dualRoot, "01_Project", "docs", "app.md"),
      "# App docs",
      "utf8"
    );
    writeFileSync(
      join(dualRoot, "01_Project", "docs", "diagrams", "arch.svg"),
      "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
      "utf8"
    );
    tmpRoot = dualRoot;
  });

  afterAll(() => {
    rmSync(dualRoot, { recursive: true, force: true });
    tmpRoot = savedRoot;
  });

  it("presents each active root as a key-prefixed top-level node", () => {
    const tree = buildDocsTree();
    expect(tree.exists).toBe(true);
    const tops = tree.root!.children!;
    const labels = tops.map((c) => c.name).sort();
    expect(labels).toEqual(["01_Project/docs", "docs"]);

    const rootDocs = tops.find((c) => c.name === "docs")!;
    expect(rootDocs.path).toBe("docs");
    expect(rootDocs.children!.map((c) => c.path)).toContain("docs/guide.md");

    const appDocs = tops.find((c) => c.name === "01_Project/docs")!;
    expect(appDocs.path).toBe("01_Project-docs");
    expect(appDocs.children!.map((c) => c.path)).toContain("01_Project-docs/app.md");
  });

  it("resolveDocPath dispatches a key-prefixed path to the right root", () => {
    expect(resolveDocPath("docs/guide.md").ext).toBe("md");
    expect(resolveDocPath("01_Project-docs/app.md").ext).toBe("md");
    expect(resolveDocPath("01_Project-docs/diagrams/arch.svg").ext).toBe("svg");
  });

  it("resolveDocPath still resolves an unprefixed path (README transform) by trying each root", () => {
    // The README image transform passes a root-relative path (no key) — it must
    // still find the file under one of the active roots.
    expect(resolveDocPath("guide.md").ext).toBe("md"); // lives under docs/
    expect(resolveDocPath("diagrams/arch.svg").ext).toBe("svg"); // under 01_Project/docs/
  });

  it("still REJECTS a traversal escape across roots", () => {
    expect(() => resolveDocPath("docs/../../etc/passwd")).toThrow();
    expect(() => resolveDocPath("../../../../etc/passwd")).toThrow();
  });
});
