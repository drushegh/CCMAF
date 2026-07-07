// @vitest-environment node
/**
 * transcript-parser.test.ts — Sessions agent-visualisation: parser + routes.
 *
 * Fixtures: tests/fixtures/sessions/* — SYNTHETIC transcripts matching the
 * verified Claude Code on-disk schema (see the parser's module doc). They are
 * copied into a tmp CLAUDE_PROJECTS_DIR layout here (the slug is computed
 * from the tmp project root at run time) and mtimes are set with utimesSync
 * so live-vs-done is deterministic.
 *
 * Covers:
 *   - path→slug rule + case-insensitive + cwd-match dir resolution
 *   - listSessions (fields, ordering, noise-skipping, raw message count)
 *   - readSessionTree (toolUseId linkage incl. nested agents, live-vs-done
 *     for sync/background agents, task-notification completion)
 *   - readAgentConversation (turn/block mapping, truncation, string content)
 *   - malformed-line tolerance and empty/missing-dir behaviour
 *   - route plugin (Fastify inject): 200 shapes + 404s incl. traversal ids
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import {
  copyFileSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";

// ── Mock project-root for the ROUTE tests (parser takes projectRoot as arg) ──
let projectRoot = "";
vi.mock("../src/server/project-root.js", () => ({
  findProjectRoot: (_: string) => projectRoot,
  getProjectRoot: () => projectRoot,
  dotClaudePath: (...segments: string[]) =>
    [projectRoot, ".claude", ...segments].join("/"),
}));

const {
  clearTranscriptCaches,
  countMessagesRaw,
  listSessions,
  pathToSlug,
  readAgentConversation,
  readSessionTree,
  readToolResult,
  resolveProjectSessionsDir,
  searchSession,
  sessionExists,
} = await import("../src/server/parsers/transcript-parser.js");
const { sessionsRoutes } =
  await import("../src/server/routes/sessions-routes.js");

const FIXTURES = fileURLToPath(
  new URL("./fixtures/sessions/", import.meta.url),
);

const SESSION_1 = "11111111-1111-4111-8111-111111111111";
const SESSION_2 = "22222222-2222-4222-8222-222222222222";
const SESSION_3 = "33333333-3333-4333-8333-333333333333";
const AGENT_SYNC = "aaaa1111deadbeef0";
const AGENT_BG = "bbbb2222deadbeef0";
const AGENT_NESTED = "cccc3333deadbeef0";
const AGENT_NOTIFIED = "dddd4444deadbeef0";

let tmpBase = "";
let projectsDir = "";
let sessionsDir = "";
/** bbbb (background agent) file mtime, ms — liveness tests pass `now` around it. */
let bgMtimeMs = 0;

// Second project: exercises the cwd-match fallback (non-slug dir name).
let projectRootB = "";
let projectsDirB = "";

// Third project: background agent completed via <task-notification>.
let projectRootD = "";
let projectsDirD = "";

// Fourth project: search-cap fixture + empty-thinking (signature-only) fixture.
let projectRootE = "";
let projectsDirE = "";

const savedEnv = process.env.CLAUDE_PROJECTS_DIR;

