/**
 * sessions-rows.test.ts — unit tests for the Sessions conversation row model
 * (the tool-flood compression) + ledger + timeline + local search fallback.
 */
import { describe, it, expect } from "vitest";
import {
  buildRowModel,
  buildTimeline,
  describeNoisePrompt,
  filterLedger,
  groupChipSegments,
  humanToolSummary,
  isNoisePrompt,
  matchesRailFilter,
  searchLoadedTurns,
  type ConvoRow,
} from "../src/app/sessions/rows";
import type { ConversationTurn, TurnBlock } from "../src/app/api/sessions";

/* ── fixture helpers ── */

let uuidSeq = 0;
function turn(
  role: "user" | "assistant",
  blocks: TurnBlock[],
  uuid?: string,
): ConversationTurn {
  return {
    uuid: uuid ?? `uuid-${++uuidSeq}`,
    role,
    timestamp: "2026-07-07T10:00:00Z",
    model: role === "assistant" ? "claude-opus-4-8" : null,
    blocks,
  };
}

const text = (t: string): TurnBlock => ({
  kind: "text",
  text: t,
  truncated: false,
});
const thinking = (t: string): TurnBlock => ({
  kind: "thinking",
  text: t,
  truncated: false,
});
const toolUse = (id: string, name: string, summary = ""): TurnBlock => ({
  kind: "tool_use",
  toolUseId: id,
  name,
  summary,
});
const toolResult = (id: string, isError = false): TurnBlock => ({
  kind: "tool_result",
  toolUseId: id,
  text: isError ? "boom" : "ok",
  isError,
  truncated: false,
});

/** The canonical mini-conversation used across tests. */
function miniConversation(): ConversationTurn[] {
  return [
    turn("user", [text("Build the widget please")], "u1"),
    turn("assistant", [thinking("plan it"), text("Starting on it.")], "u2"),
    turn("assistant", [toolUse("t1", "Read", "src/a.ts")], "u3"),
    turn("user", [toolResult("t1")], "u4"),
    turn(
      "assistant",
      [thinking("hmm, run it"), toolUse("t2", "Bash", "npm test")],
      "u5",
    ),
    turn("user", [toolResult("t2", true)], "u6"),
    turn("assistant", [text("Done — one test failed.")], "u7"),
  ];
}

/* ── grouping ── */

