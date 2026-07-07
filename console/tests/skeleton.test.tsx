/**
 * skeleton.test.tsx — §5.2 empty/loading consistency (TASK-106).
 *
 * Covers the Skeleton primitives, the promoted useLastReady hook (pages/lib),
 * and the first-load-vs-refetch rule on a page that adopted it (StatusPage:
 * skeleton on first load; last data kept when a refetch is in flight).
 */

import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

import {
  SkeletonGroup,
  SkeletonLine,
  SkeletonCard,
  SkeletonTile,
} from "../src/app/components/Skeleton";
import { useLastReady } from "../src/app/pages/lib";
import { StatusPage } from "../src/app/pages/StatusPage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ── Skeleton primitives ───────────────────────────────────────────── */

describe("Skeleton primitives", () => {
  it("SkeletonGroup announces once; the ghosts are aria-hidden", () => {
    const { container } = render(
      <SkeletonGroup label="Loading things">
        <SkeletonLine />
        <SkeletonCard lines={2} />
        <SkeletonTile />
      </SkeletonGroup>,
    );
    const group = screen.getByRole("status");
    expect(group).toHaveAttribute("aria-busy", "true");
    expect(group.textContent).toContain("Loading things");
    // Every top-level ghost shape is decoration (the label span excepted).
    const shapes = Array.from(
      container.querySelector(".skeleton-group")!.children,
    ).filter((el) => !el.classList.contains("sr-only"));
    expect(shapes.length).toBe(3);
    for (const el of shapes) {
      expect(el).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("SkeletonCard renders a title bar plus N body lines", () => {
    const { container } = render(<SkeletonCard lines={4} />);
    expect(container.querySelectorAll(".skeleton-line")).toHaveLength(5); // title + 4
  });
});

/* ── useLastReady ──────────────────────────────────────────────────── */

function Probe({ phase, data }: { phase: string; data: string | undefined }) {
  const value = useLastReady(phase, data);
  return <span data-testid="value">{value ?? "(none)"}</span>;
}

describe("useLastReady (promoted to pages/lib — §5.2)", () => {
  it("returns undefined before the first ready", () => {
    render(<Probe phase="loading" data={undefined} />);
    expect(screen.getByTestId("value").textContent).toBe("(none)");
  });

  it("keeps the last ready value through a refetch loading dip", () => {
    const { rerender } = render(<Probe phase="ready" data="first" />);
    expect(screen.getByTestId("value").textContent).toBe("first");

    // SSE-triggered refetch: phase flips to loading, data goes undefined.
    rerender(<Probe phase="loading" data={undefined} />);
    expect(screen.getByTestId("value").textContent).toBe("first");

    // New data lands.
    rerender(<Probe phase="ready" data="second" />);
    expect(screen.getByTestId("value").textContent).toBe("second");

    // A refetch ERROR also keeps the last good value on screen.
    rerender(<Probe phase="error" data={undefined} />);
    expect(screen.getByTestId("value").textContent).toBe("second");
  });
});

/* ── First-load rule on an adopting page ───────────────────────────── */

describe("StatusPage first-load skeleton (§5.2 rule)", () => {
  it("shows the skeleton while the first fetch is pending, then the doc", async () => {
    let release!: (v: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => gate),
    );

    const { container } = render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>,
    );

    // First load → skeleton (role=status group with ghost cards), no doc yet.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(container.querySelector(".skeleton-card")).not.toBeNull();

    release(
      new Response(
        JSON.stringify({
          key: "status",
          exists: true,
          markdown: "## Goal\n\nShip.",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    expect(await screen.findByText("Ship.")).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector(".skeleton-card")).toBeNull(),
    );
  });
});
