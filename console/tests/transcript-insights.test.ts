// @vitest-environment node
/**
 * transcript-insights.test.ts — S1 aggregators + the two new sessions routes.
 *
 * Fixtures are SYNTHETIC JSONL built inline (matching the verified Claude Code
 * on-disk schema — see transcript-parser.ts module doc) and written into a tmp
 * CLAUDE_PROJECTS_DIR layout; mtimes are aged with utimesSync so liveness is
 * deterministic (everything reads as done).
 *
 * Covers:
 *   - collectUsage: message.id dedupe (one API message = N transcript lines),
 *     byModel buckets, cache fields, cumulative series
 *   - collectFileTouches: path normalisation + cross-tool merge, Bash
 *     heuristics ("maybe"), recency ordering
 *   - collectToolEvents: order, isError backfill, durMs, exact S1 shape
 *   - binEvents: cap, bin-count conservation, error preservation
 *   - readSessionInsights / readSessionTimeline: agent keys, merged usage,
 *     spawn-turn linkage, endedAt, gap detection, root sidechain exclusion
 *   - routes: 200 shapes + 404s incl. traversal ids
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";

// ── Mock project-root for the ROUTE tests (parsers take projectRoot as arg) ──
let projectRoot = "";
vi.mock("../src/server/project-root.js", () => ({
  findProjectRoot: (_: string) => projectRoot,
  getProjectRoot: () => projectRoot,
  dotClaudePath: (...segments: string[]) =>
    [projectRoot, ".claude", ...segments].join("/"),
}));

const {
  bashTouchCandidates,
  binEvents,
  collectFileTouches,
  collectTimelineEvents,
  collectToolEvents,
  collectUsage,
  mergeUsage,
  readSessionInsights,
  readSessionTimeline,
  totalOutputTokens,
} = await import("../src/server/parsers/transcript-insights.js");
const { pathToSlug, clearTranscriptCaches } =
  await import("../src/server/parsers/transcript-parser.js");
const { sessionsRoutes } =
  await import("../src/server/routes/sessions-routes.js");

const SESSION = "99999999-9999-4999-8999-999999999999";
const AGENT_DEV = "eeee5555deadbeef0";

type Line = Record<string, unknown>;

/** One assistant transcript line (message.usage optional, blocks optional). */
function asst(o: {
  uuid: string;
  ts: string;
  msgId?: string;
  model?: string;
  usage?: { in?: number; out?: number; cr?: number; cw?: number };
  blocks?: unknown[];
  sidechain?: boolean;
}): Line {
  return {
    type: "assistant",
    uuid: o.uuid,
    timestamp: o.ts,
    isSidechain: o.sidechain === true,
    message: {
      role: "assistant",
      ...(o.msgId ? { id: o.msgId } : {}),
      model: o.model ?? "claude-test-1",
      ...(o.usage
        ? {
            usage: {
              input_tokens: o.usage.in ?? 0,
              output_tokens: o.usage.out ?? 0,
              cache_read_input_tokens: o.usage.cr ?? 0,
              cache_creation_input_tokens: o.usage.cw ?? 0,
            },
          }
        : {}),
      content: o.blocks ?? [{ type: "text", text: "…" }],
    },
  };
}

/** One user line carrying a tool_result block. */
function toolResult(o: {
  uuid: string;
  ts: string;
  toolUseId: string;
  isError?: boolean;
  status?: string;
}): Line {
  return {
    type: "user",
    uuid: o.uuid,
    timestamp: o.ts,
    isSidechain: false,
    ...(o.status ? { toolUseResult: { status: o.status } } : {}),
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: o.toolUseId,
          ...(o.isError ? { is_error: true } : {}),
          content: [{ type: "text", text: "result" }],
        },
      ],
    },
  };
}

