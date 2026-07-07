/**
 * sessions-page.test.tsx — render tests for the 3-pane Sessions view.
 *
 * jsdom: EventSource is undefined (SSE no-ops), ResizeObserver is undefined
 * (VirtualList falls back to estimates with an 800px viewport), so small
 * fixtures render fully. Fetch is stubbed per-endpoint below.
 */
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SessionsPage } from "../src/app/pages/SessionsPage";
import { ToolRail } from "../src/app/sessions/ToolRail";
import { buildRowModel } from "../src/app/sessions/rows";
import type { ConversationTurn } from "../src/app/api/sessions";

/* ── fixtures ── */

const NOW = Date.now();
const SESSION_ID = "abc12345-0000-0000-0000-000000000001";

const SESSIONS = [
  {
    id: SESSION_ID,
    startedAt: new Date(NOW - 3600_000).toISOString(),
    lastActivity: new Date(NOW - 30_000).toISOString(), // live (<2min)
    messageCount: 7,
    agentCount: 1,
    gitBranch: "main",
    firstPrompt: "Build the widget please",
    title: "Widget build session",
  },
  {
    id: "abc12345-0000-0000-0000-000000000002",
    startedAt: new Date(NOW - 90 * 3600_000).toISOString(),
    lastActivity: new Date(NOW - 88 * 3600_000).toISOString(),
    messageCount: 3,
    agentCount: 0,
    gitBranch: "main",
    firstPrompt: "Old work",
    title: "Older session",
  },
];

const TREE = {
  sessionId: SESSION_ID,
  root: {
    id: "root",
    parentId: null,
    agentType: "session",
    description: "Build the widget please",
    toolUseId: null,
    spawnDepth: 0,
    status: "running",
    startedAt: SESSIONS[0].startedAt,
    lastActivity: SESSIONS[0].lastActivity,
    messageCount: 7,
    model: "claude-opus-4-8",
  },
  agents: [
    {
      id: "agentA",
      parentId: "root",
      agentType: "developer",
      description: "Implement the widget",
      toolUseId: "spawn1",
      spawnDepth: 1,
      status: "running",
      startedAt: SESSIONS[0].startedAt,
      lastActivity: SESSIONS[0].lastActivity,
      messageCount: 42,
      model: "claude-opus-4-8",
    },
  ],
};

/** Paginated-backend conversation for root. */
const ROOT_CONVO = {
  sessionId: SESSION_ID,
  agentId: "root",
  agentType: "session",
  description: "Build the widget please",
  model: "claude-opus-4-8",
  turns: [
    {
      uuid: "u1",
      role: "user",
      timestamp: new Date(NOW - 3000_000).toISOString(),
      model: null,
      blocks: [
        { kind: "text", text: "Build the widget please", truncated: false },
      ],
    },
    {
      uuid: "u2",
      role: "assistant",
      timestamp: new Date(NOW - 2900_000).toISOString(),
      model: "claude-opus-4-8",
      blocks: [
        { kind: "thinking", text: "plan the build", truncated: false },
        { kind: "text", text: "Starting on the widget.", truncated: false },
      ],
    },
    {
      uuid: "u3",
      role: "assistant",
      timestamp: new Date(NOW - 2800_000).toISOString(),
      model: "claude-opus-4-8",
      blocks: [
        {
          kind: "tool_use",
          toolUseId: "t1",
          name: "Read",
          summary: "src/widget.ts",
        },
      ],
    },
    {
      uuid: "u4",
      role: "user",
      timestamp: new Date(NOW - 2700_000).toISOString(),
      model: null,
      blocks: [
        {
          kind: "tool_result",
          toolUseId: "t1",
          text: "file contents…",
          isError: false,
          truncated: true,
        },
      ],
    },
    {
      uuid: "u5",
      role: "assistant",
      timestamp: new Date(NOW - 2600_000).toISOString(),
      model: "claude-opus-4-8",
      blocks: [
        {
          kind: "tool_use",
          toolUseId: "t2",
          name: "Bash",
          summary: "npm test",
        },
      ],
    },
    {
      uuid: "u6",
      role: "user",
      timestamp: new Date(NOW - 2500_000).toISOString(),
      model: null,
      blocks: [
        {
          kind: "tool_result",
          toolUseId: "t2",
          text: "1 test failed",
          isError: true,
          truncated: false,
        },
      ],
    },
    {
      uuid: "u7",
      role: "assistant",
      timestamp: new Date(NOW - 2400_000).toISOString(),
      model: "claude-opus-4-8",
      blocks: [
        {
          kind: "text",
          text: "Done — one test failed, then fixed.",
          truncated: false,
        },
      ],
    },
    {
      uuid: "u8",
      role: "user",
      timestamp: new Date(NOW - 2300_000).toISOString(),
      model: null,
      blocks: [
        {
          kind: "text",
          text: "<system-reminder>Background lint finished cleanly.</system-reminder>",
          truncated: false,
        },
      ],
    },
  ],
  total: 8,
  hasMore: false,
  oldestUuid: "u1",
};

