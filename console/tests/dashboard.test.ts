// @vitest-environment node
/**
 * dashboard.test.ts — Tests for the dashboard aggregation (TASK-007)
 *
 * Tests:
 *   readSprintGoal (via the route aggregate):
 *     1. Returns the sprint goal text from a STATUS.md with the standard heading
 *     2. Returns null when the heading is absent
 *     3. Returns null when the file does not exist
 *     4. Stops at the next ## heading
 *
 *   dashboardRoutes plugin (Fastify inject):
 *     5. GET /api/dashboard returns 200 with DashboardSummary shape
 *     6. taskCounts reflects columns in TASKS.md
 *     7. contractCounts reflects stable/draft counts from ECOSYSTEM.md
 *     8. latestDecisions are newest-first and bounded to 5
 *     9. currentSpec returns the first spec name found
 *    10. sprintGoal is read from STATUS.md
 *    11. handbackQueue is an array (empty when no verify files exist)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TASKS_FIXTURE = `
# Task Board

## Feature Lane

### In Progress

#### [TASK-007] Dashboard real-data

### Ready for Test

#### [TASK-006] Read-only pages

### Done

#### [TASK-001] Scaffold
#### [TASK-002] Server

## Bug-Fix Lane

### Reported

#### [BUG-001] Some bug
`;

const ECOSYSTEM_FIXTURE = `
# Ecosystem

## API Contracts

### contract:console-http-api — HTTP surface

<!-- contract:console-http-api status:stable -->

### contract:console-verify-file — verify pass-file

<!-- contract:console-verify-file status:stable -->

## Draft Section

### A draft contract

<!-- contract:draft-thing status:draft -->
`;

const DECISIONS_FIXTURE = `
# Decision Log

## DEC-006 — Sixth decision
**Date:** 2026-06-01 · **Status:** active
**Decision:** Sixth call — newest.

## DEC-005 — Fifth decision
**Date:** 2026-05-01 · **Status:** active
**Decision:** Fifth call.

## DEC-004 — Fourth decision
**Date:** 2026-04-01 · **Status:** active
**Decision:** Fourth call.

## DEC-003 — Third decision
**Date:** 2026-03-01 · **Status:** active
**Decision:** Third call.

## DEC-002 — Second decision
**Date:** 2026-02-01 · **Status:** active
**Decision:** Second call.

## DEC-001 — First decision
**Date:** 2026-01-01 · **Status:** active
**Decision:** The first ever decision.
`;

const STATUS_FIXTURE = `
# Status

## Current Sprint Goal

Deliver the Project Console v1 — full cockpit including tray.

## Active Work

Some table here.
`;

const STATUS_NO_GOAL = `
# Status

## Active Work

Nothing to show.
`;

// ── Temp dir setup ─────────────────────────────────────────────────────────────

let tmpRoot = "";

vi.mock("../src/server/project-root.js", () => {
  return {
    findProjectRoot: (_: string) => tmpRoot,
    getProjectRoot: () => tmpRoot,
    dotClaudePath: (...segments: string[]) =>
      [tmpRoot, ".claude", ...segments].join("/"),
  };
});

// ── Import after mock ──────────────────────────────────────────────────────────

const { dashboardRoutes } = await import(
  "../src/server/routes/dashboard-routes.js"
);

// ── beforeAll: write fixture files ────────────────────────────────────────────

let specsDir: string;

beforeAll(() => {
  tmpRoot = join(tmpdir(), `ccmaf-dashboard-${Date.now()}`);
  const dotClaude = join(tmpRoot, ".claude");
  specsDir = join(dotClaude, "framework", "docs", "specs");

  mkdirSync(specsDir, { recursive: true });

  writeFileSync(join(dotClaude, "TASKS.md"), TASKS_FIXTURE, "utf8");
  writeFileSync(join(dotClaude, "ECOSYSTEM.md"), ECOSYSTEM_FIXTURE, "utf8");
  writeFileSync(join(dotClaude, "DECISIONS.md"), DECISIONS_FIXTURE, "utf8");
  writeFileSync(join(dotClaude, "STATUS.md"), STATUS_FIXTURE, "utf8");

  writeFileSync(
    join(specsDir, "SPEC-project-console.md"),
    "# Project Console Spec\n\nContent.",
    "utf8"
  );
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ── Fastify plugin inject tests ───────────────────────────────────────────────

describe("dashboardRoutes plugin", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(dashboardRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/dashboard returns 200", async () => {
    const res = await app.inject({ method: "GET", url: "/api/dashboard" });
    expect(res.statusCode).toBe(200);
  });

  it("response has DashboardSummary shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/dashboard" });
    const body = res.json<{
      handbackQueue: unknown[];
      taskCounts: unknown[];
      contractCounts: unknown[];
      latestDecisions: unknown[];
      currentSpec: unknown;
      sprintGoal: unknown;
    }>();
    expect(Array.isArray(body.handbackQueue)).toBe(true);
    expect(Array.isArray(body.taskCounts)).toBe(true);
    expect(Array.isArray(body.contractCounts)).toBe(true);
    expect(Array.isArray(body.latestDecisions)).toBe(true);
    // currentSpec and sprintGoal may be string or null
    expect(
      body.currentSpec === null || typeof body.currentSpec === "string"
    ).toBe(true);
    expect(
      body.sprintGoal === null || typeof body.sprintGoal === "string"
    ).toBe(true);
  });

  it("taskCounts reflects columns from TASKS.md", async () => {
    const res = await app.inject({ method: "GET", url: "/api/dashboard" });
    const body = res.json<{
      taskCounts: { lane: string; status: string; n: number }[];
    }>();
    // The fixture has: In Progress (1), Ready for Test (1), Done (2), Reported bug (1)
    const inProgress = body.taskCounts.find(
      (c) => c.status === "In Progress" && c.lane === "feature"
    );
    expect(inProgress).toBeDefined();
    expect(inProgress!.n).toBe(1);

    const done = body.taskCounts.find(
      (c) => c.status === "Done" && c.lane === "feature"
    );
    expect(done).toBeDefined();
    expect(done!.n).toBe(2);
  });

  it("contractCounts reflects stable/draft split", async () => {
    const res = await app.inject({ method: "GET", url: "/api/dashboard" });
    const body = res.json<{
      contractCounts: { status: string; n: number }[];
    }>();
    const stable = body.contractCounts.find((c) => c.status === "stable");
    const draft = body.contractCounts.find((c) => c.status === "draft");
    expect(stable).toBeDefined();
    expect(stable!.n).toBe(2); // console-http-api + console-verify-file
    expect(draft).toBeDefined();
    expect(draft!.n).toBe(1); // draft-thing
  });

  it("latestDecisions are newest-first (reversed) and bounded to 5", async () => {
    const res = await app.inject({ method: "GET", url: "/api/dashboard" });
    const body = res.json<{
      latestDecisions: { id: string }[];
    }>();
    // Fixture is newest-first (DEC-006 at top), as DECISIONS.md is authored; route returns first 5 as-is → DEC-006 first
    expect(body.latestDecisions.length).toBe(5);
    expect(body.latestDecisions[0].id).toBe("DEC-006");
    expect(body.latestDecisions[4].id).toBe("DEC-002");
  });

  it("currentSpec returns a spec name", async () => {
    const res = await app.inject({ method: "GET", url: "/api/dashboard" });
    const body = res.json<{ currentSpec: string | null }>();
    // Fixture has SPEC-project-console.md
    expect(body.currentSpec).toBe("SPEC-project-console");
  });

  it("sprintGoal reads from STATUS.md Current Sprint Goal section", async () => {
    const res = await app.inject({ method: "GET", url: "/api/dashboard" });
    const body = res.json<{ sprintGoal: string | null }>();
    expect(body.sprintGoal).not.toBeNull();
    expect(body.sprintGoal).toContain("Project Console v1");
  });

  it("handbackQueue is an empty array when no verify files exist", async () => {
    const res = await app.inject({ method: "GET", url: "/api/dashboard" });
    const body = res.json<{ handbackQueue: unknown[] }>();
    // No verify files in the temp dir fixture → empty queue
    expect(Array.isArray(body.handbackQueue)).toBe(true);
    expect(body.handbackQueue.length).toBe(0);
  });
});

// ── Sprint-goal parser tests (STATUS.md variations) ──────────────────────────

describe("sprint goal — STATUS.md parsing variations", () => {
  let app2: FastifyInstance;

  afterAll(async () => {
    if (app2) await app2.close();
  });

  it("returns null when STATUS.md has no Current Sprint Goal heading", async () => {
    // Overwrite STATUS.md with no-goal fixture
    writeFileSync(
      join(tmpRoot, ".claude", "STATUS.md"),
      STATUS_NO_GOAL,
      "utf8"
    );

    app2 = Fastify({ logger: false });
    await app2.register(dashboardRoutes);
    await app2.ready();

    const res = await app2.inject({ method: "GET", url: "/api/dashboard" });
    const body = res.json<{ sprintGoal: string | null }>();
    expect(body.sprintGoal).toBeNull();

    // Restore STATUS.md for subsequent tests
    writeFileSync(
      join(tmpRoot, ".claude", "STATUS.md"),
      STATUS_FIXTURE,
      "utf8"
    );
  });

  it("returns null when STATUS.md is absent", async () => {
    // Temporarily rename STATUS.md
    const { renameSync } = await import("node:fs");
    const statusPath = join(tmpRoot, ".claude", "STATUS.md");
    const tmpPath = statusPath + ".bak";
    renameSync(statusPath, tmpPath);

    try {
      const app3 = Fastify({ logger: false });
      await app3.register(dashboardRoutes);
      await app3.ready();

      const res = await app3.inject({ method: "GET", url: "/api/dashboard" });
      const body = res.json<{ sprintGoal: string | null }>();
      expect(body.sprintGoal).toBeNull();
      await app3.close();
    } finally {
      renameSync(tmpPath, statusPath);
    }
  });
});

// ── Handback title join (TASK-026) ───────────────────────────────────────────
// The pass-file only knows the task ID, so the route joins the real, descriptive
// title from TASKS.md (stripping the trailing " — <status>" board suffix).

describe("handback queue — title joined from TASKS.md", () => {
  let app4: FastifyInstance;
  // tmpRoot is assigned in the top-level beforeAll, so resolve the path inside
  // this hook (not at collection time, when tmpRoot is still "").
  let verifyPath = "";

  beforeAll(async () => {
    verifyPath = join(tmpRoot, ".claude", "console", "verify", "TASK-006.json");
    mkdirSync(join(tmpRoot, ".claude", "console", "verify"), { recursive: true });
    writeFileSync(
      verifyPath,
      JSON.stringify({
        schemaVersion: 1,
        task: "TASK-006",
        status: "in-review",
        items: [
          {
            id: "1",
            kind: "test-plan-item",
            title: "x",
            subject: "s",
            expected: "e",
            verdict: "pending",
            severity: null,
            notes: "",
            changed: false,
          },
        ],
      }),
      "utf8"
    );
    app4 = Fastify({ logger: false });
    await app4.register(dashboardRoutes);
    await app4.ready();
  });

  afterAll(async () => {
    if (app4) await app4.close();
    rmSync(verifyPath, { force: true });
  });

  it("replaces the ID-only title with the real task title", async () => {
    const res = await app4.inject({ method: "GET", url: "/api/dashboard" });
    const body = res.json<{
      handbackQueue: { task: string; title: string; counts: Record<string, number> }[];
    }>();
    const ref = body.handbackQueue.find((r) => r.task === "TASK-006");
    expect(ref).toBeDefined();
    // TASKS_FIXTURE has "#### [TASK-006] Read-only pages" → title joined, not the ID.
    expect(ref!.title).toBe("Read-only pages");
    expect(ref!.title).not.toBe(ref!.task);
    expect(ref!.counts).toEqual({ pending: 1 });
  });
});