beforeAll(() => {
  tmpBase = join(tmpdir(), `ccmaf-sessions-${Date.now()}`);
  projectRoot = join(tmpBase, "project");
  projectsDir = join(tmpBase, "claude-projects");
  sessionsDir = join(projectsDir, pathToSlug(projectRoot));
  mkdirSync(projectRoot, { recursive: true });

  // ── Project A: two sessions from the committed fixtures ────────────────────
  const subagents1 = join(sessionsDir, SESSION_1, "subagents");
  mkdirSync(subagents1, { recursive: true });
  copyFileSync(
    join(FIXTURES, "main-session.jsonl"),
    join(sessionsDir, `${SESSION_1}.jsonl`),
  );
  copyFileSync(
    join(FIXTURES, "simple-session.jsonl"),
    join(sessionsDir, `${SESSION_2}.jsonl`),
  );
  for (const id of [AGENT_SYNC, AGENT_BG, AGENT_NESTED]) {
    copyFileSync(
      join(FIXTURES, `agent-${id}.jsonl`),
      join(subagents1, `agent-${id}.jsonl`),
    );
    copyFileSync(
      join(FIXTURES, `agent-${id}.meta.json`),
      join(subagents1, `agent-${id}.meta.json`),
    );
  }

  // mtimes: session 1 recent, session 2 hours old → list order is [1, 2].
  const now = Date.now();
  const t1 = new Date(now - 60_000);
  const t2 = new Date(now - 7_200_000);
  utimesSync(join(sessionsDir, `${SESSION_1}.jsonl`), t1, t1);
  utimesSync(join(sessionsDir, `${SESSION_2}.jsonl`), t2, t2);
  for (const id of [AGENT_SYNC, AGENT_BG, AGENT_NESTED]) {
    utimesSync(join(subagents1, `agent-${id}.jsonl`), t1, t1);
  }
  bgMtimeMs = t1.getTime();

  // ── Project B: sessions dir with a NON-slug name → cwd-match fallback ──────
  projectRootB = join(tmpBase, "project-b");
  projectsDirB = join(tmpBase, "claude-projects-b");
  mkdirSync(projectRootB, { recursive: true });
  const weirdDir = join(projectsDirB, "some-weird-dirname");
  mkdirSync(weirdDir, { recursive: true });
  writeFileSync(
    join(weirdDir, `${SESSION_2}.jsonl`),
    `${JSON.stringify({
      type: "user",
      message: { role: "user", content: "hello from project B" },
      uuid: "b1",
      timestamp: "2026-01-03T12:00:00.000Z",
      cwd: projectRootB,
      sessionId: SESSION_2,
    })}\n`,
    "utf8",
  );

  // ── Project D: background agent finished via <task-notification> ───────────
  projectRootD = join(tmpBase, "project-d");
  projectsDirD = join(tmpBase, "claude-projects-d");
  mkdirSync(projectRootD, { recursive: true });
  const sessionsDirD = join(projectsDirD, pathToSlug(projectRootD));
  const subagentsD = join(sessionsDirD, SESSION_3, "subagents");
  mkdirSync(subagentsD, { recursive: true });
  const notification = [
    "<task-notification>",
    `<task-id>${AGENT_NOTIFIED}</task-id>`,
    "<tool-use-id>toolu_bg_9</tool-use-id>",
    "<status>completed</status>",
    '<summary>Agent "Long audit" came to rest</summary>',
    "</task-notification>",
  ].join("\n");
  const mainD = [
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-test-1",
        content: [
          {
            type: "tool_use",
            id: "toolu_bg_9",
            name: "Agent",
            input: {
              subagent_type: "auditor",
              description: "Long audit",
              run_in_background: true,
            },
          },
        ],
      },
      uuid: "d1",
      timestamp: "2026-01-04T08:00:00.000Z",
      cwd: projectRootD,
      sessionId: SESSION_3,
    }),
    JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_bg_9",
            content: [
              { type: "text", text: "Async agent launched successfully." },
            ],
          },
        ],
      },
      toolUseResult: { status: "async_launched", isAsync: true },
      uuid: "d2",
      timestamp: "2026-01-04T08:00:01.000Z",
      cwd: projectRootD,
      sessionId: SESSION_3,
    }),
    JSON.stringify({
      type: "queue-operation",
      operation: "enqueue",
      content: notification,
      timestamp: "2026-01-04T09:00:00.000Z",
      sessionId: SESSION_3,
    }),
  ].join("\n");
  writeFileSync(join(sessionsDirD, `${SESSION_3}.jsonl`), `${mainD}\n`, "utf8");
  writeFileSync(
    join(subagentsD, `agent-${AGENT_NOTIFIED}.meta.json`),
    JSON.stringify({
      agentType: "auditor",
      description: "Long audit",
      toolUseId: "toolu_bg_9",
      spawnDepth: 1,
    }),
    "utf8",
  );
  // Includes an over-cap tool_result (3000 chars) for the truncation test.
  const agentD = [
    JSON.stringify({
      type: "user",
      isSidechain: true,
      agentId: AGENT_NOTIFIED,
      message: { role: "user", content: "Audit everything" },
      uuid: "e1",
      timestamp: "2026-01-04T08:00:02.000Z",
      cwd: projectRootD,
      sessionId: SESSION_3,
    }),
    JSON.stringify({
      type: "user",
      isSidechain: true,
      agentId: AGENT_NOTIFIED,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_big_1",
            content: [{ type: "text", text: "x".repeat(3000) }],
          },
        ],
      },
      uuid: "e2",
      timestamp: "2026-01-04T08:30:00.000Z",
      cwd: projectRootD,
      sessionId: SESSION_3,
    }),
  ].join("\n");
  writeFileSync(
    join(subagentsD, `agent-${AGENT_NOTIFIED}.jsonl`),
    `${agentD}\n`,
    "utf8",
  );

  // ── Project E: search cap (250 matching lines) + empty-thinking skip ────────
  projectRootE = join(tmpBase, "project-e");
  projectsDirE = join(tmpBase, "claude-projects-e");
  mkdirSync(projectRootE, { recursive: true });
  const sessionsDirE = join(projectsDirE, pathToSlug(projectRootE));
  mkdirSync(sessionsDirE, { recursive: true });

  // SESSION_1 slot: 250 user turns each containing "needle" → exercises the cap.
  const capLines: string[] = [];
  for (let i = 0; i < 250; i++) {
    capLines.push(
      JSON.stringify({
        type: "user",
        message: { role: "user", content: `needle hit number ${i}` },
        uuid: `cap-${i}`,
        timestamp: "2026-01-05T10:00:00.000Z",
        cwd: projectRootE,
        sessionId: SESSION_1,
      }),
    );
  }
  writeFileSync(
    join(sessionsDirE, `${SESSION_1}.jsonl`),
    `${capLines.join("\n")}\n`,
    "utf8",
  );

  // SESSION_2 slot: an assistant turn with an EMPTY (signature-only) thinking
  // block, a REAL thinking block, and a text block — the parser must skip the
  // empty one and surface the real one.
  const thinkLines = [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "start" },
      uuid: "t0",
      timestamp: "2026-01-05T11:00:00.000Z",
      cwd: projectRootE,
      sessionId: SESSION_2,
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-think-1",
        content: [
          { type: "thinking", thinking: "", signature: "sig-only-no-text" },
          { type: "thinking", thinking: "Real reasoning about the plan." },
          { type: "text", text: "Here is the visible answer." },
        ],
      },
      uuid: "t1",
      timestamp: "2026-01-05T11:00:05.000Z",
      cwd: projectRootE,
      sessionId: SESSION_2,
    }),
  ].join("\n");
  writeFileSync(
    join(sessionsDirE, `${SESSION_2}.jsonl`),
    `${thinkLines}\n`,
    "utf8",
  );

  // Route tests read the projects dir from the env override.
  process.env.CLAUDE_PROJECTS_DIR = projectsDir;
});