describe("buildRowModel — tool-run compression", () => {
  it("collapses consecutive tool_use/tool_result turns into ONE group row", () => {
    const m = buildRowModel(miniConversation());
    const kinds = m.rows.map((r) => r.kind);
    // prompt, thinking, assistant, ONE toolGroup (Read+Bash), assistant
    expect(kinds).toEqual([
      "prompt",
      "thinking",
      "assistant",
      "toolGroup",
      "assistant",
    ]);
    const group = m.rows.find(
      (r): r is Extract<ConvoRow, { kind: "toolGroup" }> =>
        r.kind === "toolGroup",
    )!;
    expect(group.ledgerEnd - group.ledgerStart).toBe(2);
    expect(group.errorCount).toBe(1);
    expect(group.counts).toEqual([
      ["Read", 1],
      ["Bash", 1],
    ]);
  });

  it("folds thinking inside tool-only turns INTO the group", () => {
    const m = buildRowModel(miniConversation());
    const group = m.rows.find(
      (r): r is Extract<ConvoRow, { kind: "toolGroup" }> =>
        r.kind === "toolGroup",
    )!;
    expect(group.thinking).toHaveLength(1);
    expect(group.thinking[0].text).toBe("hmm, run it");
  });

  it("keeps thinking that accompanies assistant TEXT as a visible row", () => {
    const m = buildRowModel(miniConversation());
    const th = m.rows.filter((r) => r.kind === "thinking");
    expect(th).toHaveLength(1);
    expect((th[0] as Extract<ConvoRow, { kind: "thinking" }>).text).toBe(
      "plan it",
    );
  });

  it("pairs results with calls in the ledger (later user turn)", () => {
    const m = buildRowModel(miniConversation());
    expect(m.ledger).toHaveLength(2);
    expect(m.ledger[0].name).toBe("Read");
    expect(m.ledger[0].result?.isError).toBe(false);
    expect(m.ledger[1].name).toBe("Bash");
    expect(m.ledger[1].result?.isError).toBe(true);
    expect(m.errorCount).toBe(1);
  });

  it("a REAL user prompt breaks a run into two groups", () => {
    const turns = [
      turn("assistant", [toolUse("a", "Read")]),
      turn("user", [toolResult("a")]),
      turn("user", [text("Actually, stop and do X")]),
      turn("assistant", [toolUse("b", "Edit")]),
      turn("user", [toolResult("b")]),
    ];
    const m = buildRowModel(turns);
    expect(m.rows.map((r) => r.kind)).toEqual([
      "toolGroup",
      "prompt",
      "toolGroup",
    ]);
  });

  it("noise prompts (injected XML) do NOT break a run and render dim", () => {
    const turns = [
      turn("assistant", [toolUse("a", "Read")]),
      turn("user", [toolResult("a")]),
      turn("user", [text("<system-reminder>tick</system-reminder>")]),
      turn("assistant", [toolUse("b", "Edit")]),
      turn("user", [toolResult("b")]),
    ];
    const m = buildRowModel(turns);
    const kinds = m.rows.map((r) => r.kind);
    // The run stays ONE group; the notice renders after the chip.
    expect(kinds).toEqual(["toolGroup", "prompt"]);
    // one group only — both calls in it
    const groups = m.rows.filter((r) => r.kind === "toolGroup");
    expect(groups).toHaveLength(1);
    const g = groups[0] as Extract<ConvoRow, { kind: "toolGroup" }>;
    expect(g.ledgerEnd - g.ledgerStart).toBe(2);
    const notice = m.rows.find((r) => r.kind === "prompt") as Extract<
      ConvoRow,
      { kind: "prompt" }
    >;
    expect(notice.noise).toBe(true);
  });

  it("marks long prompts for clamping", () => {
    const long = "line\n".repeat(30);
    const m = buildRowModel([turn("user", [text(long)])]);
    const p = m.rows[0] as Extract<ConvoRow, { kind: "prompt" }>;
    expect(p.long).toBe(true);
  });

  it("prepends a load-earlier row when hasEarlier", () => {
    const m = buildRowModel(miniConversation(), { hasEarlier: true });
    expect(m.rows[0].kind).toBe("loadEarlier");
  });

  it("compresses a long agentic run to ~rows, not ~turns", () => {
    // 60 turns of tool churn + 1 verdict → 2 narrative rows.
    const turns: ConversationTurn[] = [];
    for (let i = 0; i < 30; i++) {
      turns.push(
        turn("assistant", [thinking(`t${i}`), toolUse(`id${i}`, "Read")]),
      );
      turns.push(turn("user", [toolResult(`id${i}`)]));
    }
    turns.push(turn("assistant", [text("All done.")]));
    const m = buildRowModel(turns);
    expect(m.rows).toHaveLength(2); // one group + one assistant row
    expect(m.ledger).toHaveLength(30);
  });

  it("keeps toolGroup keys STABLE across a load-earlier prepend", () => {
    // The same window built alone vs. with an earlier page prepended must
    // key its groups identically (g:<anchorUuid> — no sequence prefix),
    // otherwise "load earlier" snaps expanded groups shut and orphans the
    // j/k cursor.
    const windowTurns = miniConversation();
    const before = buildRowModel(windowTurns, { hasEarlier: true });
    const groupKeyBefore = before.rows.find((r) => r.kind === "toolGroup")!.key;

    const earlier = [
      turn("assistant", [toolUse("e1", "Grep", "old search")], "e-a"),
      turn("user", [toolResult("e1")], "e-b"),
      turn("assistant", [text("Earlier verdict.")], "e-c"),
    ];
    const after = buildRowModel([...earlier, ...windowTurns]);
    const afterKeys = after.rows
      .filter((r) => r.kind === "toolGroup")
      .map((r) => r.key);

    // Two groups now (the earlier run + the original), original key intact.
    expect(afterKeys).toHaveLength(2);
    expect(afterKeys).toContain(groupKeyBefore);
    expect(after.rowKeyByToolUseId.get("t2")).toBe(groupKeyBefore);
    // Keys are anchor-derived and unique.
    expect(new Set(afterKeys).size).toBe(afterKeys.length);
    expect(groupKeyBefore).toBe("g:u3");
  });

  it("builds the sync maps (turn→row, toolUse→group)", () => {
    const m = buildRowModel(miniConversation());
    const group = m.rows.find((r) => r.kind === "toolGroup")!;
    expect(m.rowKeyByToolUseId.get("t2")).toBe(group.key);
    // the tool_result-only user turn maps to the group row too
    expect(m.rowKeyByTurnUuid.get("u4")).toBe(group.key);
    expect(m.rowKeyByTurnUuid.get("u1")).toBeDefined();
    expect(m.ledgerIndexByToolUseId.get("t2")).toBe(1);
  });
});

describe("groupChipSegments", () => {
  it("returns total + top-3 names + overflow count", () => {
    const turns: ConversationTurn[] = [];
    const mk = (name: string, n: number) => {
      for (let i = 0; i < n; i++) {
        turns.push(turn("assistant", [toolUse(`${name}${i}`, name)]));
      }
    };
    mk("Read", 6);
    mk("Edit", 4);
    mk("Bash", 4);
    mk("Grep", 1);
    const m = buildRowModel(turns);
    const g = m.rows[0] as Extract<ConvoRow, { kind: "toolGroup" }>;
    const seg = groupChipSegments(g);
    expect(seg.total).toBe(15);
    expect(seg.top.map(([n]) => n)).toEqual(["Read", "Edit", "Bash"]);
    expect(seg.moreNames).toBe(1);
  });
});

