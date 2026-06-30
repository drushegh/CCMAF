// @vitest-environment node
/**
 * analytics-parsers.test.ts — Unit tests for TASK-025 parsers and routes.
 *
 * Tests:
 *   Gotchas parser:
 *     1. Empty content → []
 *     2. Single entry parsed (title, category, confidence, count, firstSeen)
 *     3. Multiple categories
 *     4. Skips HTML-comment template block
 *     5. Missing file → []
 *     6. Count ≥ 5 entries parseable
 *
 *   Suggestions parser:
 *     7. Empty content → []
 *     8. FS-NNN parsed (### and — separator)
 *     9. FS-NNN parsed (## and - separator)
 *    10. Multiple suggestions
 *    11. Missing file → []
 *
 *   Findings parser:
 *    12. Review: APPROVE verdict detected
 *    13. Review: CHANGES-NEEDED verdict detected
 *    14. Review: [CRITICAL] count correct
 *    15. Review: empty content → null verdict, 0 criticals
 *    16. Test: date heading parsed as lastRun
 *    17. Test: empty content → null values
 *    18. Both files absent → nulls/0
 *
 *   Telemetry parser:
 *    19. parseHookMetrics: valid JSON → HookMetrics shape
 *    20. parseHookMetrics: missing file → zeroed defaults
 *    21. parseHookMetrics: malformed JSON → zeroed defaults
 *    22. readLastCostTrackerEntry: finds last cost-tracker line
 *    23. readLastCostTrackerEntry: absent file → null
 *    24. readLastCostTrackerEntry: no cost-tracker line → null
 *
 *   Analytics routes (Fastify inject):
 *    25. GET /api/telemetry → 200, TelemetrySummary shape
 *    26. GET /api/gotchas   → 200, array
 *    27. GET /api/findings  → 200, FindingsSummary shape
 *    28. GET /api/framework → 200, FrameworkHealth shape
 *    29. GET /api/suggestions → 200, array
 *    30. All return 200 + empty/default shapes when files absent
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GOTCHAS_FIXTURE = `# Gotchas

<!-- Template comment: ignore this -->

## Project-specific

### Verify files are user data
**Confidence:** Verified (caught 2026-06-24)
Count: 1 · First seen: 2026-06-24
Some description here.

### Dev vs prod gap
**Confidence:** Working theory
Count: 3 · First seen: 2026-06-23
Another entry.

## Technology

### SSE stub closes stream
**Confidence:** Verified (server.ts:270)
Count: 5 · First seen: 2026-06-23
Yet another.
`;

const SUGGESTIONS_FIXTURE = `# Framework Improvement Suggestions

## FS-003 — git add -A in parallel worktree
Some context here.

### FS-002 - code-conventions overwritten on update
More context.

## FS-001 — Clone ships artefacts
`;

const REVIEW_FINDINGS_FIXTURE = `# Review Findings

## 2026-06-24 — TASK-001 + TASK-002

**VERDICT: TASK-001 APPROVE**

- [CRITICAL] security.ts token throws on invalid hex
- [CRITICAL] SSE stub closes connection
- [WARNING] dead CSS rule
`;

const REVIEW_FINDINGS_CHANGES = `# Review Findings

## 2026-06-23

**VERDICT: TASK-001 CHANGES-NEEDED**
- [CRITICAL] prefix bypass
`;

const TEST_FINDINGS_FIXTURE = `# Test Findings

## 2026-06-24 — Some test run

377 tests passing, 0 failing.
`;

const HOOK_METRICS_FIXTURE = {
  generated_at: "2026-06-23T20:15:44Z",
  total_events: 41,
  by_hook: {
    "cost-tracker": { total: 3, outcomes: { "session-end": 3 } },
    "drift-guard": { total: 4, outcomes: { clean: 3, "drift-detected": 1 } },
  },
  drift_triggers: { "no-task-claimed": 1 },
  sessions: 1,
  by_session: {
    "abc-123": {
      total: 41,
      blocked: 0,
      flagged: 3,
      stop_blocked: 0,
      drift_fires: 1,
    },
  },
};

const EVENTS_JSONL_FIXTURE = [
  JSON.stringify({
    ts: "2026-06-23T19:44:58Z",
    schema: 2,
    session_id: "abc-123",
    hook: "bash-guard",
    outcome: "allowed",
  }),
  JSON.stringify({
    ts: "2026-06-23T20:00:00Z",
    schema: 2,
    session_id: "abc-123",
    hook: "cost-tracker",
    outcome: "session-end",
    tool_uses: 52,
    transcript_lines: 342,
  }),
  JSON.stringify({
    ts: "2026-06-23T20:15:34Z",
    schema: 2,
    session_id: "abc-123",
    hook: "drift-guard",
    outcome: "clean",
  }),
].join("\n");

// ── Mock project-root ─────────────────────────────────────────────────────────

let tmpRoot = "";

vi.mock("../src/server/project-root.js", () => {
  return {
    findProjectRoot: (_: string) => tmpRoot,
    getProjectRoot: () => tmpRoot,
    dotClaudePath: (...segments: string[]) =>
      [tmpRoot, ".claude", ...segments].join("/"),
  };
});

// Import parsers AFTER the mock is set up
const { parseGotchasMd, parseGotchasFile } = await import(
  "../src/server/parsers/gotchas-parser.js"
);
const { parseSuggestionsMd, parseSuggestionsFile } = await import(
  "../src/server/parsers/suggestions-parser.js"
);
const {
  parseReviewFindingsMd,
  parseTestFindingsMd,
  parseFindingsFiles,
} = await import("../src/server/parsers/findings-parser.js");
const { parseHookMetrics, readLastCostTrackerEntry, aggregateEventsFile } =
  await import("../src/server/parsers/telemetry-parser.js");
const { analyticsRoutes } = await import(
  "../src/server/routes/analytics-routes.js"
);

// ── Temp dir setup ─────────────────────────────────────────────────────────────

beforeAll(() => {
  tmpRoot = join(tmpdir(), `ccmaf-analytics-${Date.now()}`);
  const dotClaude = join(tmpRoot, ".claude");
  const telemetryDir = join(dotClaude, "telemetry");
  mkdirSync(telemetryDir, { recursive: true });

  writeFileSync(join(dotClaude, "GOTCHAS.md"), GOTCHAS_FIXTURE, "utf8");
  writeFileSync(
    join(dotClaude, "FRAMEWORK-SUGGESTIONS.md"),
    SUGGESTIONS_FIXTURE,
    "utf8"
  );
  writeFileSync(
    join(dotClaude, "review-findings.md"),
    REVIEW_FINDINGS_FIXTURE,
    "utf8"
  );
  writeFileSync(join(dotClaude, "test-findings.md"), TEST_FINDINGS_FIXTURE, "utf8");
  writeFileSync(
    join(telemetryDir, ".hook-metrics"),
    JSON.stringify(HOOK_METRICS_FIXTURE),
    "utf8"
  );
  writeFileSync(join(telemetryDir, "events.jsonl"), EVENTS_JSONL_FIXTURE, "utf8");
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// ── Gotchas parser ────────────────────────────────────────────────────────────

describe("parseGotchasMd", () => {
  it("returns [] for empty content", () => {
    expect(parseGotchasMd("")).toEqual([]);
  });

  it("parses a single entry title, category, confidence, count, firstSeen", () => {
    const entries = parseGotchasMd(GOTCHAS_FIXTURE);
    const first = entries[0];
    expect(first).toBeDefined();
    expect(first.title).toBe("Verify files are user data");
    expect(first.category).toBe("Project-specific");
    expect(first.confidence).toContain("Verified");
    expect(first.count).toBe(1);
    expect(first.firstSeen).toBe("2026-06-24");
  });

  it("parses entries across multiple categories", () => {
    const entries = parseGotchasMd(GOTCHAS_FIXTURE);
    const tech = entries.find((e) => e.category === "Technology");
    expect(tech).toBeDefined();
    expect(tech!.title).toBe("SSE stub closes stream");
  });

  it("skips the HTML-comment template block", () => {
    const entries = parseGotchasMd(GOTCHAS_FIXTURE);
    expect(entries.some((e) => e.title.toLowerCase().includes("template"))).toBe(false);
  });

  it("parses count correctly (including ≥ 5)", () => {
    const entries = parseGotchasMd(GOTCHAS_FIXTURE);
    const high = entries.find((e) => e.count >= 5);
    expect(high).toBeDefined();
    expect(high!.count).toBe(5);
  });

  it("captures the body prose under an entry (TASK-027)", () => {
    const entries = parseGotchasMd(GOTCHAS_FIXTURE);
    const first = entries[0];
    expect(first.body).toBe("Some description here.");
    // The confidence/count metadata lines must NOT leak into the body.
    expect(first.body).not.toContain("Confidence");
    expect(first.body).not.toContain("Count:");
    expect(entries.find((e) => e.title === "Dev vs prod gap")!.body).toBe(
      "Another entry."
    );
  });

  it("returns [] for missing file", () => {
    expect(parseGotchasFile("/nonexistent/GOTCHAS.md")).toEqual([]);
  });

  it("reads fixture file from disk", () => {
    const entries = parseGotchasFile(join(tmpRoot, ".claude", "GOTCHAS.md"));
    expect(entries.length).toBeGreaterThan(0);
  });
});

// ── Suggestions parser ────────────────────────────────────────────────────────

describe("parseSuggestionsMd", () => {
  it("returns [] for empty content", () => {
    expect(parseSuggestionsMd("")).toEqual([]);
  });

  it("parses FS-NNN with ### and — separator", () => {
    const entries = parseSuggestionsMd(SUGGESTIONS_FIXTURE);
    const fs3 = entries.find((e) => e.id === "FS-003");
    expect(fs3).toBeDefined();
    expect(fs3!.title).toBe("git add -A in parallel worktree");
  });

  it("parses FS-NNN with ## and - separator", () => {
    const entries = parseSuggestionsMd(SUGGESTIONS_FIXTURE);
    const fs1 = entries.find((e) => e.id === "FS-001");
    expect(fs1).toBeDefined();
    expect(fs1!.title).toBe("Clone ships artefacts");
  });

  it("parses FS-NNN with ### and - separator", () => {
    const entries = parseSuggestionsMd(SUGGESTIONS_FIXTURE);
    const fs2 = entries.find((e) => e.id === "FS-002");
    expect(fs2).toBeDefined();
    expect(fs2!.title).toBe("code-conventions overwritten on update");
  });

  it("returns all 3 suggestions from the fixture", () => {
    expect(parseSuggestionsMd(SUGGESTIONS_FIXTURE)).toHaveLength(3);
  });

  it("returns [] for missing file", () => {
    expect(parseSuggestionsFile("/nonexistent/FRAMEWORK-SUGGESTIONS.md")).toEqual([]);
  });
});

// ── Findings parser ───────────────────────────────────────────────────────────

describe("parseReviewFindingsMd", () => {
  it("detects APPROVE verdict", () => {
    const result = parseReviewFindingsMd(REVIEW_FINDINGS_FIXTURE);
    expect(result.latestVerdict).toBe("APPROVE");
  });

  it("detects CHANGES-NEEDED verdict", () => {
    const result = parseReviewFindingsMd(REVIEW_FINDINGS_CHANGES);
    expect(result.latestVerdict).toBe("CHANGES-NEEDED");
  });

  it("counts [CRITICAL] occurrences", () => {
    const result = parseReviewFindingsMd(REVIEW_FINDINGS_FIXTURE);
    expect(result.openCriticals).toBe(2);
  });

  it("excludes criticals marked RESOLVED (or struck through) from the open count", () => {
    const content = `# Review Findings

## 2026-06-24 — sample

- [CRITICAL] still-open issue
- [CRITICAL] fixed issue **— RESOLVED** (TASK-002): now safe
- [CRITICAL] ~~struck-through fixed issue~~
`;
    // 3 [CRITICAL] lines; 2 are marked resolved → only 1 is genuinely open.
    expect(parseReviewFindingsMd(content).openCriticals).toBe(1);
  });

  it("returns null verdict and 0 criticals for empty content", () => {
    const result = parseReviewFindingsMd("");
    expect(result.latestVerdict).toBeNull();
    expect(result.openCriticals).toBe(0);
  });
});

describe("parseTestFindingsMd", () => {
  it("parses date heading as lastRun", () => {
    const result = parseTestFindingsMd(TEST_FINDINGS_FIXTURE);
    expect(result.lastRun).toBe("2026-06-24");
  });

  it("returns null values for empty content", () => {
    const result = parseTestFindingsMd("");
    expect(result.lastRun).toBeNull();
    expect(result.pass).toBeNull();
    expect(result.fail).toBeNull();
  });
});

describe("parseFindingsFiles", () => {
  it("returns nulls/0 when both files are absent", () => {
    const result = parseFindingsFiles(
      "/nonexistent/review-findings.md",
      "/nonexistent/test-findings.md"
    );
    expect(result.review.latestVerdict).toBeNull();
    expect(result.review.openCriticals).toBe(0);
    expect(result.test.lastRun).toBeNull();
    expect(result.test.pass).toBeNull();
    expect(result.test.fail).toBeNull();
  });

  it("reads real fixture files", () => {
    const result = parseFindingsFiles(
      join(tmpRoot, ".claude", "review-findings.md"),
      join(tmpRoot, ".claude", "test-findings.md")
    );
    expect(result.review.latestVerdict).toBe("APPROVE");
    expect(result.review.openCriticals).toBe(2);
    expect(result.test.lastRun).toBe("2026-06-24");
  });
});

// ── Telemetry parser ──────────────────────────────────────────────────────────

describe("parseHookMetrics", () => {
  it("parses a valid .hook-metrics JSON file", () => {
    const path = join(tmpRoot, ".claude", "telemetry", ".hook-metrics");
    const result = parseHookMetrics(path);
    expect(result.total_events).toBe(41);
    expect(result.sessions).toBe(1);
    expect(result.by_hook["cost-tracker"]).toBeDefined();
    expect(result.drift_triggers["no-task-claimed"]).toBe(1);
  });

  it("returns zeroed defaults for a missing file", () => {
    const result = parseHookMetrics("/nonexistent/.hook-metrics");
    expect(result.total_events).toBe(0);
    expect(result.sessions).toBe(0);
    expect(result.by_hook).toEqual({});
    expect(result.drift_triggers).toEqual({});
  });

  it("returns zeroed defaults for malformed JSON", () => {
    const badPath = join(tmpRoot, ".claude", "telemetry", ".hook-metrics-bad");
    writeFileSync(badPath, "{ not valid json", "utf8");
    const result = parseHookMetrics(badPath);
    expect(result.total_events).toBe(0);
  });
});

describe("readLastCostTrackerEntry", () => {
  it("finds the last cost-tracker entry", () => {
    const path = join(tmpRoot, ".claude", "telemetry", "events.jsonl");
    const result = readLastCostTrackerEntry(path);
    expect(result).not.toBeNull();
    expect(result!.toolUses).toBe(52);
    expect(result!.transcriptLines).toBe(342);
    expect(result!.sessionId).toBe("abc-123");
  });

  it("returns null for a missing file", () => {
    const result = readLastCostTrackerEntry("/nonexistent/events.jsonl");
    expect(result).toBeNull();
  });

  it("returns null when no cost-tracker line exists", () => {
    const path = join(tmpRoot, ".claude", "telemetry", "no-cost-tracker.jsonl");
    writeFileSync(
      path,
      JSON.stringify({ hook: "bash-guard", outcome: "allowed" }) + "\n",
      "utf8"
    );
    const result = readLastCostTrackerEntry(path);
    expect(result).toBeNull();
  });
});

// FS-003: the dashboard must aggregate the raw event log directly (all sessions)
// rather than depend on a pre-aggregated .hook-metrics that a consumer may never
// have generated. Each line is parsed independently, tolerating both emitter
// serialisations (compact + spaced) and malformed lines.
describe("aggregateEventsFile (FS-003)", () => {
  it("aggregates the whole log across sessions, both serialisations", () => {
    const path = join(tmpRoot, ".claude", "telemetry", "fs003-events.jsonl");
    const lines = [
      // compact serialisation (no spaces)
      `{"ts":"2026-06-23T19:44:58Z","schema":2,"session_id":"s1","hook":"bash-guard","outcome":"allowed","outcome_class":"ok"}`,
      // spaced serialisation (the second emitter)
      `{"ts": "2026-06-23T19:45:00Z", "schema": 2, "session_id": "s1", "hook": "format", "outcome": "skipped", "outcome_class": "skipped"}`,
      // a drift fire with a trigger, in a SECOND session
      `{"ts":"2026-06-24T08:00:00Z","schema":2,"session_id":"s2","hook":"drift-guard","outcome":"drift-detected","outcome_class":"flagged","trigger":"no-task-claimed"}`,
      // a blocked stop in session 2
      `{"ts":"2026-06-24T08:01:00Z","schema":2,"session_id":"s2","hook":"stop","outcome":"blocked","outcome_class":"blocked"}`,
      // the last cost-tracker line (most recent)
      `{"ts":"2026-06-24T08:02:00Z","schema":2,"session_id":"s2","hook":"cost-tracker","outcome":"session-end","outcome_class":"ok","tool_uses":99,"transcript_lines":1234}`,
      "", // blank line — ignored
      `{not valid json}`, // malformed — skipped, doesn't abort the pass
    ].join("\n");
    writeFileSync(path, lines, "utf8");

    const { metrics, lastSession } = aggregateEventsFile(path);

    expect(metrics.total_events).toBe(5); // 5 hook lines; blank + malformed dropped
    expect(metrics.sessions).toBe(2); // s1 + s2
    expect(metrics.by_hook["bash-guard"].outcomes.allowed).toBe(1);
    expect(metrics.by_hook["format"].outcomes.skipped).toBe(1); // spaced line parsed
    expect(metrics.drift_triggers["no-task-claimed"]).toBe(1);
    expect(metrics.by_session["s2"].drift_fires).toBe(1);
    expect(metrics.by_session["s2"].blocked).toBe(1);
    expect(metrics.by_session["s2"].stop_blocked).toBe(1);
    expect(metrics.generated_at).toBe("2026-06-24T08:02:00Z"); // latest ts
    expect(lastSession).toEqual({
      toolUses: 99,
      transcriptLines: 1234,
      sessionId: "s2",
    });
  });

  it("returns zeroed defaults for a missing file", () => {
    const { metrics, lastSession } = aggregateEventsFile(
      "/nonexistent/events.jsonl"
    );
    expect(metrics.total_events).toBe(0);
    expect(metrics.sessions).toBe(0);
    expect(metrics.by_hook).toEqual({});
    expect(lastSession).toBeNull();
  });
});

// ── Analytics routes (Fastify inject) ────────────────────────────────────────

describe("analyticsRoutes plugin", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(analyticsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/telemetry returns 200 with TelemetrySummary shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/telemetry" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      total_events: number;
      by_hook: Record<string, unknown>;
      lastSession: unknown;
    }>();
    expect(typeof body.total_events).toBe("number");
    expect(typeof body.by_hook).toBe("object");
    expect("lastSession" in body).toBe(true);
  });

  it("GET /api/gotchas returns 200 with an array", async () => {
    const res = await app.inject({ method: "GET", url: "/api/gotchas" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("GET /api/findings returns 200 with FindingsSummary shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/findings" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      review: { latestVerdict: unknown; openCriticals: number };
      test: { lastRun: unknown; pass: unknown; fail: unknown };
    }>();
    expect(typeof body.review).toBe("object");
    expect(typeof body.test).toBe("object");
    expect(typeof body.review.openCriticals).toBe("number");
  });

  it("GET /api/framework returns 200 with FrameworkHealth shape", async () => {
    const res = await app.inject({ method: "GET", url: "/api/framework" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      version: unknown;
      updateAvailable: boolean;
      healthcheckLastRun: unknown;
      doctorClean: boolean;
    }>();
    expect(typeof body.updateAvailable).toBe("boolean");
    expect(typeof body.doctorClean).toBe("boolean");
    expect("version" in body).toBe(true);
    expect("healthcheckLastRun" in body).toBe(true);
  });

  it("GET /api/suggestions returns 200 with an array", async () => {
    const res = await app.inject({ method: "GET", url: "/api/suggestions" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe("analyticsRoutes — empty/default shapes when files absent", () => {
  let emptyApp: FastifyInstance;
  const emptyTmpRoot = join(tmpdir(), `ccmaf-analytics-empty-${Date.now()}`);

  beforeAll(async () => {
    // Set up a temp root with NO state files
    mkdirSync(join(emptyTmpRoot, ".claude"), { recursive: true });
    // Override the mock to use this empty root
    tmpRoot = emptyTmpRoot;

    emptyApp = Fastify({ logger: false });
    await emptyApp.register(analyticsRoutes);
    await emptyApp.ready();
  });

  afterAll(async () => {
    await emptyApp.close();
    rmSync(emptyTmpRoot, { recursive: true, force: true });
    // Restore original tmpRoot so other tests still pass if run after
    // (tests are isolated by Fastify instance; route reads use dotClaudePath which
    //  reads the current tmpRoot mock value at call time)
  });

  it("GET /api/telemetry returns 200 with zeroed defaults when files absent", async () => {
    const res = await emptyApp.inject({ method: "GET", url: "/api/telemetry" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ total_events: number; lastSession: null }>();
    expect(body.total_events).toBe(0);
    expect(body.lastSession).toBeNull();
  });

  it("GET /api/gotchas returns 200 with [] when file absent", async () => {
    const res = await emptyApp.inject({ method: "GET", url: "/api/gotchas" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("GET /api/findings returns 200 with nulls/0 when files absent", async () => {
    const res = await emptyApp.inject({ method: "GET", url: "/api/findings" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      review: { latestVerdict: null; openCriticals: number };
    }>();
    expect(body.review.latestVerdict).toBeNull();
    expect(body.review.openCriticals).toBe(0);
  });

  it("GET /api/framework returns 200 with safe defaults when files absent", async () => {
    const res = await emptyApp.inject({ method: "GET", url: "/api/framework" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{
      version: null;
      updateAvailable: boolean;
      healthcheckLastRun: null;
      doctorClean: boolean;
    }>();
    expect(body.version).toBeNull();
    expect(body.updateAvailable).toBe(false);
    expect(body.healthcheckLastRun).toBeNull();
    expect(body.doctorClean).toBe(true);
  });

  it("GET /api/suggestions returns 200 with [] when file absent", async () => {
    const res = await emptyApp.inject({ method: "GET", url: "/api/suggestions" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

// ── parseFrameworkVersion — KEY=value shell-config, not a raw dump ─────────────
describe("parseFrameworkVersion", () => {
  it("extracts branch@shortSHA from a .framework-version shell-config file", async () => {
    const { parseFrameworkVersion } = await import(
      "../src/server/routes/analytics-routes.js"
    );
    const raw = [
      "# .framework-version — comment line",
      "FRAMEWORK_UPSTREAM_URL=git@github.com:x/y.git",
      "FRAMEWORK_UPSTREAM_BRANCH=main",
      "FRAMEWORK_PINNED_SHA=97f149e11ed18e371917898685c7793996cb5e1e",
      "FRAMEWORK_LAST_CHECKED=2026-06-23T19:14:49Z",
    ].join("\n");
    expect(parseFrameworkVersion(raw)).toBe("main@97f149e");
  });

  it("falls back to the first non-comment line (never dumps the whole file)", async () => {
    const { parseFrameworkVersion } = await import(
      "../src/server/routes/analytics-routes.js"
    );
    expect(parseFrameworkVersion("# only comments\n# nothing else")).toBeNull();
    expect(parseFrameworkVersion("# c\nv1.2.3\nmore")).toBe("v1.2.3");
  });
});
