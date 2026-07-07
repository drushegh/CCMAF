/**
 * docpage.test.tsx — the shared DocPage pattern (Console v2 §5.1, TASK-106).
 *
 * Covers: fence-aware h2/h3 sectioning + slug dedupe (pure), the meta-row
 * helpers (timeAgo / formatBytes), the composed DocPage render (section cards,
 * collapse toggle + sessionStorage persistence, TOC rail, meta row), and the
 * DecisionsPage rail adoption (default-collapse beyond the newest 10).
 *
 * jsdom has no IntersectionObserver — the scroll-spy is feature-detected and
 * stays inert here; these tests exercise structure and collapse behaviour.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

import {
  splitMarkdownSections,
  splitToToc,
  timeAgo,
  formatBytes,
  byteLength,
  DocPage,
} from "../src/app/components/DocPage";
import { StatusPage } from "../src/app/pages/StatusPage";
import { DecisionsPage } from "../src/app/pages/DecisionsPage";

function renderPage(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

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

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ── splitMarkdownSections ─────────────────────────────────────────── */

describe("splitMarkdownSections", () => {
  it("splits h2 sections and keeps pre-h2 content as preamble", () => {
    const md =
      "# Title\n\nIntro text.\n\n## First\n\nBody A.\n\n## Second\n\nBody B.";
    const split = splitMarkdownSections(md, "t");
    expect(split.preamble).toContain("# Title");
    expect(split.preamble).toContain("Intro text.");
    expect(split.sections.map((s) => s.title)).toEqual(["First", "Second"]);
    expect(split.sections[0].body).toBe("Body A.");
    expect(split.sections[1].body).toBe("Body B.");
  });

  it("collects h3s inside their owning section (and leaves them in the body)", () => {
    const md = "## Sec\n\n### Sub one\n\ntext\n\n### Sub two\n\nmore";
    const split = splitMarkdownSections(md, "t");
    expect(split.sections).toHaveLength(1);
    expect(split.sections[0].h3s.map((h) => h.title)).toEqual([
      "Sub one",
      "Sub two",
    ]);
    expect(split.sections[0].body).toContain("### Sub one");
  });

  it("ignores ## / ### lines inside fenced code blocks", () => {
    const md = [
      "## Real",
      "",
      "```bash",
      "## not a heading",
      "### neither",
      "```",
      "",
      "## Also real",
    ].join("\n");
    const split = splitMarkdownSections(md, "t");
    expect(split.sections.map((s) => s.title)).toEqual(["Real", "Also real"]);
    expect(split.sections[0].body).toContain("## not a heading");
    expect(split.sections[0].h3s).toHaveLength(0);
  });

  it("de-duplicates repeated heading slugs and prefixes ids", () => {
    const md = "## Notes\n\na\n\n## Notes\n\nb";
    const split = splitMarkdownSections(md, "status");
    expect(split.sections[0].id).toBe("status--notes");
    expect(split.sections[1].id).toBe("status--notes-2");
  });

  it("strips inline markdown from heading titles", () => {
    const md = "## `code` and **bold** and [link](http://x)";
    const split = splitMarkdownSections(md, "t");
    expect(split.sections[0].title).toBe("code and bold and link");
  });

  it("builds a flat TOC with h2/h3 levels in document order", () => {
    const md = "## A\n\n### A1\n\n## B";
    const toc = splitToToc(splitMarkdownSections(md, "t"));
    expect(toc.map((e) => [e.title, e.level])).toEqual([
      ["A", 2],
      ["A1", 3],
      ["B", 2],
    ]);
  });
});

/* ── Meta helpers ──────────────────────────────────────────────────── */

describe("meta-row helpers", () => {
  it("timeAgo covers the ladder", () => {
    const now = Date.parse("2026-07-07T12:00:00Z");
    expect(timeAgo(now - 10_000, now)).toBe("just now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe("2d ago");
    expect(timeAgo(Date.parse("2026-01-01T00:00:00Z"), now)).toBe("2026-01-01");
  });

  it("formatBytes picks sensible units", () => {
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(12_700)).toBe("12.4 KB");
    expect(formatBytes(1_300_000)).toBe("1.2 MB");
  });

  it("byteLength counts UTF-8 bytes, not JS chars", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("é")).toBe(2);
  });
});

/* ── DocPage render ────────────────────────────────────────────────── */

const DOC_MD = [
  "# Status",
  "",
  "Overview paragraph.",
  "",
  "## Active Work",
  "",
  "Working on TASK-106.",
  "",
  "### Detail",
  "",
  "sub detail",
  "",
  "## Blockers",
  "",
  "None.",
].join("\n");

