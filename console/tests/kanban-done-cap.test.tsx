/**
 * kanban-done-cap.test.tsx — Done-lane cap (Console v2 §5.6, TASK-106).
 *
 * Done is an archive: the column caps at the NEWEST 25 full cards with a
 * terminal "Show all N →" card; expanding reveals the older entries as plain
 * text rows (no per-card buttons). Covers the pure split helper and the
 * KanbanPage integration in both lanes.
 */

import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { splitDoneItems, KanbanPage } from "../src/app/pages/KanbanPage";

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const key = Object.keys(routes).find((k) => url.includes(k));
      if (!key) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify(routes[key]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ── splitDoneItems (pure) ─────────────────────────────────────────── */

describe("splitDoneItems", () => {
  const make = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `TASK-${i + 1}` }));

  it("passes small columns through untouched", () => {
    const items = make(25);
    const { cards, overflow } = splitDoneItems(items);
    expect(cards).toHaveLength(25);
    expect(overflow).toHaveLength(0);
  });

  it("caps at the 25 newest by numeric id, preserving display order", () => {
    const items = make(30); // TASK-1 … TASK-30 in ascending display order
    const { cards, overflow } = splitDoneItems(items);
    expect(cards).toHaveLength(25);
    expect(overflow.map((t) => t.id)).toEqual([
      "TASK-1",
      "TASK-2",
      "TASK-3",
      "TASK-4",
      "TASK-5",
    ]);
    // Cards keep the caller's order (TASK-6 first here, not TASK-30).
    expect(cards[0].id).toBe("TASK-6");
    expect(cards[24].id).toBe("TASK-30");
  });
});

/* ── KanbanPage integration ────────────────────────────────────────── */

const doneItems = Array.from({ length: 30 }, (_, i) => ({
  id: `TASK-${i + 1}`,
  title: `Finished thing ${i + 1}`,
  status: "Done",
  lane: "feature",
}));

const board = {
  columns: [
    {
      status: "In Progress",
      lane: "feature",
      items: [
        {
          id: "TASK-900",
          title: "Current work",
          status: "In Progress",
          lane: "feature",
        },
      ],
    },
    { status: "Done", lane: "feature", items: doneItems },
  ],
};

describe("KanbanPage — Done column cap (§5.6)", () => {
  beforeEach(() => stubFetch({ "/api/tasks": board }));

  it("renders 25 newest Done cards plus a terminal Show-all card", async () => {
    render(
      <MemoryRouter>
        <KanbanPage />
      </MemoryRouter>,
    );
    await screen.findByText("Current work");

    // Newest-by-id (TASK-6…TASK-30) are full cards; older ones are not.
    expect(screen.getByTestId("task-card-TASK-30")).toBeInTheDocument();
    expect(screen.getByTestId("task-card-TASK-6")).toBeInTheDocument();
    expect(screen.queryByTestId("task-card-TASK-5")).toBeNull();

    // The column count stays honest (all 30), and the terminal card names it.
    const showAll = screen.getByRole("button", { name: /Show all 30/ });
    expect(showAll).toBeInTheDocument();

    // Non-Done columns are never capped.
    expect(screen.getByTestId("task-card-TASK-900")).toBeInTheDocument();
  });

  it("expands in place to plain text rows without per-card buttons", async () => {
    render(
      <MemoryRouter>
        <KanbanPage />
      </MemoryRouter>,
    );
    await screen.findByText("Current work");

    fireEvent.click(screen.getByRole("button", { name: /Show all 30/ }));

    // Older entries appear as plain rows…
    const row = screen.getByTestId("task-row-TASK-5");
    expect(row).toHaveTextContent("TASK-5");
    expect(row).toHaveTextContent("Finished thing 5");
    // …with no interactive chrome (no detail button, no link, no button).
    expect(within(row).queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("open-detail-TASK-5")).toBeNull();
    // The terminal card is consumed by the expansion.
    expect(screen.queryByRole("button", { name: /Show all 30/ })).toBeNull();
    // Full cards are still full cards.
    expect(screen.getByTestId("task-card-TASK-30")).toBeInTheDocument();
  });
});
