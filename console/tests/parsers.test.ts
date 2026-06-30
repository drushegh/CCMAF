// @vitest-environment node
/**
 * parsers.test.ts — Unit tests for TASK-003 state-file parsers.
 *
 * Tests:
 *   Tasks parser:
 *     1. Empty content → empty columns array
 *     2. Feature lane items grouped by status
 *     3. Bug lane items grouped by status
 *     4. Task IDs parsed correctly (TASK-XXX / BUG-XXX)
 *     5. Missing file → empty TaskBoard
 *     6. Columns without items still appear in the board
 *
 *   Contracts parser:
 *     7. Stable anchor extracted with ### title
 *     8. Draft anchor extracted with ## title fallback
 *     9. Multiple anchors in one file
 *    10. Missing file → empty array
 *
 *   Decisions parser:
 *    11. Single decision parsed (id, date, status, title, body)
 *    12. Multiple decisions parsed in order
 *    13. Missing file → empty array
 *    14. Body includes multi-line content
 *
 *   Specs parser:
 *    15. Lists *.md files (ignores .gitkeep / dotfiles)
 *    16. Reads a named spec doc
 *    17. Missing dir → empty array
 *    18. Non-existent name → null
 *    19. Name with path separators → null (safety)
 *    20. Name with ".." → null (safety)
 *
 *   README parser:
 *    21. Existing README → { exists: true, markdown }
 *    22. Missing file → { exists: false, markdown: "" }
 *
 *   Plugin (Fastify inject):
 *    23. GET /api/tasks returns TaskBoard shape
 *    24. GET /api/contracts returns array
 *    25. GET /api/decisions returns array
 *    26. GET /api/specs returns SpecRef[]
 *    27. GET /api/specs/:name 404 for unknown spec
 *    28. GET /api/readme returns ReadmeDoc shape
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TASKS_FIXTURE = `
# Task Board

## Feature Lane

### In Progress

#### [TASK-003] State parsers
- Some detail
#### [TASK-004] Verify API
- Another detail

### Done

#### [TASK-001] Scaffold
#### [TASK-002] Server

## Bug-Fix Lane

### Fixing

#### [BUG-001] Some bug
`;

const ECOSYSTEM_FIXTURE = `
# Ecosystem

## API & Data Contracts

### contract:console-verify-file — the handback pass-file

Some prose here.

<!-- contract:console-verify-file status:stable -->

\`\`\`json
{}
\`\`\`

### contract:console-http-api — the Console server surface

<!-- contract:console-http-api status:stable -->

## Draft Section

### A draft contract

<!-- contract:draft-thing status:draft -->
`;

const DECISIONS_FIXTURE = `
# Decision Log

## DEC-002 — No-state-projection confirmed
**Date:** 2026-06-23 · **Status:** active
**Decision:** The Console owns no authoritative state.
**Rationale:** Robust and Claude-friendly.
**Rejected:** limited app-side state.

## DEC-001 — Multi-agent framework scaffolded
**Date:** 2026-06-23 · **Status:** active
**Decision:** Scaffolded the framework.
**Rationale:** Standard setup.
`;

// ── Mock project-root ─────────────────────────────────────────────────────────
// We set up a real temp dir for parsers that need real files (specs, readme).

let tmpRoot = "";
let specsDir = "";
let specFile = "";
let readmePath = "";

vi.mock("../src/server/project-root.js", () => {
  return {
    findProjectRoot: (_: string) => tmpRoot,
    getProjectRoot: () => tmpRoot,
    dotClaudePath: (...segments: string[]) =>
      [tmpRoot, ".claude", ...segments].join("/"),
  };
});

// Import parsers AFTER the mock is set up
const { parseTasksMd, parseTasksFile } = await import(
  "../src/server/parsers/tasks-parser.js"
);
const { parseEcosystemMd, parseContractsFile } = await import(
  "../src/server/parsers/contracts-parser.js"
);
const { parseDecisionsMd, parseDecisionsFile } = await import(
  "../src/server/parsers/decisions-parser.js"
);
const { parseSpecsList, readSpecDoc } = await import(
  "../src/server/parsers/specs-parser.js"
);
const { parseReadmeFile } = await import(
  "../src/server/parsers/readme-parser.js"
);
const { stateRoutes } = await import(
  "../src/server/routes/state-routes.js"
);

// ── Temp dir setup ─────────────────────────────────────────────────────────────

beforeAll(() => {
  tmpRoot = join(tmpdir(), `ccmaf-parsers-${Date.now()}`);
  const dotClaude = join(tmpRoot, ".claude");
  specsDir = join(dotClaude, "framework", "docs", "specs");
  readmePath = join(tmpRoot, "README.md");

  mkdirSync(specsDir, { recursive: true });

  // Write fixture files
  writeFileSync(join(dotClaude, "TASKS.md"), TASKS_FIXTURE, "utf8");
  writeFileSync(join(dotClaude, "ECOSYSTEM.md"), ECOSYSTEM_FIXTURE, "utf8");
  writeFileSync(join(dotClaude, "DECISIONS.md"), DECISIONS_FIXTURE, "utf8");

  specFile = join(specsDir, "SPEC-test.md");
  writeFileSync(specFile, "# Test spec\n\nContent here.", "utf8");
  // A dotfile that should be ignored
  writeFileSync(join(specsDir, ".gitkeep"), "", "utf8");

  writeFileSync(readmePath, "# My Project\n\nHello world.", "utf8");
  // TASK-027: a state doc surfaced via /api/statedoc/:key
  writeFileSync(
    join(dotClaude, "STATUS.md"),
    "# Project Status\n\nSprint goal here.",
    "utf8"
  );
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ── Tasks parser ──────────────────────────────────────────────────────────────

describe("parseTasksMd", () => {
  it("returns empty columns for empty content", () => {
    const board = parseTasksMd("");
    expect(board.columns).toEqual([]);
  });

  it("parses feature lane items grouped by status", () => {
    const board = parseTasksMd(TASKS_FIXTURE);
    const inProgress = board.columns.find(
      (c) => c.status === "In Progress" && c.lane === "feature"
    );
    expect(inProgress).toBeDefined();
    expect(inProgress!.items).toHaveLength(2);
    expect(inProgress!.items[0].id).toBe("TASK-003");
    expect(inProgress!.items[1].id).toBe("TASK-004");
  });

  it("parses feature lane Done column", () => {
    const board = parseTasksMd(TASKS_FIXTURE);
    const done = board.columns.find(
      (c) => c.status === "Done" && c.lane === "feature"
    );
    expect(done).toBeDefined();
    expect(done!.items).toHaveLength(2);
  });

  it("parses bug lane items", () => {
    const board = parseTasksMd(TASKS_FIXTURE);
    const fixing = board.columns.find(
      (c) => c.status === "Fixing" && c.lane === "bug"
    );
    expect(fixing).toBeDefined();
    expect(fixing!.items[0].id).toBe("BUG-001");
    expect(fixing!.items[0].lane).toBe("bug");
  });

  it("populates title and status on each item", () => {
    const board = parseTasksMd(TASKS_FIXTURE);
    const inProgress = board.columns.find((c) => c.status === "In Progress")!;
    const item = inProgress.items[0];
    expect(item.title).toBe("State parsers");
    expect(item.status).toBe("In Progress");
    expect(item.lane).toBe("feature");
  });

  it("columns with no items still appear (empty status sections)", () => {
    const content = `
## Feature Lane

### Todo

## Bug-Fix Lane

### Reported
`;
    const board = parseTasksMd(content);
    expect(board.columns.some((c) => c.status === "Todo")).toBe(true);
    expect(board.columns.some((c) => c.status === "Reported")).toBe(true);
  });

  // BUG-001 fix (a): strip trailing parenthetical(s) from column heading
  it("strips trailing parenthetical from column heading (BUG-001a)", () => {
    const content = `
## Feature Lane

### Todo (Priority Order)

#### [TASK-010] Some task
`;
    const board = parseTasksMd(content);
    // Must appear as "Todo", NOT "Todo (Priority Order)"
    expect(board.columns.some((c) => c.status === "Todo")).toBe(true);
    expect(board.columns.some((c) => c.status === "Todo (Priority Order)")).toBe(false);
    const todo = board.columns.find((c) => c.status === "Todo")!;
    expect(todo.items).toHaveLength(1);
    expect(todo.items[0].id).toBe("TASK-010");
  });

  it("strips multiple trailing parentheticals from column heading", () => {
    const content = `
## Feature Lane

### Foo (a) (b)
`;
    const board = parseTasksMd(content);
    expect(board.columns.some((c) => c.status === "Foo")).toBe(true);
    expect(board.columns.some((c) => c.status === "Foo (a) (b)")).toBe(false);
  });

  // BUG-001 fix (b): ### headings inside <!-- --> are NOT parsed as columns
  it("ignores ### heading inside a multi-line HTML comment (BUG-001b)", () => {
    const content = `
## Bug-Fix Lane

### Fixing

<!-- Template:
### [BUG-XXX] Short description
- some template content
-->

### Done
`;
    const board = parseTasksMd(content);
    // "[BUG-XXX] Short description" must NOT appear as a column
    expect(board.columns.some((c) => c.status.includes("BUG-XXX"))).toBe(false);
    // Real columns should still be present
    expect(board.columns.some((c) => c.status === "Fixing")).toBe(true);
    expect(board.columns.some((c) => c.status === "Done")).toBe(true);
  });

  it("ignores task items inside a multi-line HTML comment", () => {
    const content = `
## Feature Lane

### In Progress

<!--
#### [TASK-999] This should not appear
-->

#### [TASK-001] This should appear
`;
    const board = parseTasksMd(content);
    const inProgress = board.columns.find((c) => c.status === "In Progress")!;
    expect(inProgress).toBeDefined();
    expect(inProgress.items).toHaveLength(1);
    expect(inProgress.items[0].id).toBe("TASK-001");
    expect(inProgress.items.some((i) => i.id === "TASK-999")).toBe(false);
  });

  it("handles a single-line self-contained HTML comment without breaking parsing", () => {
    const content = `
## Feature Lane

<!-- Full lifecycle: Todo → Done -->

### Done

#### [TASK-002] Finished task
`;
    const board = parseTasksMd(content);
    const done = board.columns.find((c) => c.status === "Done")!;
    expect(done).toBeDefined();
    expect(done.items).toHaveLength(1);
    expect(done.items[0].id).toBe("TASK-002");
  });

  it("handles CRLF line endings correctly", () => {
    const content =
      "## Feature Lane\r\n\r\n### In Progress\r\n\r\n#### [TASK-001] A task\r\n";
    const board = parseTasksMd(content);
    const col = board.columns.find((c) => c.status === "In Progress")!;
    expect(col).toBeDefined();
    expect(col.items[0].id).toBe("TASK-001");
  });

  // ── Archived flag (TASK-023) ──────────────────────────────────────────────
  it("defaults archived to false when there is no marker", () => {
    const content = "## Feature Lane\n\n### Done\n\n#### [TASK-001] A task\n";
    const board = parseTasksMd(content);
    const item = board.columns.find((c) => c.status === "Done")!.items[0];
    expect(item.archived).toBe(false);
  });

  it("marks a task archived when an <!-- archived --> marker follows its heading", () => {
    const content =
      "## Feature Lane\n\n### Done\n\n#### [TASK-001] A task\n<!-- archived -->\n- body\n";
    const board = parseTasksMd(content);
    const item = board.columns.find((c) => c.status === "Done")!.items[0];
    expect(item.archived).toBe(true);
  });

  it("attaches the marker to the right task and leaves siblings unarchived", () => {
    const content = [
      "## Feature Lane",
      "",
      "### Done",
      "",
      "#### [TASK-001] First",
      "<!-- archived -->",
      "- body one",
      "",
      "#### [TASK-002] Second",
      "- body two",
      "",
    ].join("\n");
    const board = parseTasksMd(content);
    const done = board.columns.find((c) => c.status === "Done")!;
    const t1 = done.items.find((i) => i.id === "TASK-001")!;
    const t2 = done.items.find((i) => i.id === "TASK-002")!;
    expect(t1.archived).toBe(true);
    expect(t2.archived).toBe(false);
  });
});

describe("parseTasksFile — missing file", () => {
  it("returns empty TaskBoard for a non-existent path", () => {
    const board = parseTasksFile("/nonexistent/TASKS.md");
    expect(board.columns).toEqual([]);
  });

  it("reads the fixture file from disk", () => {
    const filePath = join(tmpRoot, ".claude", "TASKS.md");
    const board = parseTasksFile(filePath);
    expect(board.columns.length).toBeGreaterThan(0);
  });
});

// ── Contracts parser ──────────────────────────────────────────────────────────

describe("parseEcosystemMd", () => {
  it("extracts stable contract with ### title", () => {
    const contracts = parseEcosystemMd(ECOSYSTEM_FIXTURE);
    const verify = contracts.find((c) => c.id === "console-verify-file");
    expect(verify).toBeDefined();
    expect(verify!.status).toBe("stable");
    expect(verify!.title).toContain("console-verify-file");
  });

  it("extracts a second stable contract", () => {
    const contracts = parseEcosystemMd(ECOSYSTEM_FIXTURE);
    const http = contracts.find((c) => c.id === "console-http-api");
    expect(http).toBeDefined();
    expect(http!.status).toBe("stable");
  });

  it("extracts draft contract", () => {
    const contracts = parseEcosystemMd(ECOSYSTEM_FIXTURE);
    const draft = contracts.find((c) => c.id === "draft-thing");
    expect(draft).toBeDefined();
    expect(draft!.status).toBe("draft");
  });

  it("returns 3 contracts from the fixture", () => {
    const contracts = parseEcosystemMd(ECOSYSTEM_FIXTURE);
    expect(contracts).toHaveLength(3);
  });

  it("returns empty array for empty content", () => {
    expect(parseEcosystemMd("")).toEqual([]);
  });
});

describe("parseContractsFile — missing file", () => {
  it("returns [] for a non-existent path", () => {
    expect(parseContractsFile("/nonexistent/ECOSYSTEM.md")).toEqual([]);
  });

  it("reads the fixture file from disk", () => {
    const filePath = join(tmpRoot, ".claude", "ECOSYSTEM.md");
    const contracts = parseContractsFile(filePath);
    expect(contracts.length).toBeGreaterThan(0);
  });
});

// ── Decisions parser ──────────────────────────────────────────────────────────

describe("parseDecisionsMd", () => {
  it("parses a decision entry id and title", () => {
    const decisions = parseDecisionsMd(DECISIONS_FIXTURE);
    expect(decisions[0].id).toBe("DEC-002");
    expect(decisions[0].title).toBe("No-state-projection confirmed");
  });

  it("parses date and status", () => {
    const decisions = parseDecisionsMd(DECISIONS_FIXTURE);
    expect(decisions[0].date).toBe("2026-06-23");
    expect(decisions[0].status).toBe("active");
  });

  it("captures body text", () => {
    const decisions = parseDecisionsMd(DECISIONS_FIXTURE);
    expect(decisions[0].body).toContain("Console owns no authoritative state");
  });

  it("parses multiple decisions in document order", () => {
    const decisions = parseDecisionsMd(DECISIONS_FIXTURE);
    expect(decisions).toHaveLength(2);
    expect(decisions[0].id).toBe("DEC-002");
    expect(decisions[1].id).toBe("DEC-001");
  });

  it("returns empty array for empty content", () => {
    expect(parseDecisionsMd("")).toEqual([]);
  });

  // ── TASK-033: framework house style — date headings, no meta line ──
  it("reads a `## YYYY-MM-DD — Title` date heading (synthesized id, status active)", () => {
    const md = `# Decision Log

## 2026-06-25 — Adopt the thing (TASK-1)
We decided to adopt it.

## DEC-009 — A normal one
**Date:** 2026-06-20 · **Status:** active
**Decision:** normal.
`;
    const decs = parseDecisionsMd(md);
    expect(decs.map((d) => d.id)).toEqual(["2026-06-25", "DEC-009"]);
    const dated = decs[0];
    expect(dated.title).toBe("Adopt the thing (TASK-1)");
    expect(dated.date).toBe("2026-06-25");
    expect(dated.status).toBe("active");
    expect(dated.body).toContain("We decided to adopt it.");
    // The DEC-N entry still parses normally alongside it.
    expect(decs[1].status).toBe("active");
    expect(decs[1].date).toBe("2026-06-20");
  });
});

describe("parseDecisionsFile — missing file", () => {
  it("returns [] for a non-existent path", () => {
    expect(parseDecisionsFile("/nonexistent/DECISIONS.md")).toEqual([]);
  });

  it("reads the fixture file from disk", () => {
    const filePath = join(tmpRoot, ".claude", "DECISIONS.md");
    const decisions = parseDecisionsFile(filePath);
    expect(decisions.length).toBeGreaterThan(0);
  });
});

// ── Specs parser ──────────────────────────────────────────────────────────────

describe("parseSpecsList", () => {
  it("lists .md files, excluding dotfiles", () => {
    const refs = parseSpecsList(specsDir);
    expect(refs.some((r) => r.name === "SPEC-test")).toBe(true);
    // .gitkeep should not appear
    expect(refs.every((r) => !r.name.startsWith("."))).toBe(true);
  });

  it("returns [] for a non-existent directory", () => {
    expect(parseSpecsList("/nonexistent/specs")).toEqual([]);
  });
});

describe("readSpecDoc", () => {
  it("returns spec content for a known spec", () => {
    const doc = readSpecDoc(specsDir, "SPEC-test");
    expect(doc).not.toBeNull();
    expect(doc!.name).toBe("SPEC-test");
    expect(doc!.markdown).toContain("Test spec");
  });

  it("returns null for an unknown spec", () => {
    expect(readSpecDoc(specsDir, "SPEC-nonexistent")).toBeNull();
  });

  it("returns null for name with forward slash (safety)", () => {
    expect(readSpecDoc(specsDir, "../../etc/passwd")).toBeNull();
  });

  it("returns null for name with backslash (safety)", () => {
    expect(readSpecDoc(specsDir, "foo\\bar")).toBeNull();
  });

  it("returns null for name with '..' segment (safety)", () => {
    expect(readSpecDoc(specsDir, "..")).toBeNull();
  });

  it("returns null for name starting with '.' (safety)", () => {
    expect(readSpecDoc(specsDir, ".gitkeep")).toBeNull();
  });
});

// ── README parser ─────────────────────────────────────────────────────────────

describe("parseReadmeFile", () => {
  it("returns exists:true and markdown for a real file", () => {
    const doc = parseReadmeFile(readmePath);
    expect(doc.exists).toBe(true);
    expect(doc.markdown).toContain("My Project");
  });

  it("returns exists:false and empty string for a missing file", () => {
    const doc = parseReadmeFile("/nonexistent/README.md");
    expect(doc.exists).toBe(false);
    expect(doc.markdown).toBe("");
  });
});

// ── Fastify plugin (inject tests) ─────────────────────────────────────────────

describe("stateRoutes plugin", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(stateRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/tasks returns a TaskBoard shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/tasks" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ columns: unknown[] }>();
    expect(Array.isArray(body.columns)).toBe(true);
  });

  it("GET /api/contracts returns an array", async () => {
    const res = await app.inject({ method: "GET", url: "/api/contracts" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("GET /api/decisions returns an array", async () => {
    const res = await app.inject({ method: "GET", url: "/api/decisions" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("GET /api/specs returns SpecRef[]", async () => {
    const res = await app.inject({ method: "GET", url: "/api/specs" });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ name: string }>>();
    expect(Array.isArray(body)).toBe(true);
    // Our fixture spec file should appear
    expect(body.some((s) => s.name === "SPEC-test")).toBe(true);
  });

  it("GET /api/specs/:name 404 for unknown spec", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/specs/SPEC-nonexistent",
    });
    expect(res.statusCode).toBe(404);
  });

  it("GET /api/specs/:name 200 for known spec", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/specs/SPEC-test",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ name: string; markdown: string }>();
    expect(body.name).toBe("SPEC-test");
    expect(body.markdown).toContain("Test spec");
  });

  it("GET /api/readme returns ReadmeDoc shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/readme" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ exists: boolean; markdown: string }>();
    expect(typeof body.exists).toBe("boolean");
    expect(typeof body.markdown).toBe("string");
  });

  // ── TASK-027: /api/statedoc/:key (whitelisted state files) ──────────────────
  it("GET /api/statedoc/status returns the rendered STATUS.md", async () => {
    const res = await app.inject({ method: "GET", url: "/api/statedoc/status" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ key: string; exists: boolean; markdown: string }>();
    expect(body.key).toBe("status");
    expect(body.exists).toBe(true);
    expect(body.markdown).toContain("Project Status");
  });

  it("GET /api/statedoc/:key 404s an unknown (non-whitelisted) key", async () => {
    // The whitelist is the security boundary — a traversal-ish key resolves nothing.
    const res = await app.inject({
      method: "GET",
      url: "/api/statedoc/..%2f..%2fpackage",
    });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ exists: boolean }>();
    expect(body.exists).toBe(false);
  });
});