const AGENT_CONVO = {
  sessionId: SESSION_ID,
  agentId: "agentA",
  agentType: "developer",
  description: "Implement the widget",
  model: "claude-opus-4-8",
  turns: [
    {
      uuid: "a1",
      role: "assistant",
      timestamp: new Date(NOW - 1000_000).toISOString(),
      model: "claude-opus-4-8",
      blocks: [
        { kind: "text", text: "Subagent reporting in.", truncated: false },
      ],
    },
  ],
  total: 250,
  hasMore: true,
  oldestUuid: "a1",
};

function stubSessionsFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      if (url.includes("/tree")) return json(TREE);
      if (url.includes("/agents/root")) return json(ROOT_CONVO);
      if (url.includes("/agents/agentA")) return json(AGENT_CONVO);
      if (url.includes("/search")) {
        return json({
          q: "widget",
          matches: [
            {
              agentId: "root",
              agentLabel: "session",
              turnUuid: "u1",
              role: "user",
              blockType: "text",
              snippet: "Build the widget please",
            },
          ],
          capped: false,
        });
      }
      if (url.includes("/api/sessions")) return json(SESSIONS);
      return json({ error: "not found" }, 404);
    }),
  );
}

/** Pretend the viewport is ≤1100px so the rail runs in drawer mode. */
function stubNarrowViewport() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("1100"),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sessions" element={<SessionsPage />} />
        <Route path="/sessions/:sessionId" element={<SessionsPage />} />
        <Route
          path="/sessions/:sessionId/:agentId"
          element={<SessionsPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ── tests ── */

describe("SessionsPage — 3-pane layout", () => {
  it("renders the nav rail with day-grouped sessions and nested agents", async () => {
    stubSessionsFetch();
    renderAt(`/sessions/${SESSION_ID}/root`);
    // Live session pinned under "Live now"; older one under a day group.
    expect(await screen.findByText("Live now")).toBeInTheDocument();
    expect(screen.getByText("Widget build session")).toBeInTheDocument();
    expect(screen.getByText("Older session")).toBeInTheDocument();
    // The selected session expands: root + subagent rows.
    expect(await screen.findByText("Main session")).toBeInTheDocument();
    expect(screen.getByText("Implement the widget")).toBeInTheDocument();
  });

  it("renders prose rows + ONE collapsed tool-group chip with error badge", async () => {
    stubSessionsFetch();
    renderAt(`/sessions/${SESSION_ID}/root`);
    expect(
      await screen.findByText("Starting on the widget."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Done — one test failed, then fixed."),
    ).toBeInTheDocument();
    // The two tool calls collapse into one chip…
    expect(screen.getByText("2 tool calls")).toBeInTheDocument();
    // …that surfaces the error count in red.
    expect(screen.getByText("1 error")).toBeInTheDocument();
    // Thinking is collapsed (toggle visible, body not rendered).
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    expect(screen.queryByText("plan the build")).not.toBeInTheDocument();
  });

  it("expands thinking on toggle", async () => {
    stubSessionsFetch();
    renderAt(`/sessions/${SESSION_ID}/root`);
    const toggle = await screen.findByText("Thinking");
    fireEvent.click(toggle);
    expect(screen.getByText("plan the build")).toBeInTheDocument();
  });

  it("shows the tool rail ledger with filter pills and error filter", async () => {
    stubSessionsFetch();
    renderAt(`/sessions/${SESSION_ID}/root`);
    expect(await screen.findByText("Tool activity")).toBeInTheDocument();
    // Ledger entries (name + summary).
    expect(screen.getByText("src/widget.ts")).toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
    // Filter pills: All / Read / Bash / Errors.
    const errorsPill = screen.getByRole("button", { name: /Errors/ });
    fireEvent.click(errorsPill);
    expect(screen.queryByText("src/widget.ts")).not.toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
  });

  it("expanding a group chip reveals the individual calls inline", async () => {
    stubSessionsFetch();
    renderAt(`/sessions/${SESSION_ID}/root`);
    await screen.findByText("2 tool calls");
    fireEvent.click(screen.getByRole("button", { name: "Expand tool calls" }));
    // Inline group body lists both calls (rail shows them too — allow dupes).
    expect(screen.getAllByText("src/widget.ts").length).toBeGreaterThan(1);
  });

  it("navigates to a subagent and shows paginated 'load earlier'", async () => {
    stubSessionsFetch();
    renderAt(`/sessions/${SESSION_ID}/agentA`);
    expect(
      await screen.findByText("Subagent reporting in."),
    ).toBeInTheDocument();
    // hasMore → the load-earlier row is present with the remaining count.
    expect(
      screen.getByText(/Load earlier — 249 older turns/),
    ).toBeInTheDocument();
    // Header shows loaded/total.
    expect(screen.getByText(/1 of 250/)).toBeInTheDocument();
  });

  it("auto-routes /sessions to the newest session", async () => {
    stubSessionsFetch();
    renderAt("/sessions");
    // Ends up on the live session's root conversation.
    expect(
      await screen.findByText("Starting on the widget."),
    ).toBeInTheDocument();
  });

  it("deep link ?turn= highlights the target turn", async () => {
    stubSessionsFetch();
    renderAt(`/sessions/${SESSION_ID}/root?turn=u7`);
    const row = (
      await screen.findByText("Done — one test failed, then fixed.")
    ).closest(".sess-row");
    await waitFor(() => {
      expect(row?.className).toContain("is-highlight");
    });
  });

  it("opens search with / and lists matches", async () => {
    stubSessionsFetch();
    renderAt(`/sessions/${SESSION_ID}/root`);
    await screen.findByText("2 tool calls");
    fireEvent.keyDown(window, { key: "/" });
    const input = await screen.findByLabelText("Search query");
    fireEvent.change(input, { target: { value: "widget" } });
    expect(
      await screen.findByText("Build the widget please", {
        selector: ".sess-search-hit-snippet",
      }),
    ).toBeInTheDocument();
  });

  it("t toggles the tool rail closed (reopen tab appears)", async () => {
    stubSessionsFetch();
    renderAt(`/sessions/${SESSION_ID}/root`);
    await screen.findByText("Tool activity");
    fireEvent.keyDown(window, { key: "t" });
    expect(screen.queryByText("Tool activity")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show tool rail" }),
    ).toBeInTheDocument();
  });

  it("shows the empty state when no sessions exist", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify([]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    renderAt("/sessions");
    expect(await screen.findByText("No sessions recorded")).toBeInTheDocument();
  });

  it("j from a tail-open conversation starts at the LAST row, not row 0", async () => {
    stubSessionsFetch();
    renderAt(`/sessions/${SESSION_ID}/root`);
    await screen.findByText("2 tool calls");
    // No cursor yet (opened at the tail) — a REAL dispatched keydown.
    fireEvent.keyDown(window, { key: "j" });
    // Cursor lands on the LAST row (the noise chip turn), not the first.
    const lastRow = screen.getByText("system reminder").closest(".sess-row");
    expect(lastRow?.className).toContain("is-cursor");
    const firstRow = screen
      .getByText("Build the widget please", { selector: ".sess-prompt-text" })
      .closest(".sess-row");
    expect(firstRow?.className).not.toContain("is-cursor");
    // k from the last row then steps UP.
    fireEvent.keyDown(window, { key: "k" });
    expect(lastRow?.className).not.toContain("is-cursor");
    const prevRow = screen
      .getByText("Done — one test failed, then fixed.")
      .closest(".sess-row");
    expect(prevRow?.className).toContain("is-cursor");
  });

  it("timeline seek PRESERVES the active Errors filter", async () => {
    stubSessionsFetch();
    renderAt(`/sessions/${SESSION_ID}/root`);
    await screen.findByText("Tool activity");
    fireEvent.click(screen.getByRole("button", { name: /Errors/ }));
    expect(screen.queryByText("src/widget.ts")).not.toBeInTheDocument();
    // Seek via the mini timeline — the filter must survive.
    fireEvent.click(screen.getByRole("button", { name: "Jump to call 1" }));
    expect(
      screen
        .getByRole("button", { name: /Errors/ })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(screen.queryByText("src/widget.ts")).not.toBeInTheDocument();
    expect(screen.getByText("npm test")).toBeInTheDocument();
  });

  it("keeps a persistent is-marked edge marker on the ?turn target", async () => {
    stubSessionsFetch();
    renderAt(`/sessions/${SESSION_ID}/root?turn=u7`);
    const row = (
      await screen.findByText("Done — one test failed, then fixed.")
    ).closest(".sess-row");
    await waitFor(() => {
      expect(row?.className).toContain("is-marked");
    });
  });

  it("renders injected system markup as a labelled chip, not raw text", async () => {
    stubSessionsFetch();
    renderAt(`/sessions/${SESSION_ID}/root`);
    await screen.findByText("2 tool calls");
    // The wrapper renders as a dim labelled chip with a tag-free snippet…
    expect(screen.getByText("system reminder")).toBeInTheDocument();
    expect(
      screen.getByText("Background lint finished cleanly."),
    ).toBeInTheDocument();
    // …never the raw markup.
    expect(
      screen.queryByText(/<system-reminder>/, { exact: false }),
    ).not.toBeInTheDocument();
    // Expanding the chip reveals the raw payload for inspection.
    fireEvent.click(screen.getByText("system reminder"));
    expect(
      screen.getByText(
        "<system-reminder>Background lint finished cleanly.</system-reminder>",
      ),
    ).toBeInTheDocument();
  });

  it("narrow viewport: the tool rail becomes a drawer that t toggles", async () => {
    stubSessionsFetch();
    stubNarrowViewport();
    renderAt(`/sessions/${SESSION_ID}/root`);
    await screen.findByText("2 tool calls");
    // Rail is NOT in the layout — a floating Tools affordance is.
    expect(screen.queryByText("Tool activity")).not.toBeInTheDocument();
    const fab = screen.getByRole("button", { name: "Show tool rail" });
    expect(fab.className).toContain("sess-drawer-fab");
    // t opens the drawer (dialog) with the full rail inside.
    fireEvent.keyDown(window, { key: "t" });
    const dialog = screen.getByRole("dialog", { name: "Tool activity" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("src/widget.ts")).toBeInTheDocument();
    // Esc closes it again (affordance returns).
    fireEvent.keyDown(window, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Tool activity" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Show tool rail" }),
    ).toBeInTheDocument();
  });

  it("folds >4 tool types behind a +N more pill toggle", () => {
    const names = ["Read", "Edit", "Bash", "Grep", "Glob", "Write"];
    const turns = names.map((name, i): ConversationTurn => ({
      uuid: `pt${i}`,
      role: "assistant",
      timestamp: null,
      model: null,
      blocks: [{ kind: "tool_use", toolUseId: `pid${i}`, name, summary: "" }],
    }));
    const m = buildRowModel(turns);
    render(
      <ToolRail
        sessionId="s"
        ledger={m.ledger}
        toolCounts={m.toolCounts}
        errorCount={0}
        filter="all"
        onFilterChange={() => {}}
        highlightGroupKey={null}
        highlightToolUseId={null}
        expanded={new Set()}
        onToggleExpand={() => {}}
        onJumpToTurn={() => {}}
        onClose={() => {}}
        live={false}
      />,
    );
    const toolbar = () =>
      within(screen.getByRole("toolbar", { name: "Filter tool calls" }));
    expect(
      toolbar().getByRole("button", { name: "+2 more" }),
    ).toBeInTheDocument();
    expect(
      toolbar().queryByRole("button", { name: /Write/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(toolbar().getByRole("button", { name: "+2 more" }));
    expect(
      toolbar().getByRole("button", { name: /Write/ }),
    ).toBeInTheDocument();
    fireEvent.click(toolbar().getByRole("button", { name: "less" }));
    expect(
      toolbar().queryByRole("button", { name: /Write/ }),
    ).not.toBeInTheDocument();
  });

  it("tolerates the legacy (pre-pagination) conversation shape", async () => {
    const legacy = {
      sessionId: SESSION_ID,
      agentId: "root",
      agentType: "session",
      description: null,
      turns: ROOT_CONVO.turns,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const json = (body: unknown) =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        if (url.includes("/tree")) return json(TREE);
        if (url.includes("/agents/root")) return json(legacy);
        if (url.includes("/api/sessions")) return json(SESSIONS);
        return new Response("nf", { status: 404 });
      }),
    );
    renderAt(`/sessions/${SESSION_ID}/root`);
    expect(
      await screen.findByText("Starting on the widget."),
    ).toBeInTheDocument();
    // No pagination fields → everything loaded, no load-earlier row.
    expect(screen.queryByText(/Load earlier/)).not.toBeInTheDocument();
    expect(screen.getByText(/8 turns/)).toBeInTheDocument();
  });
});