function jsonl(lines: Line[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

// ── Main transcript: dedupe pair, Read/Edit/Bash touches, an error, a gap ────
const MAIN_LINES: Line[] = [
  {
    type: "user",
    uuid: "u1",
    timestamp: "2026-01-02T10:00:00.000Z",
    isSidechain: false,
    cwd: "C:\\fake\\insights-project",
    message: { role: "user", content: "Do the thing" },
  },
  // ONE API message split across TWO lines (same msgId, same usage) — the
  // dedupe case verified against live transcripts.
  asst({
    uuid: "a1",
    ts: "2026-01-02T10:00:05.000Z",
    msgId: "m1",
    usage: { in: 100, out: 50, cr: 10, cw: 20 },
    blocks: [
      { type: "text", text: "Reading." },
      {
        type: "tool_use",
        id: "toolu_read1",
        name: "Read",
        input: { file_path: "F:\\proj\\src\\app.ts" },
      },
    ],
  }),
  asst({
    uuid: "a1b",
    ts: "2026-01-02T10:00:06.000Z",
    msgId: "m1",
    usage: { in: 100, out: 50, cr: 10, cw: 20 },
    blocks: [
      {
        type: "tool_use",
        id: "toolu_spawn",
        name: "Agent",
        input: { subagent_type: "developer", description: "Implement" },
      },
    ],
  }),
  toolResult({
    uuid: "u2",
    ts: "2026-01-02T10:00:07.000Z",
    toolUseId: "toolu_read1",
  }),
  toolResult({
    uuid: "u3",
    ts: "2026-01-02T10:30:00.000Z",
    toolUseId: "toolu_spawn",
    status: "completed",
  }),
  asst({
    uuid: "a2",
    ts: "2026-01-02T10:30:05.000Z",
    msgId: "m2",
    model: "claude-test-2",
    usage: { in: 10, out: 5000 },
    blocks: [
      {
        type: "tool_use",
        id: "toolu_bash",
        name: "Bash",
        input: { command: "echo hi > out/log.txt" },
      },
    ],
  }),
  toolResult({
    uuid: "u4",
    ts: "2026-01-02T10:30:08.000Z",
    toolUseId: "toolu_bash",
    isError: true,
  }),
  // Sidechain line (old-format interleaving) — must be EXCLUDED from root.
  asst({
    uuid: "sc1",
    ts: "2026-01-02T10:31:00.000Z",
    msgId: "sc-m",
    model: "claude-side-1",
    usage: { out: 99_999 },
    sidechain: true,
    blocks: [
      {
        type: "tool_use",
        id: "toolu_side",
        name: "Edit",
        input: { file_path: "F:/proj/side.ts" },
      },
    ],
  }),
  // >30min idle after 10:30:08 → one snip-able gap.
  asst({
    uuid: "a3",
    ts: "2026-01-02T12:00:00.000Z",
    msgId: "m3",
    usage: { out: 100 },
    blocks: [
      {
        type: "tool_use",
        id: "toolu_edit",
        name: "Edit",
        input: { file_path: "F:/proj/src/app.ts" },
      },
    ],
  }),
  toolResult({
    uuid: "u5",
    ts: "2026-01-02T12:00:02.000Z",
    toolUseId: "toolu_edit",
  }),
];

const AGENT_LINES: Line[] = [
  asst({
    uuid: "d1",
    ts: "2026-01-02T10:01:00.000Z",
    msgId: "dm1",
    usage: { in: 500, out: 30_000 },
    blocks: [
      {
        type: "tool_use",
        id: "toolu_w",
        name: "Write",
        input: { file_path: "F:\\proj\\out.txt" },
      },
    ],
  }),
  toolResult({
    uuid: "d2",
    ts: "2026-01-02T10:01:01.000Z",
    toolUseId: "toolu_w",
  }),
];

let tmpBase = "";
const savedEnv = process.env.CLAUDE_PROJECTS_DIR;

beforeAll(() => {
  tmpBase = join(tmpdir(), `ccmaf-insights-${Date.now()}`);
  projectRoot = join(tmpBase, "project");
  const projectsDir = join(tmpBase, "claude-projects");
  const sessionsDir = join(projectsDir, pathToSlug(projectRoot));
  const subagents = join(sessionsDir, SESSION, "subagents");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(subagents, { recursive: true });

  writeFileSync(join(sessionsDir, `${SESSION}.jsonl`), jsonl(MAIN_LINES));
  writeFileSync(
    join(subagents, `agent-${AGENT_DEV}.jsonl`),
    jsonl(AGENT_LINES),
  );
  writeFileSync(
    join(subagents, `agent-${AGENT_DEV}.meta.json`),
    JSON.stringify({
      agentType: "developer",
      description: "Implement the thing",
      toolUseId: "toolu_spawn",
      spawnDepth: 1,
    }),
  );

  // Age everything an hour so liveness reads "done" deterministically.
  const old = (Date.now() - 3_600_000) / 1000;
  utimesSync(join(sessionsDir, `${SESSION}.jsonl`), old, old);
  utimesSync(join(subagents, `agent-${AGENT_DEV}.jsonl`), old, old);

  process.env.CLAUDE_PROJECTS_DIR = projectsDir;
  clearTranscriptCaches();
});

afterAll(() => {
  if (savedEnv === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
  else process.env.CLAUDE_PROJECTS_DIR = savedEnv;
  clearTranscriptCaches();
  rmSync(tmpBase, { recursive: true, force: true });
});

// ── collectUsage ──────────────────────────────────────────────────────────────

describe("collectUsage", () => {
  it("dedupes split messages by message.id and buckets by model", () => {
    const u = collectUsage(MAIN_LINES);
    // m1 (two lines) + m3 → claude-test-1; m2 → claude-test-2. The pure
    // collector counts sidechain lines too — filtering is the CALLER's job
    // (readSessionInsights strips them for root).
    expect(u.byModel["claude-side-1"]).toEqual({
      input: 0,
      output: 99_999,
      cacheRead: 0,
      cacheWrite: 0,
      turns: 1,
    });
    expect(u.byModel["claude-test-1"]).toEqual({
      input: 100,
      output: 150,
      cacheRead: 10,
      cacheWrite: 20,
      turns: 2,
    });
    expect(u.byModel["claude-test-2"]).toEqual({
      input: 10,
      output: 5000,
      cacheRead: 0,
      cacheWrite: 0,
      turns: 1,
    });
  });

  it("emits a cumulative output series in transcript order", () => {
    const noSidechain = MAIN_LINES.filter((l) => l.isSidechain !== true);
    const u = collectUsage(noSidechain);
    expect(u.series.map((p) => p.outputCum)).toEqual([50, 5050, 5150]);
    expect(u.series[0].ts).toBe("2026-01-02T10:00:05.000Z");
  });

  it("totalOutputTokens sums across models", () => {
    const noSidechain = MAIN_LINES.filter((l) => l.isSidechain !== true);
    expect(totalOutputTokens(collectUsage(noSidechain))).toBe(5150);
  });

  it("mergeUsage sums buckets and re-accumulates the series", () => {
    const a = collectUsage(MAIN_LINES.filter((l) => l.isSidechain !== true));
    const b = collectUsage(AGENT_LINES);
    const m = mergeUsage([a, b]);
    expect(totalOutputTokens(m)).toBe(5150 + 30_000);
    // Chronological re-accumulation: agent's 10:01 point lands between the
    // root's 10:00:05 and 10:30:05 points.
    expect(m.series.map((p) => p.outputCum)).toEqual([
      50, 30_050, 35_050, 35_150,
    ]);
  });
});

// ── collectFileTouches ────────────────────────────────────────────────────────

describe("collectFileTouches", () => {
  it("merges tools per normalised path and orders by recency", () => {
    const touches = collectFileTouches(
      MAIN_LINES.filter((l) => l.isSidechain !== true),
    );
    expect(touches.map((t) => t.path)).toEqual([
      "F:/proj/src/app.ts", // last touch 12:00:00
      "out/log.txt", // 10:30:05
    ]);
    const app = touches[0];
    // Read (backslash input) + Edit (forward-slash input) merged by normPath.
    expect(app.tools).toEqual({ Read: 1, Edit: 1 });
    expect(app.firstTs).toBe("2026-01-02T10:00:05.000Z");
    expect(app.lastTs).toBe("2026-01-02T12:00:00.000Z");
    expect(app.lastToolUseId).toBe("toolu_edit");
    expect(app.turnUuid).toBe("a3");
    expect(app.maybe).toBeUndefined();
  });

  it("flags Bash-heuristic-only files as maybe", () => {
    const touches = collectFileTouches(MAIN_LINES);
    const log = touches.find((t) => t.path === "out/log.txt");
    expect(log?.tools).toEqual({ Bash: 1 });
    expect(log?.maybe).toBe(true);
  });

  it("bashTouchCandidates is conservative", () => {
    expect(bashTouchCandidates("echo hi > out/log.txt")).toEqual([
      "out/log.txt",
    ]);
    expect(bashTouchCandidates("ls 2>&1")).toEqual([]);
    expect(bashTouchCandidates("cmd > /dev/null")).toEqual([]);
    expect(bashTouchCandidates("git mv a.txt b/c.txt").sort()).toEqual([
      "a.txt",
      "b/c.txt",
    ]);
    // No separator + no extension → not path-ish enough.
    expect(bashTouchCandidates("rm -rf node_modules")).toEqual([]);
    expect(bashTouchCandidates("touch src/new.ts")).toEqual(["src/new.ts"]);
  });
});

// ── collectToolEvents ─────────────────────────────────────────────────────────

describe("collectToolEvents", () => {
  it("returns chronological events with error + durMs backfill", () => {
    const evs = collectToolEvents(
      MAIN_LINES.filter((l) => l.isSidechain !== true),
    );
    expect(evs.map((e) => e.name)).toEqual(["Read", "Agent", "Bash", "Edit"]);
    const read = evs[0];
    expect(read.toolUseId).toBe("toolu_read1");
    expect(read.turnUuid).toBe("a1");
    expect(read.isError).toBe(false);
    expect(read.durMs).toBe(2000); // 10:00:05 → 10:00:07
    const bash = evs[2];
    expect(bash.isError).toBe(true);
    expect(bash.durMs).toBe(3000);
  });

  it("keeps the exact S1 shape (no summary/bin leakage)", () => {
    const evs = collectToolEvents(MAIN_LINES);
    for (const e of evs) {
      expect("summary" in e).toBe(false);
      expect("bin" in e).toBe(false);
    }
  });

  it("collectTimelineEvents enriches with a capped summary", () => {
    const evs = collectTimelineEvents(
      MAIN_LINES.filter((l) => l.isSidechain !== true),
    );
    expect(evs[2].summary).toBe("echo hi > out/log.txt");
  });
});

// ── binEvents ─────────────────────────────────────────────────────────────────

describe("binEvents", () => {
  it("caps event lists and conserves bin counts + errors", () => {
    const base = Date.parse("2026-01-02T10:00:00.000Z");
    const events = Array.from({ length: 4500 }, (_, i) => ({
      ts: new Date(base + i * 1000).toISOString(),
      toolUseId: `toolu_${i}`,
      name: i % 3 === 0 ? "Read" : "Bash",
      isError: i % 100 === 0,
      turnUuid: `t${i}`,
    }));
    const binned = binEvents(events, 2000);
    expect(binned.length).toBeLessThanOrEqual(2000);
    expect(binned.reduce((n, e) => n + (e.bin ?? 1), 0)).toBe(4500);
    expect(binned.reduce((n, e) => n + (e.binErrors ?? 0), 0)).toBe(45);
    expect(binned.some((e) => e.isError)).toBe(true);
    // Under the cap → untouched (same array).
    expect(binEvents(events.slice(0, 10), 2000)).toHaveLength(10);
  });
});

// ── Session-level readers ─────────────────────────────────────────────────────

describe("readSessionInsights", () => {
  it("returns merged usage + per-agent usage/files (root sidechain excluded)", () => {
    const ins = readSessionInsights(projectRoot, SESSION);
    expect(ins).not.toBeNull();
    expect(Object.keys(ins!.agents).sort()).toEqual([AGENT_DEV, "root"]);
    // Root excludes the isSidechain line's 99 999 output tokens.
    expect(totalOutputTokens(ins!.agents.root.usage)).toBe(5150);
    expect(totalOutputTokens(ins!.agents[AGENT_DEV].usage)).toBe(30_000);
    expect(totalOutputTokens(ins!.usage)).toBe(35_150);
    expect(ins!.agents[AGENT_DEV].files.map((f) => f.path)).toEqual([
      "F:/proj/out.txt",
    ]);
    // Sidechain Edit's file must not leak into root's touches.
    expect(
      ins!.agents.root.files.some((f) => f.path === "F:/proj/side.ts"),
    ).toBe(false);
  });

  it("returns null for an unknown session", () => {
    expect(
      readSessionInsights(projectRoot, "00000000-0000-4000-8000-000000000000"),
    ).toBeNull();
  });
});

describe("readSessionTimeline", () => {
  it("emits root-first lanes with spawn linkage, endedAt and gaps", () => {
    const tl = readSessionTimeline(projectRoot, SESSION);
    expect(tl).not.toBeNull();
    expect(tl!.agents[0].id).toBe("root");
    expect(tl!.agents[0].parentId).toBeNull();
    expect(tl!.agents[0].spawnTurnUuid).toBeNull();
    expect(tl!.agents[0].outputTokens).toBe(5150);

    const dev = tl!.agents.find((a) => a.id === AGENT_DEV);
    expect(dev).toBeDefined();
    expect(dev!.parentId).toBe("root");
    // The Agent tool_use for toolu_spawn lives on line a1b.
    expect(dev!.spawnTurnUuid).toBe("a1b");
    expect(dev!.startedAt).toBe("2026-01-02T10:01:00.000Z");
    expect(dev!.endedAt).not.toBeNull(); // aged mtime → done
    expect(dev!.outputTokens).toBe(30_000);
    expect(dev!.events).toHaveLength(1);
    expect(dev!.events[0].name).toBe("Write");

    // One >30min idle stretch: 10:30:08 → 12:00:00.
    expect(tl!.gaps).toEqual([
      {
        fromTs: "2026-01-02T10:30:08.000Z",
        toTs: "2026-01-02T12:00:00.000Z",
      },
    ]);
  });

  it("returns null for an unknown session", () => {
    expect(
      readSessionTimeline(projectRoot, "00000000-0000-4000-8000-000000000000"),
    ).toBeNull();
  });
});

// ── Routes ────────────────────────────────────────────────────────────────────

describe("insights + timeline routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await app.register(sessionsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/sessions/:id/insights → 200 shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${SESSION}/insights`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      sessionId: string;
      usage: { byModel: Record<string, { output: number }> };
      agents: Record<string, unknown>;
    };
    expect(body.sessionId).toBe(SESSION);
    expect(Object.keys(body.agents).sort()).toEqual([AGENT_DEV, "root"]);
    expect(body.usage.byModel["claude-test-1"].output).toBe(150 + 30_000);
  });

  it("GET /api/sessions/:id/timeline → 200 shape", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${SESSION}/timeline`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      agents: { id: string; events: unknown[] }[];
      gaps: unknown[];
    };
    expect(body.agents[0].id).toBe("root");
    expect(body.agents).toHaveLength(2);
    expect(body.gaps).toHaveLength(1);
  });

  it("404s unknown and traversal-shaped ids", async () => {
    for (const id of [
      "00000000-0000-4000-8000-000000000000",
      "..%2F..%2Fetc",
      "not-a-session",
    ]) {
      for (const tail of ["insights", "timeline"]) {
        const res = await app.inject({
          method: "GET",
          url: `/api/sessions/${id}/${tail}`,
        });
        expect(res.statusCode).toBe(404);
      }
    }
  });
});