describe("DocPage (§5.1)", () => {
  it("renders h2 sections as expanded cards with a TOC rail and meta row", () => {
    const { container } = renderPage(
      <DocPage
        markdown={DOC_MD}
        file="STATUS.md"
        mtimeMs={Date.now()}
        page="t-status"
      />,
    );

    // Section cards, default expanded.
    const cards = container.querySelectorAll(".docpage-card");
    expect(cards).toHaveLength(2);
    expect(screen.getByText("Working on TASK-106.")).toBeVisible();

    // TOC rail lists h2s and the nested h3.
    const toc = container.querySelector(".docpage-toc") as HTMLElement;
    expect(toc).not.toBeNull();
    expect(toc.textContent).toContain("Active Work");
    expect(toc.textContent).toContain("Detail");
    expect(toc.textContent).toContain("Blockers");

    // Meta row: ago + bytes + file badge.
    const meta = container.querySelector(".docpage-meta") as HTMLElement;
    expect(meta.textContent).toContain("Last updated just now");
    expect(meta.textContent).toContain("STATUS.md");
    expect(meta.textContent).toMatch(/\d+ B|\d+(\.\d+)? KB/);

    // Preamble (pre-h2 content) renders outside the cards.
    expect(screen.getByText("Overview paragraph.")).toBeInTheDocument();
  });

  it("collapses a section on toggle and persists per page in sessionStorage", () => {
    const { container, unmount } = renderPage(
      <DocPage markdown={DOC_MD} file="STATUS.md" page="t-collapse" />,
    );

    // NB: the TOC rail also carries an "Active Work" button — target the
    // card's own toggle by class.
    const toggle = container.querySelector(
      "#t-collapse--active-work .docpage-card-toggle",
    ) as HTMLElement;
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    // Body is hidden, not unmounted (anchor ids keep existing).
    const body = container.querySelector(
      "#t-collapse--active-work-body",
    ) as HTMLElement;
    expect(body.hidden).toBe(true);

    // Remount (same tab): the collapsed override is restored from sessionStorage.
    unmount();
    const second = renderPage(
      <DocPage markdown={DOC_MD} file="STATUS.md" page="t-collapse" />,
    );
    expect(
      second.container.querySelector(
        "#t-collapse--active-work .docpage-card-toggle",
      ),
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("renders a doc with no h2s as preamble only (no rail, no cards)", () => {
    const { container } = renderPage(
      <DocPage
        markdown={"# Only Title\n\nJust text."}
        file="X.md"
        page="t-plain"
      />,
    );
    expect(container.querySelector(".docpage-card")).toBeNull();
    expect(container.querySelector(".docpage-toc")).toBeNull();
    expect(screen.getByText("Just text.")).toBeInTheDocument();
  });

  it("assigns h3 anchor ids inside section bodies", () => {
    const { container } = renderPage(
      <DocPage markdown={DOC_MD} file="STATUS.md" page="t-anchors" />,
    );
    expect(container.querySelector("h3#t-anchors--detail")).not.toBeNull();
  });
});

/* ── StatusPage integration (mtimeMs plumbed through the StateDoc) ─── */

describe("StatusPage — DocPage integration", () => {
  it("renders STATUS.md through the DocPage pattern with the meta row", async () => {
    stubFetch({
      "/api/statedoc/status": {
        key: "status",
        exists: true,
        markdown: "## Sprint Goal\n\nShip §5.",
        mtimeMs: Date.now() - 5 * 60_000,
      },
    });
    const { container } = renderPage(<StatusPage />);
    expect(await screen.findByText("Ship §5.")).toBeInTheDocument();
    expect(container.querySelector(".docpage-card")).not.toBeNull();
    expect(container.querySelector(".docpage-meta")?.textContent).toContain(
      "Last updated 5m ago",
    );
  });
});

/* ── DecisionsPage rail adoption (§5.1) ────────────────────────────── */

describe("DecisionsPage — rail + default-collapse beyond newest 10", () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({
    id: `DEC-${String(120 - i).padStart(3, "0")}`, // newest first, like the API
    date: "2026-07-01",
    status: "active",
    title: `Decision ${120 - i}`,
    body: `Body of decision ${120 - i}.`,
  }));

  beforeEach(() => stubFetch({ "/api/decisions": entries }));

  it("expands the newest 10 and collapses the rest by default", async () => {
    const { container } = renderPage(<DecisionsPage />);
    await screen.findByText("Decision 120");

    // Newest entry: expanded.
    expect(screen.getByText("Body of decision 120.")).toBeVisible();

    // 11th and 12th entries: bodies hidden by default.
    const eleventh = container.querySelector(
      "#dec-DEC-110-body",
    ) as HTMLElement;
    const twelfth = container.querySelector("#dec-DEC-109-body") as HTMLElement;
    expect(eleventh.hidden).toBe(true);
    expect(twelfth.hidden).toBe(true);

    // The card's own toggle expands a collapsed entry (the TOC rail carries a
    // same-named button, so target by structure).
    fireEvent.click(
      container.querySelector(
        "#dec-DEC-109 .decision-card-toggle",
      ) as HTMLElement,
    );
    expect(
      (container.querySelector("#dec-DEC-109-body") as HTMLElement).hidden,
    ).toBe(false);
  });

  it("lists every entry in the TOC rail", async () => {
    const { container } = renderPage(<DecisionsPage />);
    await screen.findByText("Decision 120");
    const toc = container.querySelector(".docpage-toc") as HTMLElement;
    expect(toc.querySelectorAll(".docpage-toc-item")).toHaveLength(12);
    expect(toc.textContent).toContain("DEC-109 — Decision 109");
  });
});