afterAll(() => {
  if (savedEnv === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
  else process.env.CLAUDE_PROJECTS_DIR = savedEnv;
  rmSync(tmpBase, { recursive: true, force: true });
});

const opts = () => ({ projectsDir });

// ── Dir resolution ────────────────────────────────────────────────────────────

describe("pathToSlug / resolveProjectSessionsDir", () => {
  it("slug rule matches the verified live behaviour", () => {
    expect(
      pathToSlug("f:\\Git\\Personal\\claude-code-multi-agent-framework"),
    ).toBe("f--Git-Personal-claude-code-multi-agent-framework");
    expect(pathToSlug("/home/user/my_app.v2")).toBe("-home-user-my-app-v2");
  });

  it("resolves via the exact slug", () => {
    expect(resolveProjectSessionsDir(projectRoot, opts())).toBe(sessionsDir);
  });

  it("falls back to cwd-matching when the dir name is not the slug", () => {
    const dir = resolveProjectSessionsDir(projectRootB, {
      projectsDir: projectsDirB,
    });
    expect(dir).toBe(join(projectsDirB, "some-weird-dirname"));
  });

  it("returns null for a project with no recorded sessions", () => {
    expect(
      resolveProjectSessionsDir(join(tmpBase, "no-such-project"), opts()),
    ).toBeNull();
  });
});

// ── listSessions ──────────────────────────────────────────────────────────────

describe("listSessions", () => {
  it("lists sessions newest-activity first with parsed fields", () => {
    const sessions = listSessions(projectRoot, opts());
    expect(sessions.map((s) => s.id)).toEqual([SESSION_1, SESSION_2]);

    const s1 = sessions[0];
    expect(s1.messageCount).toBe(6); // user+assistant only; malformed line skipped
    expect(s1.agentCount).toBe(3);
    expect(s1.gitBranch).toBe("main");
    expect(s1.startedAt).toBe("2026-01-02T10:00:00.000Z");
    expect(s1.title).toBe("Login feature build");
    expect(s1.firstPrompt).toBe("Build the login feature please");

    const s2 = sessions[1];
    expect(s2.agentCount).toBe(0);
    expect(s2.messageCount).toBe(3);
    expect(s2.gitBranch).toBe("dev");
    // The isMeta "Caveat:" line is noise — the real prompt is used.
    expect(s2.firstPrompt).toBe("Quick question about the API");
  });

  it("returns [] for a project with no sessions dir", () => {
    expect(listSessions(join(tmpBase, "no-such-project"), opts())).toEqual([]);
  });

  it("counts messages exactly via the raw chunked scan", () => {
    expect(countMessagesRaw(join(sessionsDir, `${SESSION_1}.jsonl`))).toBe(6);
  });
});

// ── readSessionTree ───────────────────────────────────────────────────────────

describe("readSessionTree", () => {
  it("builds the root node from the main transcript", () => {
    const tree = readSessionTree(projectRoot, SESSION_1, opts());
    expect(tree).not.toBeNull();
    expect(tree!.root.id).toBe("root");
    expect(tree!.root.parentId).toBeNull();
    expect(tree!.root.agentType).toBe("session");
    expect(tree!.root.spawnDepth).toBe(0);
    expect(tree!.root.messageCount).toBe(6);
    expect(tree!.root.model).toBe("claude-test-2");
    expect(tree!.root.description).toBe("Build the login feature please");
    expect(tree!.root.startedAt).toBe("2026-01-02T10:00:00.000Z");
  });

  it("links agents to their spawning turn via meta.toolUseId", () => {
    const tree = readSessionTree(projectRoot, SESSION_1, opts())!;
    expect(tree.agents).toHaveLength(3);

    const sync = tree.agents.find((a) => a.id === AGENT_SYNC)!;
    expect(sync.parentId).toBe("root");
    expect(sync.toolUseId).toBe("toolu_sync_1");
    expect(sync.agentType).toBe("developer");
    expect(sync.description).toBe("Implement login");
    expect(sync.spawnDepth).toBe(1);
    expect(sync.messageCount).toBe(5); // malformed line skipped
    expect(sync.model).toBe("claude-dev-1");

    const bg = tree.agents.find((a) => a.id === AGENT_BG)!;
    expect(bg.parentId).toBe("root");
    expect(bg.toolUseId).toBe("toolu_bg_2");

    // Nested: spawned from INSIDE agent aaaa's transcript.
    const nested = tree.agents.find((a) => a.id === AGENT_NESTED)!;
    expect(nested.parentId).toBe(AGENT_SYNC);
    expect(nested.spawnDepth).toBe(2);
    expect(nested.agentType).toBe("explorer");
  });

  it("live-vs-done: sync completion beats a fresh mtime; background ack does not", () => {
    // "now" close to the files' mtimes — everything is recent.
    const recent = readSessionTree(projectRoot, SESSION_1, {
      projectsDir,
      now: bgMtimeMs + 30_000,
    })!;
    // Sync agent: parent has toolUseResult.status "completed" → done even fresh.
    expect(recent.agents.find((a) => a.id === AGENT_SYNC)!.status).toBe("done");
    // Nested agent: completed tool_result lives in agent aaaa's transcript.
    expect(recent.agents.find((a) => a.id === AGENT_NESTED)!.status).toBe(
      "done",
    );
    // Background agent: only the async-launch ack exists → recent mtime = running.
    expect(recent.agents.find((a) => a.id === AGENT_BG)!.status).toBe(
      "running",
    );
    expect(recent.root.status).toBe("running");

    // Same tree read long after the last write → everything is done.
    const stale = readSessionTree(projectRoot, SESSION_1, {
      projectsDir,
      now: bgMtimeMs + 10 * 60_000,
    })!;
    expect(stale.agents.find((a) => a.id === AGENT_BG)!.status).toBe("done");
    expect(stale.root.status).toBe("done");
  });

  it("background agent completed via <task-notification> is done even when fresh", () => {
    const tree = readSessionTree(projectRootD, SESSION_3, {
      projectsDir: projectsDirD,
      now: Date.now(),
    })!;
    const agent = tree.agents.find((a) => a.id === AGENT_NOTIFIED)!;
    expect(agent.status).toBe("done");
  });

  it("returns null for unknown or path-unsafe session ids", () => {
    expect(
      readSessionTree(
        projectRoot,
        "99999999-9999-4999-8999-999999999999",
        opts(),
      ),
    ).toBeNull();
    expect(readSessionTree(projectRoot, "../evil", opts())).toBeNull();
    expect(readSessionTree(projectRoot, "", opts())).toBeNull();
  });

  it("sessionExists mirrors tree availability without a full parse", () => {
    expect(sessionExists(projectRoot, SESSION_1, opts())).toBe(true);
    expect(sessionExists(projectRoot, "../evil", opts())).toBe(false);
    expect(
      sessionExists(
        projectRoot,
        "99999999-9999-4999-8999-999999999999",
        opts(),
      ),
    ).toBe(false);
  });
});

// ── readAgentConversation ─────────────────────────────────────────────────────

describe("readAgentConversation", () => {
  it("maps the ROOT transcript to display turns", () => {
    const convo = readAgentConversation(
      projectRoot,
      SESSION_1,
      "root",
      opts(),
    )!;
    expect(convo.agentId).toBe("root");
    expect(convo.agentType).toBe("session");
    expect(convo.turns).toHaveLength(6);

    // u1: plain user text
    expect(convo.turns[0].role).toBe("user");
    expect(convo.turns[0].blocks).toEqual([
      {
        kind: "text",
        text: "Build the login feature please",
        truncated: false,
      },
    ]);

    // a1: assistant text + Agent tool_use with description summary
    const a1 = convo.turns[1];
    expect(a1.role).toBe("assistant");
    expect(a1.model).toBe("claude-test-1");
    expect(a1.blocks[0]).toEqual({
      kind: "text",
      text: "Spawning the developer.",
      truncated: false,
    });
    expect(a1.blocks[1]).toMatchObject({
      kind: "tool_use",
      toolUseId: "toolu_sync_1",
      name: "Agent",
      summary: "Implement login",
    });

    // u2: tool_result flattened to text
    expect(convo.turns[2].blocks[0]).toMatchObject({
      kind: "tool_result",
      toolUseId: "toolu_sync_1",
      text: "Login implemented.",
      isError: false,
      truncated: false,
    });
  });

  it("maps a subagent transcript: thinking, tool_use summaries, string results", () => {
    const convo = readAgentConversation(
      projectRoot,
      SESSION_1,
      AGENT_SYNC,
      opts(),
    )!;
    expect(convo.agentType).toBe("developer");
    expect(convo.description).toBe("Implement login");
    expect(convo.turns).toHaveLength(5); // malformed line skipped

    const s2 = convo.turns[1];
    expect(s2.blocks.map((b) => b.kind)).toEqual([
      "thinking",
      "text",
      "tool_use",
      "tool_use",
    ]);
    expect(s2.blocks[2]).toMatchObject({
      name: "Read",
      summary: "src/auth.ts",
    });

    // s3: string-form tool_result content
    expect(convo.turns[2].blocks[0]).toMatchObject({
      kind: "tool_result",
      text: "export function login() {}",
    });
  });

  it("handles string-content user messages (older format)", () => {
    const convo = readAgentConversation(
      projectRoot,
      SESSION_2,
      "root",
      opts(),
    )!;
    // q0 (isMeta caveat) still displays; q1 + q2 follow.
    expect(convo.turns).toHaveLength(3);
    expect(convo.turns[1].blocks[0]).toMatchObject({
      kind: "text",
      text: "Quick question about the API",
    });
  });

  it("truncates oversized tool_results and flags it", () => {
    const convo = readAgentConversation(
      projectRootD,
      SESSION_3,
      AGENT_NOTIFIED,
      {
        projectsDir: projectsDirD,
      },
    )!;
    const big = convo.turns[1].blocks[0];
    expect(big.kind).toBe("tool_result");
    if (big.kind === "tool_result") {
      expect(big.truncated).toBe(true);
      expect(big.text.length).toBe(2001); // 2000-char cap + ellipsis
    }
  });

  it("returns null for unknown or path-unsafe agent ids", () => {
    expect(
      readAgentConversation(projectRoot, SESSION_1, "nope123", opts()),
    ).toBeNull();
    expect(
      readAgentConversation(projectRoot, SESSION_1, "../../evil", opts()),
    ).toBeNull();
    expect(
      readAgentConversation(projectRoot, "../evil", "root", opts()),
    ).toBeNull();
  });
});

// ── readAgentConversation pagination (windowing) ──────────────────────────────
// SESSION_1 root turns, chronological: [u1, a1, u2, a2, u3, a3] (6 total).

describe("readAgentConversation pagination", () => {
  it("default (no params) returns the TAIL of the whole conversation", () => {
    const c = readAgentConversation(projectRoot, SESSION_1, "root", opts())!;
    expect(c.total).toBe(6);
    expect(c.turns.map((t) => t.uuid)).toEqual([
      "u1",
      "a1",
      "u2",
      "a2",
      "u3",
      "a3",
    ]);
    expect(c.hasMore).toBe(false);
    expect(c.oldestUuid).toBe("u1");
    expect(c.model).toBe("claude-test-2"); // last assistant model in the file
  });

  it("tail window: last `limit` turns, hasMore + oldestUuid set", () => {
    const c = readAgentConversation(projectRoot, SESSION_1, "root", {
      projectsDir,
      limit: 2,
    })!;
    expect(c.turns.map((t) => t.uuid)).toEqual(["u3", "a3"]);
    expect(c.total).toBe(6);
    expect(c.hasMore).toBe(true);
    expect(c.oldestUuid).toBe("u3");
  });

  it("before=<uuid>: the `limit` turns immediately BEFORE the cursor", () => {
    const c = readAgentConversation(projectRoot, SESSION_1, "root", {
      projectsDir,
      before: "u3",
      limit: 2,
    })!;
    expect(c.turns.map((t) => t.uuid)).toEqual(["u2", "a2"]);
    expect(c.hasMore).toBe(true); // [u1, a1] still older
    expect(c.oldestUuid).toBe("u2");
  });

  it("before near the start: hasMore false once the head is reached", () => {
    const c = readAgentConversation(projectRoot, SESSION_1, "root", {
      projectsDir,
      before: "a1",
      limit: 10,
    })!;
    expect(c.turns.map((t) => t.uuid)).toEqual(["u1"]);
    expect(c.hasMore).toBe(false);
    expect(c.oldestUuid).toBe("u1");
  });

  it("all=1 returns the full conversation (escape hatch)", () => {
    const c = readAgentConversation(projectRoot, SESSION_1, "root", {
      projectsDir,
      all: true,
      limit: 2, // ignored under all
    })!;
    expect(c.turns).toHaveLength(6);
    expect(c.hasMore).toBe(false);
    expect(c.oldestUuid).toBe("u1");
  });

  it("an unknown before cursor yields an empty window (dead cursor)", () => {
    const c = readAgentConversation(projectRoot, SESSION_1, "root", {
      projectsDir,
      before: "no-such-uuid",
    })!;
    expect(c.turns).toEqual([]);
    expect(c.total).toBe(6);
    expect(c.hasMore).toBe(false);
    expect(c.oldestUuid).toBeNull();
  });
});

// ── thinking-block surfacing ──────────────────────────────────────────────────

describe("thinking blocks", () => {
  it("surfaces a non-empty thinking block in the conversation", () => {
    const c = readAgentConversation(
      projectRoot,
      SESSION_1,
      AGENT_SYNC,
      opts(),
    )!;
    const thinking = c.turns
      .flatMap((t) => t.blocks)
      .find((b) => b.kind === "thinking");
    expect(thinking).toBeDefined();
    expect(thinking).toMatchObject({
      kind: "thinking",
      text: "Need to check the auth module first.",
    });
  });

  it("skips an empty (signature-only) thinking block, keeps the real one", () => {
    const c = readAgentConversation(projectRootE, SESSION_2, "root", {
      projectsDir: projectsDirE,
    })!;
    const assistant = c.turns.find((t) => t.role === "assistant")!;
    expect(assistant.blocks.map((b) => b.kind)).toEqual(["thinking", "text"]);
    expect(assistant.blocks[0]).toMatchObject({
      kind: "thinking",
      text: "Real reasoning about the plan.",
    });
  });
});

// ── readToolResult (full, untruncated tool_result by id) ──────────────────────

describe("readToolResult", () => {
  it("returns the tool name/input + the FULL result text", () => {
    const d = readToolResult(projectRoot, SESSION_1, "toolu_sync_1", opts())!;
    expect(d.toolUseId).toBe("toolu_sync_1");
    expect(d.name).toBe("Agent");
    expect(d.input).toMatchObject({
      subagent_type: "developer",
      description: "Implement login",
    });
    expect(d.result).toEqual({
      text: "Login implemented.",
      isError: false,
      truncated: false,
    });
  });

  it("returns the UNTRUNCATED result even past the display cap", () => {
    // AGENT_NOTIFIED's toolu_big_1 is a 3000-char result (display caps at 2000).
    const d = readToolResult(projectRootD, SESSION_3, "toolu_big_1", {
      projectsDir: projectsDirD,
    })!;
    expect(d.result.truncated).toBe(false);
    expect(d.result.text.length).toBe(3000);
  });

  it("404s (null) for an unknown or path-unsafe tool id", () => {
    expect(
      readToolResult(projectRoot, SESSION_1, "toolu_missing", opts()),
    ).toBeNull();
    expect(
      readToolResult(projectRoot, SESSION_1, "../evil", opts()),
    ).toBeNull();
  });
});

// ── searchSession (in-session substring search) ───────────────────────────────

describe("searchSession", () => {
  it("finds case-insensitive hits across text and thinking of all agents", () => {
    const r = searchSession(projectRoot, SESSION_1, "AUTH MODULE", opts())!;
    expect(r.capped).toBe(false);
    // agent aaaa: thinking "Need to check the auth module first." + text
    // "Reading the auth module." — both hit, case-insensitively.
    const kinds = r.matches
      .filter((m) => m.agentId === AGENT_SYNC)
      .map((m) => m.blockType)
      .sort();
    expect(kinds).toEqual(["text", "thinking"]);
    const thinkingHit = r.matches.find(
      (m) => m.agentId === AGENT_SYNC && m.blockType === "thinking",
    )!;
    expect(thinkingHit.agentLabel).toBe("developer");
    expect(thinkingHit.role).toBe("assistant");
    expect(thinkingHit.snippet.toLowerCase()).toContain("auth module");
  });

  it("searches the root transcript (agentId 'root', label 'session')", () => {
    const r = searchSession(projectRoot, SESSION_1, "login feature", opts())!;
    const rootHit = r.matches.find((m) => m.agentId === "root")!;
    expect(rootHit).toBeDefined();
    expect(rootHit.agentLabel).toBe("session");
  });

  it("returns no matches for a miss or an empty query", () => {
    expect(
      searchSession(projectRoot, SESSION_1, "zzz-not-present", opts())!.matches,
    ).toEqual([]);
    expect(
      searchSession(projectRoot, SESSION_1, "   ", opts())!.matches,
    ).toEqual([]);
  });

  it("caps the match count and flags it", () => {
    const r = searchSession(projectRootE, SESSION_1, "needle", {
      projectsDir: projectsDirE,
    })!;
    expect(r.matches).toHaveLength(200);
    expect(r.capped).toBe(true);
  });

  it("returns null for an unknown/path-unsafe session id", () => {
    expect(searchSession(projectRoot, "../evil", "x", opts())).toBeNull();
  });
});

// ── Route plugin (Fastify inject) ─────────────────────────────────────────────

describe("sessions routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(sessionsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/sessions returns the session list", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string }[];
    expect(body.map((s) => s.id)).toEqual([SESSION_1, SESSION_2]);
  });

  it("GET /api/sessions/:id/tree returns the agent tree", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${SESSION_1}/tree`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { sessionId: string; agents: unknown[] };
    expect(body.sessionId).toBe(SESSION_1);
    expect(body.agents).toHaveLength(3);
  });

  it("GET /api/sessions/:id/agents/root returns the conversation", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${SESSION_1}/agents/root`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { turns: unknown[]; total: number };
    expect(body.turns).toHaveLength(6);
    expect(body.total).toBe(6);
  });

  it("GET agents honours ?limit / ?before / ?all query params", async () => {
    const tail = await app.inject({
      method: "GET",
      url: `/api/sessions/${SESSION_1}/agents/root?limit=2`,
    });
    const tailBody = tail.json() as {
      turns: { uuid: string }[];
      total: number;
      hasMore: boolean;
      oldestUuid: string;
    };
    expect(tailBody.turns.map((t) => t.uuid)).toEqual(["u3", "a3"]);
    expect(tailBody.total).toBe(6);
    expect(tailBody.hasMore).toBe(true);
    expect(tailBody.oldestUuid).toBe("u3");

    const before = await app.inject({
      method: "GET",
      url: `/api/sessions/${SESSION_1}/agents/root?before=u3&limit=2`,
    });
    const beforeBody = before.json() as { turns: { uuid: string }[] };
    expect(beforeBody.turns.map((t) => t.uuid)).toEqual(["u2", "a2"]);

    const all = await app.inject({
      method: "GET",
      url: `/api/sessions/${SESSION_1}/agents/root?all=1`,
    });
    expect((all.json() as { turns: unknown[] }).turns).toHaveLength(6);
  });

  it("GET /api/sessions/:id/tools/:toolUseId returns the full result", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${SESSION_1}/tools/toolu_sync_1`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      name: string;
      result: { text: string; truncated: boolean };
    };
    expect(body.name).toBe("Agent");
    expect(body.result).toMatchObject({
      text: "Login implemented.",
      truncated: false,
    });

    const missing = await app.inject({
      method: "GET",
      url: `/api/sessions/${SESSION_1}/tools/toolu_missing`,
    });
    expect(missing.statusCode).toBe(404);
  });

  it("GET /api/sessions/:id/search returns matches (404 for unknown session)", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/sessions/${SESSION_1}/search?q=${encodeURIComponent("auth module")}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { q: string; matches: unknown[] };
    expect(body.q).toBe("auth module");
    expect(body.matches.length).toBeGreaterThan(0);

    const unknown = await app.inject({
      method: "GET",
      url: "/api/sessions/99999999-9999-4999-8999-999999999999/search?q=x",
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("404s unknown sessions, unknown agents, and traversal ids", async () => {
    const unknown = await app.inject({
      method: "GET",
      url: "/api/sessions/99999999-9999-4999-8999-999999999999/tree",
    });
    expect(unknown.statusCode).toBe(404);

    const badAgent = await app.inject({
      method: "GET",
      url: `/api/sessions/${SESSION_1}/agents/nope123`,
    });
    expect(badAgent.statusCode).toBe(404);

    const traversal = await app.inject({
      method: "GET",
      url: `/api/sessions/${encodeURIComponent("../evil")}/tree`,
    });
    expect(traversal.statusCode).toBe(404);

    const streamUnknown = await app.inject({
      method: "GET",
      url: "/api/sessions/99999999-9999-4999-8999-999999999999/stream",
    });
    expect(streamUnknown.statusCode).toBe(404);
  });
});

// ── Per-file stat-keyed cache (path, mtimeMs, size) ───────────────────────────
// The cache must never serve a STALE transcript (a changed mtime/size recomputes)
// yet must genuinely avoid re-reading an UNCHANGED one. mtimes are set explicitly
// with utimesSync so invalidation is deterministic (not dependent on FS clocks).

describe("transcript stat-keyed cache", () => {
  const line = (type: string, uuid: string): string =>
    JSON.stringify({
      type,
      message: { role: type, content: `msg ${uuid}` },
      uuid,
      timestamp: "2026-02-01T00:00:00.000Z",
    });

  it("countMessagesRaw recomputes when the file grows (mtime+size change)", () => {
    clearTranscriptCaches();
    const dir = join(tmpBase, "cache-grow");
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "grow.jsonl");
    writeFileSync(
      f,
      `${[line("user", "a"), line("assistant", "b")].join("\n")}\n`,
      "utf8",
    );
    const t0 = new Date(Date.now() - 120_000);
    utimesSync(f, t0, t0);
    expect(countMessagesRaw(f)).toBe(2); // miss → compute + cache

    writeFileSync(
      f,
      `${[line("user", "a"), line("assistant", "b"), line("user", "c")].join("\n")}\n`,
      "utf8",
    );
    const t1 = new Date();
    utimesSync(f, t1, t1);
    expect(countMessagesRaw(f)).toBe(3); // must NOT serve the stale 2
  });

  it("recomputes on an mtime change even at identical byte size", () => {
    clearTranscriptCaches();
    const dir = join(tmpBase, "cache-mtime");
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "same-size.jsonl");
    writeFileSync(
      f,
      `${[line("user", "a"), line("user", "b")].join("\n")}\n`,
      "utf8",
    );
    const t0 = new Date(Date.now() - 120_000);
    utimesSync(f, t0, t0);
    expect(countMessagesRaw(f)).toBe(2);

    // Rewrite the SAME byte length ("user" → "usAr", both 4 chars, in type+role)
    // so one line stops being a counted type — only mtime distinguishes them.
    writeFileSync(
      f,
      `${[line("usAr", "a"), line("user", "b")].join("\n")}\n`,
      "utf8",
    );
    const t1 = new Date();
    utimesSync(f, t1, t1);
    expect(countMessagesRaw(f)).toBe(1); // proves mtime is part of the key
  });

  it("serves the cached value for an in-place edit with unchanged (mtime,size)", () => {
    clearTranscriptCaches();
    const dir = join(tmpBase, "cache-hit");
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "inplace.jsonl");
    writeFileSync(
      f,
      `${[line("user", "r1"), line("user", "r2")].join("\n")}\n`,
      "utf8",
    );
    const t = new Date("2026-03-03T03:03:03.000Z");
    utimesSync(f, t, t);
    expect(countMessagesRaw(f)).toBe(2); // populate the cache

    // Different content + count, SAME byte size, SAME mtime → key unchanged, so
    // the cached value is returned (proves the read is genuinely cached — a
    // re-read would yield 1).
    writeFileSync(
      f,
      `${[line("usAr", "r1"), line("user", "r2")].join("\n")}\n`,
      "utf8",
    );
    utimesSync(f, t, t);
    expect(countMessagesRaw(f)).toBe(2);
  });

  it("readAgentConversation reflects appended turns (readJsonl cache invalidates)", () => {
    clearTranscriptCaches();
    const root = join(tmpBase, "cache-convo-project");
    const pdir = join(tmpBase, "cache-convo-claude");
    const sdir = join(pdir, pathToSlug(root));
    mkdirSync(sdir, { recursive: true });
    mkdirSync(root, { recursive: true });
    const sid = "44444444-4444-4444-8444-444444444444";
    const f = join(sdir, `${sid}.jsonl`);
    writeFileSync(
      f,
      `${[line("user", "c1"), line("assistant", "c2")].join("\n")}\n`,
      "utf8",
    );
    const t0 = new Date(Date.now() - 120_000);
    utimesSync(f, t0, t0);
    expect(
      readAgentConversation(root, sid, "root", { projectsDir: pdir })!.total,
    ).toBe(2);

    writeFileSync(
      f,
      `${[line("user", "c1"), line("assistant", "c2"), line("user", "c3")].join("\n")}\n`,
      "utf8",
    );
    const t1 = new Date();
    utimesSync(f, t1, t1);
    expect(
      readAgentConversation(root, sid, "root", { projectsDir: pdir })!.total,
    ).toBe(3);
  });
});

// ── countMessagesRaw — 1MB chunk-boundary correctness ─────────────────────────

describe("countMessagesRaw chunk boundaries", () => {
  it("does not double-count a needle that lands inside the carry region", () => {
    clearTranscriptCaches();
    const dir = join(tmpBase, "count-boundary");
    mkdirSync(dir, { recursive: true });
    const f = join(dir, "boundary.jsonl");

    const CHUNK = 1024 * 1024;
    const mkLine = (obj: Record<string, unknown>): string =>
      `${JSON.stringify(obj)}\n`;
    const userLine = mkLine({
      type: "user",
      message: { role: "user", content: "hi" },
      uuid: "u",
    });
    const asstLine = mkLine({
      type: "assistant",
      message: { role: "assistant", content: "ok" },
      uuid: "a",
    });

    // Start the user line at CHUNK-18 so its `"type":"user"` token (line offset
    // 1..14) sits wholly inside the last 17 bytes of chunk 1 → re-enters via the
    // carry on the next chunk. The OLD code counted it TWICE (returned 3); the
    // fixed "count only matches ending past the carry" returns the true 2.
    const userStart = CHUNK - 18;
    const fillerOverhead = mkLine({ type: "filler", pad: "" }).length;
    const pad = "A".repeat(userStart - fillerOverhead);
    const fillerLine = mkLine({ type: "filler", pad });
    expect(fillerLine.length).toBe(userStart); // exact byte placement

    const content = fillerLine + userLine + asstLine;
    writeFileSync(f, content, "utf8");

    const truth = content
      .split("\n")
      .filter((l) => l.trim())
      .filter((l) => {
        try {
          const o = JSON.parse(l) as { type?: string };
          return o.type === "user" || o.type === "assistant";
        } catch {
          return false;
        }
      }).length;
    expect(truth).toBe(2);
    expect(countMessagesRaw(f)).toBe(2);
  });
});