describe("filterLedger + buildTimeline", () => {
  it("filters by tool name and errors-only", () => {
    const m = buildRowModel(miniConversation());
    expect(filterLedger(m.ledger, "all")).toHaveLength(2);
    expect(filterLedger(m.ledger, { tool: "Read" })).toHaveLength(1);
    expect(filterLedger(m.ledger, "errors")).toHaveLength(1);
    expect(filterLedger(m.ledger, "errors")[0].name).toBe("Bash");
  });

  it("buckets the ledger with error flags", () => {
    const m = buildRowModel(miniConversation());
    const tl = buildTimeline(m.ledger, 2);
    expect(tl).toHaveLength(2);
    expect(tl[0].errors).toBe(0);
    expect(tl[1].errors).toBe(1);
    expect(tl[0].start).toBe(0);
  });

  it("returns [] for an empty ledger", () => {
    expect(buildTimeline([], 48)).toEqual([]);
  });
});

describe("searchLoadedTurns (local fallback)", () => {
  it("finds case-insensitive matches with snippets", () => {
    const hits = searchLoadedTurns(miniConversation(), "WIDGET");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].turnUuid).toBe("u1");
    expect(hits[0].snippet).toContain("widget");
  });

  it("searches tool names/summaries too", () => {
    const hits = searchLoadedTurns(miniConversation(), "npm test");
    expect(hits.some((h) => h.blockType === "tool_use")).toBe(true);
  });

  it("returns [] for blank queries", () => {
    expect(searchLoadedTurns(miniConversation(), "  ")).toEqual([]);
  });
});

describe("isNoisePrompt", () => {
  it("classifies injected XML and caveats as noise", () => {
    expect(isNoisePrompt("<task-notification>x</task-notification>")).toBe(
      true,
    );
    expect(isNoisePrompt("Caveat: the messages below…")).toBe(true);
    expect(isNoisePrompt("Fix the login bug")).toBe(false);
  });
});

describe("describeNoisePrompt", () => {
  it("labels known wrappers and strips the markup from the snippet", () => {
    const d = describeNoisePrompt(
      "<system-reminder>Background task update: done.</system-reminder>",
    );
    expect(d.label).toBe("system reminder");
    expect(d.snippet).toBe("Background task update: done.");
    expect(d.snippet).not.toContain("<");
  });

  it("labels task-notification and IDE wrappers", () => {
    expect(
      describeNoisePrompt("<task-notification>t</task-notification>").label,
    ).toBe("task notification");
    expect(
      describeNoisePrompt("<ide_opened_file>f.ts</ide_opened_file>").label,
    ).toBe("IDE opened a file");
  });

  it("humanises unknown tags and handles caveats", () => {
    expect(
      describeNoisePrompt("<future_wrapper>x</future_wrapper>").label,
    ).toBe("future wrapper");
    const c = describeNoisePrompt("Caveat: the messages below were generated");
    expect(c.label).toBe("caveat");
    expect(c.snippet).toContain("the messages below");
  });
});

describe("humanToolSummary", () => {
  it("summarises a full TodoWrite JSON payload as counts", () => {
    const json = JSON.stringify({
      todos: [
        { content: "a", status: "completed" },
        { content: "b", status: "completed" },
        { content: "c", status: "in_progress" },
        { content: "d", status: "pending" },
        { content: "e", status: "pending" },
      ],
    });
    expect(humanToolSummary("TodoWrite", json)).toBe(
      "5 todos · 2 done · 1 in progress",
    );
  });

  it("summarises a TRUNCATED TodoWrite payload leniently (marked +)", () => {
    const truncated =
      '{"todos":[{"content":"a","status":"completed"},{"content":"b","status":"in_pro…';
    expect(humanToolSummary("TodoWrite", truncated)).toBe("2+ todos · 1 done");
  });

  it("surfaces the first AskUserQuestion question", () => {
    const json = JSON.stringify({
      questions: [
        { question: "Which direction?", options: [] },
        { question: "Second?", options: [] },
      ],
    });
    expect(humanToolSummary("AskUserQuestion", json)).toBe(
      "asked: Which direction?",
    );
    // truncated mid-question still yields the readable prefix
    expect(
      humanToolSummary(
        "AskUserQuestion",
        '{"questions":[{"question":"Which dir…',
      ),
    ).toBe("asked: Which dir…");
  });

  it("passes every other tool's summary through untouched", () => {
    expect(humanToolSummary("Bash", "npm test")).toBe("npm test");
    expect(humanToolSummary("Read", "src/a.ts")).toBe("src/a.ts");
  });

  it("is applied when the ledger is built", () => {
    const m = buildRowModel([
      turn("assistant", [
        toolUse(
          "td",
          "TodoWrite",
          '{"todos":[{"content":"x","status":"pending"}]}',
        ),
      ]),
    ]);
    expect(m.ledger[0].summary).toBe("1 todo");
  });
});

describe("matchesRailFilter", () => {
  it("mirrors filterLedger semantics for a single entry", () => {
    const m = buildRowModel(miniConversation());
    const [read, bash] = m.ledger;
    expect(matchesRailFilter(read, "all")).toBe(true);
    expect(matchesRailFilter(read, "errors")).toBe(false);
    expect(matchesRailFilter(bash, "errors")).toBe(true);
    expect(matchesRailFilter(read, { tool: "Read" })).toBe(true);
    expect(matchesRailFilter(bash, { tool: "Read" })).toBe(false);
  });
});
