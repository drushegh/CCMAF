/**
 * headroom.test.ts — Headroom metrics parser + endpoint (TASK-029)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";

let tmpRoot = "";
vi.mock("../src/server/project-root.js", () => ({
  findProjectRoot: (_: string) => tmpRoot,
  getProjectRoot: () => tmpRoot,
  dotClaudePath: (...segments: string[]) =>
    [tmpRoot, ".claude", ...segments].join("/"),
}));

const { parseHeadroomJsonl, readHeadroomMetrics } = await import(
  "../src/server/parsers/headroom-parser.js"
);
const { analyticsRoutes } = await import(
  "../src/server/routes/analytics-routes.js"
);

// Two real records + one with null model-side fields + one malformed line.
const FIXTURE = [
  JSON.stringify({
    schema: "headroom-metrics/1",
    event_id: "hdr-1",
    ts: "2026-06-25T16:30:00Z",
    normalized_at: "2026-06-25T16:31:00Z",
    model: "claude-opus-4-8",
    tokens_in: 5000,
    tokens_out: 1500,
    tokens_saved: 3500,
    compression_ratio: 0.3,
    cost_usd: 0.01,
    latency_ms: 400,
    source: "proxy-jsonl",
    raw: {},
  }),
  JSON.stringify({
    schema: "headroom-metrics/1",
    event_id: "hdr-2",
    ts: "2026-06-25T16:35:00Z",
    model: "claude-opus-4-8",
    tokens_in: 3000,
    tokens_out: 1500,
    tokens_saved: 1500,
    compression_ratio: 0.5,
    cost_usd: null, // model-side not reported (local compress only)
    latency_ms: null,
    raw: {},
  }),
  "{ this is not json", // malformed — must be dropped, not guessed
].join("\n");

describe("parseHeadroomJsonl", () => {
  it("returns the empty summary for no content", () => {
    const s = parseHeadroomJsonl("");
    expect(s.available).toBe(false);
    expect(s.recordCount).toBe(0);
  });

  it("aggregates real numbers, skips nulls, drops malformed lines", () => {
    const s = parseHeadroomJsonl(FIXTURE);
    expect(s.available).toBe(true);
    expect(s.recordCount).toBe(2); // malformed line dropped
    expect(s.tokensIn).toBe(8000);
    expect(s.tokensOut).toBe(3000);
    expect(s.tokensSaved).toBe(5000);
    // mean of 0.3 and 0.5
    expect(s.avgCompressionRatio).toBeCloseTo(0.4, 5);
    // only hdr-1 reported a cost → sum is that one value, not zero-filled
    expect(s.costUsd).toBe(0.01);
    expect(s.lastRun).toBe("2026-06-25T16:35:00Z"); // latest ts
  });

  it("most-recent-first in `recent`", () => {
    const s = parseHeadroomJsonl(FIXTURE);
    expect(s.recent[0].eventId).toBe("hdr-2");
    expect(s.recent[1].eventId).toBe("hdr-1");
  });

  it("costUsd is null when no record reports a cost", () => {
    const noCost = JSON.stringify({
      event_id: "x",
      tokens_in: 10,
      tokens_out: 4,
      tokens_saved: 6,
      compression_ratio: 0.4,
      cost_usd: null,
    });
    expect(parseHeadroomJsonl(noCost).costUsd).toBeNull();
  });
});

describe("readHeadroomMetrics — file IO", () => {
  it("returns empty summary when the file is absent", () => {
    expect(readHeadroomMetrics("/nope/headroom-metrics.jsonl").available).toBe(
      false
    );
  });
});

describe("GET /api/headroom", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    tmpRoot = join(tmpdir(), `ccmaf-headroom-${Date.now()}`);
    mkdirSync(join(tmpRoot, ".claude", "telemetry"), { recursive: true });
    writeFileSync(
      join(tmpRoot, ".claude", "telemetry", "headroom-metrics.jsonl"),
      FIXTURE,
      "utf8"
    );
    app = Fastify({ logger: false });
    await app.register(analyticsRoutes);
    await app.ready();
  });
  afterAll(async () => {
    if (app) await app.close();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns the aggregated summary (200)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/headroom" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ available: boolean; tokensSaved: number; recordCount: number }>();
    expect(body.available).toBe(true);
    expect(body.tokensSaved).toBe(5000);
    expect(body.recordCount).toBe(2);
  });
});
