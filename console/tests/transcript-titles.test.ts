// @vitest-environment node
/**
 * transcript-titles.test.ts — §4.3 rename-aware titles (BUG-018).
 *
 * Ground truth (verified live on Claude Code 2.1.202): a manual session
 * rename persists as {"type":"custom-title","customTitle":…,"sessionId":…}
 * lines APPENDED to the main transcript; the ~/.claude/sessions/<pid>.json
 * index is NOT updated (nameSource stays "derived"). The parser's ladder:
 * rename > summary/ai-title > firstPrompt > id, surfaced as `titleSource`,
 * with a machine-local sidecar (<stateDir>/session-names.json) remembering
 * observed renames. CCMAF_CONSOLE_STATE_DIR points the sidecar at a tmp dir.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const tmpBase = join(tmpdir(), `ccmaf-titles-${Date.now()}`);
const stateDir = join(tmpBase, "console-state");
const savedStateDir = process.env.CCMAF_CONSOLE_STATE_DIR;
process.env.CCMAF_CONSOLE_STATE_DIR = stateDir;

const { clearTranscriptCaches, listSessions, pathToSlug } =
  await import("../src/server/parsers/transcript-parser.js");

const S_RENAME = "aaaaaaaa-0000-4000-8000-000000000001";
const S_SUMMARY = "bbbbbbbb-0000-4000-8000-000000000002";
const S_PROMPT = "cccccccc-0000-4000-8000-000000000003";
const S_BARE = "dddddddd-0000-4000-8000-000000000004";
const S_TAIL = "eeeeeeee-0000-4000-8000-000000000005";
const S_FOREIGN = "ffffffff-0000-4000-8000-000000000006";

let projectRoot = "";
let projectsDir = "";
let sessionsDir = "";

const jl = (o: object) => JSON.stringify(o);
const userLine = (sessionId: string, uuid: string, text: string) =>
  jl({
    type: "user",
    message: { role: "user", content: text },
    uuid,
    timestamp: "2026-07-07T10:00:00.000Z",
    gitBranch: "main",
    sessionId,
  });
const customTitle = (sessionId: string, name: string) =>
  jl({ type: "custom-title", customTitle: name, sessionId });

function writeSession(id: string, lines: string[]): void {
  writeFileSync(
    join(sessionsDir, `${id}.jsonl`),
    `${lines.join("\n")}\n`,
    "utf8",
  );
}

const opts = () => ({ projectsDir });

beforeAll(() => {
  projectRoot = join(tmpBase, "project");
  projectsDir = join(tmpBase, "claude-projects");
  sessionsDir = join(projectsDir, pathToSlug(projectRoot));
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
  clearTranscriptCaches();

  // Renamed twice + a summary line: rename must override summary, newest wins.
  writeSession(S_RENAME, [
    userLine(S_RENAME, "r1", "Build the console v2 pass"),
    jl({ type: "summary", summary: "Console v2 build", sessionId: S_RENAME }),
    customTitle(S_RENAME, "First name"),
    customTitle(S_RENAME, "Fable Rebuild"),
  ]);

  // Summary-titled session (today's behaviour — rung 2).
  writeSession(S_SUMMARY, [
    userLine(S_SUMMARY, "s1", "Fix the login bug"),
    jl({
      type: "summary",
      summary: "Login feature build",
      sessionId: S_SUMMARY,
    }),
  ]);

  // Prompt-only session (rung 3).
  writeSession(S_PROMPT, [userLine(S_PROMPT, "p1", "Quick question")]);

  // No user prompt at all (rung 4 — id).
  writeSession(S_BARE, [
    jl({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "hi" }] },
      uuid: "b1",
      timestamp: "2026-07-07T10:00:00.000Z",
      sessionId: S_BARE,
    }),
  ]);

  // custom-title naming a DIFFERENT session (copied/forked lines) — ignored.
  writeSession(S_FOREIGN, [
    userLine(S_FOREIGN, "f1", "Foreign rename test"),
    customTitle(S_RENAME, "Not my name"),
  ]);

  // Rename beyond the 512KB head window: ~600KB of filler, title at the tail.
  const filler: string[] = [userLine(S_TAIL, "t0", "Long session start")];
  const pad = "x".repeat(900);
  for (let i = 0; i < 700; i++) {
    filler.push(
      jl({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: pad }] },
        uuid: `t${i + 1}`,
        timestamp: "2026-07-07T10:01:00.000Z",
        sessionId: S_TAIL,
      }),
    );
  }
  filler.push(customTitle(S_TAIL, "Tail Rename"));
  writeSession(S_TAIL, filler);
});

afterAll(() => {
  if (savedStateDir === undefined) delete process.env.CCMAF_CONSOLE_STATE_DIR;
  else process.env.CCMAF_CONSOLE_STATE_DIR = savedStateDir;
  clearTranscriptCaches();
  rmSync(tmpBase, { recursive: true, force: true });
});

function byId(id: string) {
  const s = listSessions(projectRoot, opts()).find((x) => x.id === id);
  expect(s).toBeDefined();
  return s!;
}

describe("title-source ladder (§4.3)", () => {
  it("rung 1: a manual rename wins over the summary line; newest rename wins", () => {
    const s = byId(S_RENAME);
    expect(s.title).toBe("Fable Rebuild");
    expect(s.titleSource).toBe("rename");
  });

  it("rung 1 (tail): a rename beyond the head window is found in the tail scan", () => {
    const s = byId(S_TAIL);
    expect(s.title).toBe("Tail Rename");
    expect(s.titleSource).toBe("rename");
  });

  it("ignores custom-title lines that name a different session", () => {
    const s = byId(S_FOREIGN);
    expect(s.title).toBeNull();
    expect(s.titleSource).toBe("prompt");
    expect(s.firstPrompt).toBe("Foreign rename test");
  });

  it("rung 2: summary/ai-title (today's source) → titleSource 'summary'", () => {
    const s = byId(S_SUMMARY);
    expect(s.title).toBe("Login feature build");
    expect(s.titleSource).toBe("summary");
  });

  it("rung 3/4: firstPrompt → 'prompt'; nothing at all → 'id'", () => {
    expect(byId(S_PROMPT).titleSource).toBe("prompt");
    expect(byId(S_BARE).titleSource).toBe("id");
  });
});

describe("rename sidecar (machine-local cache)", () => {
  it("persists observed renames and serves them when the line leaves the scan windows", () => {
    // The beforeAll listings above observed the rename → sidecar written.
    byId(S_RENAME);
    const sidecarPath = join(stateDir, "session-names.json");
    expect(existsSync(sidecarPath)).toBe(true);
    const sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as Record<
      string,
      { name: string; seenAt: string }
    >;
    expect(sidecar[S_RENAME]?.name).toBe("Fable Rebuild");
    expect(sidecar[S_TAIL]?.name).toBe("Tail Rename");

    // Simulate the custom-title line scrolling out of both windows: rewrite
    // the transcript WITHOUT it. The sidecar must keep the name alive.
    writeSession(S_RENAME, [
      userLine(S_RENAME, "r1", "Build the console v2 pass"),
      jl({ type: "summary", summary: "Console v2 build", sessionId: S_RENAME }),
    ]);
    clearTranscriptCaches();
    const s = byId(S_RENAME);
    expect(s.title).toBe("Fable Rebuild");
    expect(s.titleSource).toBe("rename");
  });
});
