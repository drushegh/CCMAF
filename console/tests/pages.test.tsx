import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { KanbanPage } from "../src/app/pages/KanbanPage";
import { ContractsPage } from "../src/app/pages/ContractsPage";
import { DecisionsPage } from "../src/app/pages/DecisionsPage";
import { ReadmePage, readmeImgSrc, readmeFigureSrc } from "../src/app/pages/ReadmePage";
import { ReadmeMarkdown } from "../src/app/pages/lib";
import { SpecPage } from "../src/app/pages/SpecPage";
import { DashboardPage } from "../src/app/pages/DashboardPage";

/**
 * Stub the global fetch so the read-only pages resolve against canned JSON.
 * `routes` maps a URL substring -> the JSON body that endpoint returns.
 */
function stubFetch(routes: Record<string, unknown>) {
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify(routes[key]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

function renderPage(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readmeImgSrc (README inline-image resolution)", () => {
  it("rewrites a repo-relative docs image to the confined raw endpoint", () => {
    expect(readmeImgSrc("01_Project/docs/diagrams/architecture.drawio.svg")).toBe(
      "/api/docs/raw?path=diagrams%2Farchitecture.drawio.svg"
    );
  });

  it("tolerates a leading ./ on the docs path", () => {
    expect(readmeImgSrc("./01_Project/docs/diagrams/handback-loop.drawio.svg")).toBe(
      "/api/docs/raw?path=diagrams%2Fhandback-loop.drawio.svg"
    );
  });

  it("passes through absolute, data and root-relative URLs untouched", () => {
    expect(readmeImgSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(readmeImgSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(readmeImgSrc("/already/served.svg")).toBe("/already/served.svg");
  });

  it("routes other repo-relative images to the confined README asset endpoint (BUG-015)", () => {
    expect(readmeImgSrc("some/other/path.png")).toBe(
      "/api/readme/asset?path=some%2Fother%2Fpath.png"
    );
    expect(readmeImgSrc(".github/assets/hero.webp")).toBe(
      "/api/readme/asset?path=.github%2Fassets%2Fhero.webp"
    );
  });
});

describe("readmeFigureSrc (raw centered-figure src validation, BUG-015)", () => {
  it("allows http(s) absolutes and repo-relative paths", () => {
    expect(readmeFigureSrc("https://example.com/a.webp")).toBe("https://example.com/a.webp");
    expect(readmeFigureSrc(".github/assets/hero.webp")).toBe(
      "/api/readme/asset?path=.github%2Fassets%2Fhero.webp"
    );
    expect(readmeFigureSrc("01_Project/docs/diagrams/x.svg")).toBe(
      "/api/docs/raw?path=diagrams%2Fx.svg"
    );
  });

  it("REJECTS dangerous / odd schemes (returns null → figure dropped)", () => {
    expect(readmeFigureSrc("javascript:alert(1)")).toBeNull();
    expect(readmeFigureSrc("data:text/html;base64,PHN2Zz4=")).toBeNull();
    expect(readmeFigureSrc("vbscript:msgbox(1)")).toBeNull();
    expect(readmeFigureSrc("file:///etc/passwd")).toBeNull();
    expect(readmeFigureSrc("//evil.example/x.png")).toBeNull();
    expect(readmeFigureSrc("  ")).toBeNull();
  });
});

describe("ReadmeMarkdown — centered figures (BUG-015)", () => {
  const center = (img: string) => `# Title\n\n<p align="center">\n  ${img}\n</p>\n\nAfter.`;

  it("renders the GitHub centered-image idiom as a figure with a rewritten src", () => {
    const md = center('<img src=".github/assets/hero.webp" width="850" alt="Hero shot" />');
    const { container } = renderPage(
      <ReadmeMarkdown source={md} transformImgSrc={readmeImgSrc} resolveFigureSrc={readmeFigureSrc} />
    );
    const fig = container.querySelector(".readme-figure img") as HTMLImageElement | null;
    expect(fig).not.toBeNull();
    expect(fig!.getAttribute("src")).toBe("/api/readme/asset?path=.github%2Fassets%2Fhero.webp");
    expect(fig!.getAttribute("width")).toBe("850");
    expect(fig!.getAttribute("alt")).toBe("Hero shot");
    // The raw <p align="center"> markup is NOT shown as escaped text.
    expect(container.querySelector(".markdown-body")?.innerHTML).not.toContain("&lt;p align");
  });

  it("DROPS a centered figure with a javascript: src (no img, no raw text, XSS-safe)", () => {
    const md = center('<img src="javascript:alert(1)" alt="x" />');
    const { container } = renderPage(
      <ReadmeMarkdown source={md} transformImgSrc={readmeImgSrc} resolveFigureSrc={readmeFigureSrc} />
    );
    const body = container.querySelector(".markdown-body") as HTMLElement;
    expect(body.querySelector("img")).toBeNull(); // figure dropped entirely
    expect(body.innerHTML).not.toContain("javascript:");
    expect(body.innerHTML).not.toContain("&lt;img"); // not left as raw text either
  });

  it("does NOT execute a <script> embedded in the README (html:false baseline holds)", () => {
    const md = "Intro\n\n<script>window.__readmePwned = true;</script>\n\nEnd.";
    const { container } = renderPage(
      <ReadmeMarkdown source={md} transformImgSrc={readmeImgSrc} resolveFigureSrc={readmeFigureSrc} />
    );
    expect(container.querySelector(".markdown-body script")).toBeNull();
    expect((window as unknown as { __readmePwned?: boolean }).__readmePwned).toBeUndefined();
    // Escaped, shown verbatim — proves it was inert, not silently stripped.
    expect(container.querySelector(".markdown-body")?.innerHTML).toContain("&lt;script&gt;");
  });

  it("ignores a non-numeric width (keeps the figure, drops the bad attr)", () => {
    const md = center('<img src="https://x.test/a.png" width="850;evil" alt="A" />');
    const { container } = renderPage(
      <ReadmeMarkdown source={md} transformImgSrc={readmeImgSrc} resolveFigureSrc={readmeFigureSrc} />
    );
    const fig = container.querySelector(".readme-figure img") as HTMLImageElement | null;
    expect(fig).not.toBeNull();
    expect(fig!.hasAttribute("width")).toBe(false);
    expect(fig!.getAttribute("src")).toBe("https://x.test/a.png");
  });
});

describe("KanbanPage", () => {
  const board = {
    columns: [
      {
        status: "In Progress",
        lane: "feature",
        items: [{ id: "TASK-001", title: "Scaffold the app", status: "In Progress", lane: "feature" }],
      },
      {
        status: "Ready for Test",
        lane: "feature",
        items: [{ id: "TASK-006", title: "Read-only pages", status: "Ready for Test", lane: "feature" }],
      },
      {
        status: "Done",
        lane: "feature",
        items: [{ id: "TASK-002", title: "Server", status: "Done", lane: "feature" }],
      },
      {
        status: "Reported",
        lane: "bug",
        items: [{ id: "BUG-001", title: "A bug", status: "Reported", lane: "bug" }],
      },
    ],
  };

  beforeEach(() => stubFetch({ "/api/tasks": board }));

  it("groups tasks into columns by status", async () => {
    renderPage(<KanbanPage />);

    // Each status appears as a column header.
    expect(await screen.findByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Ready for Test")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();

    // The In-Progress task sits under its own column, not elsewhere.
    const inProgressHeader = screen.getByText("In Progress").closest(".kanban-column");
    expect(inProgressHeader).not.toBeNull();
    expect(within(inProgressHeader as HTMLElement).getByText("TASK-001")).toBeInTheDocument();
  });

  it("shows lane tabs and switches to the bug lane", async () => {
    renderPage(<KanbanPage />);
    // Both lane tabs render; Feature is the default — its cards show, the bug
    // card stays hidden until its tab is selected.
    expect(await screen.findByRole("tab", { name: /Feature Lane/i })).toBeInTheDocument();
    expect(screen.getByText("TASK-001")).toBeInTheDocument();
    expect(screen.queryByText("BUG-001")).toBeNull();

    // Switch to the Bug-Fix lane → the bug card appears.
    fireEvent.click(screen.getByRole("tab", { name: /Bug-Fix Lane/i }));
    expect(await screen.findByText("BUG-001")).toBeInTheDocument();
  });

  it("links Ready-for-Test cards to /verify/:task", async () => {
    renderPage(<KanbanPage />);
    const link = await screen.findByRole("link", { name: /Verify TASK-006/i });
    expect(link).toHaveAttribute("href", "/verify/TASK-006");
  });

  it("does NOT link non-verifiable cards", async () => {
    renderPage(<KanbanPage />);
    await screen.findByText("TASK-001");
    expect(screen.queryByRole("link", { name: /TASK-001/i })).toBeNull();
  });
});

describe("ContractsPage", () => {
  const contracts = [
    { id: "console-http-api", status: "stable", title: "HTTP surface" },
    { id: "draft-thing", status: "draft", title: "A draft contract" },
  ];

  beforeEach(() => stubFetch({ "/api/contracts": contracts }));

  it("shows a status badge for each contract", async () => {
    renderPage(<ContractsPage />);

    const stableId = await screen.findByText("console-http-api");
    const stableRow = stableId.closest(".contract-row") as HTMLElement;
    expect(within(stableRow).getByText("stable")).toBeInTheDocument();
    expect(stableRow.querySelector(".contract-status-badge--stable")).not.toBeNull();

    const draftRow = screen.getByText("draft-thing").closest(".contract-row") as HTMLElement;
    expect(within(draftRow).getByText("draft")).toBeInTheDocument();
    expect(draftRow.querySelector(".contract-status-badge--draft")).not.toBeNull();
  });

  it("counts stable vs draft", async () => {
    renderPage(<ContractsPage />);
    const stableChip = (await screen.findByText("Stable")).closest(".contracts-count-chip") as HTMLElement;
    expect(within(stableChip).getByText("1")).toBeInTheDocument();
  });

  it("renders an empty state when there are no contracts", async () => {
    stubFetch({ "/api/contracts": [] });
    renderPage(<ContractsPage />);
    expect(await screen.findByText("No contracts found")).toBeInTheDocument();
  });

  it("filters the list when a counter is clicked, and toggles off when clicked again (BUG-014)", async () => {
    const { container } = renderPage(<ContractsPage />);
    await screen.findByText("console-http-api");

    // Both contracts visible initially.
    expect(container.querySelectorAll(".contract-row")).toHaveLength(2);

    const draftChip = screen
      .getByText("Draft")
      .closest(".contracts-count-chip") as HTMLElement;

    // Click Draft → only the draft contract remains; the chip is pressed.
    fireEvent.click(draftChip);
    const rowsAfter = container.querySelectorAll(".contract-row");
    expect(rowsAfter).toHaveLength(1);
    expect(within(rowsAfter[0] as HTMLElement).getByText("draft-thing")).toBeInTheDocument();
    expect(draftChip.getAttribute("aria-pressed")).toBe("true");
    expect(draftChip.classList.contains("is-active")).toBe(true);

    // Click Draft again → filter clears, both rows back.
    fireEvent.click(draftChip);
    expect(container.querySelectorAll(".contract-row")).toHaveLength(2);
    expect(draftChip.getAttribute("aria-pressed")).toBe("false");
  });

  it("switches the active filter when the other counter is clicked", async () => {
    const { container } = renderPage(<ContractsPage />);
    await screen.findByText("console-http-api");

    const stableChip = screen.getByText("Stable").closest(".contracts-count-chip") as HTMLElement;
    const draftChip = screen.getByText("Draft").closest(".contracts-count-chip") as HTMLElement;

    fireEvent.click(draftChip);
    expect(draftChip.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(stableChip);
    // Single-select: stable now active, draft cleared, only the stable row shows.
    expect(stableChip.getAttribute("aria-pressed")).toBe("true");
    expect(draftChip.getAttribute("aria-pressed")).toBe("false");
    const rows = container.querySelectorAll(".contract-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0] as HTMLElement).getByText("console-http-api")).toBeInTheDocument();
  });
});

describe("DecisionsPage — markdown rendering + sanitization", () => {
  it("renders decision body markdown to HTML", async () => {
    stubFetch({
      "/api/decisions": [
        {
          id: "DEC-001",
          date: "2026-06-23",
          status: "active",
          title: "A decision",
          body: "**Decision:** do the **bold** thing.",
        },
      ],
    });
    const { container } = renderPage(<DecisionsPage />);
    await screen.findByText("A decision");
    // Markdown emphasis becomes real <strong> elements.
    const strongs = container.querySelectorAll(".markdown-body strong");
    expect(strongs.length).toBeGreaterThanOrEqual(2);
    expect(Array.from(strongs).some((s) => s.textContent === "bold")).toBe(true);
  });

  it("does NOT execute or emit a <script> embedded in markdown (XSS-safe)", async () => {
    const exploit = "Intro\n\n<script>window.__pwned = true;</script>\n\nAfter.";
    stubFetch({
      "/api/decisions": [
        { id: "DEC-XSS", date: "2026-06-23", status: "active", title: "XSS attempt", body: exploit },
      ],
    });
    const { container } = renderPage(<DecisionsPage />);
    await screen.findByText("XSS attempt");

    // No live <script> node was injected into the rendered markdown.
    expect(container.querySelector(".markdown-body script")).toBeNull();
    // The global side-effect never ran.
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    // The raw text is escaped and shown verbatim (proves it was inert, not stripped silently).
    expect(container.querySelector(".markdown-body")?.innerHTML).toContain("&lt;script&gt;");
  });
});

describe("ReadmePage", () => {
  it("renders markdown when README exists", async () => {
    stubFetch({ "/api/readme": { exists: true, markdown: "# Project Title\n\nHello." } });
    const { container } = renderPage(<ReadmePage />);
    await waitFor(() => expect(container.querySelector(".markdown-body h1")).not.toBeNull());
    expect(container.querySelector(".markdown-body h1")?.textContent).toBe("Project Title");
  });

  it("shows a graceful empty state when README is absent", async () => {
    stubFetch({ "/api/readme": { exists: false, markdown: "" } });
    renderPage(<ReadmePage />);
    expect(await screen.findByText("No README.md found")).toBeInTheDocument();
  });
});

describe("SpecPage", () => {
  const specList = [
    { name: "console-spec.md" },
    { name: "tasks-spec.md" },
  ];

  function stubSpecFetch(list = specList, content = "# Console Spec\n\nSpec content here.") {
    const routes: Record<string, unknown> = { "/api/specs": list };
    for (const s of list) {
      routes[`/api/specs/${s.name}`] = { name: s.name, markdown: content };
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const key = Object.keys(routes).find((k) => url.endsWith(k));
        if (!key) return new Response("not found", { status: 404 });
        return new Response(JSON.stringify(routes[key]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
  }

  it("renders the spec sidebar with all spec names", async () => {
    stubSpecFetch();
    renderPage(<SpecPage />);
    expect(await screen.findByText("console-spec.md")).toBeInTheDocument();
    expect(screen.getByText("tasks-spec.md")).toBeInTheDocument();
  });

  it("auto-selects the first spec on load and renders its content", async () => {
    stubSpecFetch();
    const { container } = renderPage(<SpecPage />);
    // Wait for sidebar to appear
    await screen.findByText("console-spec.md");
    // First item should be active
    const firstBtn = screen.getByRole("button", { name: /console-spec\.md/i });
    expect(firstBtn.className).toContain("is-active");
    // Content renders the spec markdown
    await waitFor(() =>
      expect(container.querySelector(".markdown-body h1")?.textContent).toBe("Console Spec"),
    );
  });

  it("selecting a different sidebar item renders its content", async () => {
    stubSpecFetch(specList, "# Tasks Spec\n\nContent of the tasks spec.");
    const { container } = renderPage(<SpecPage />);
    // Wait for sidebar
    await screen.findByText("tasks-spec.md");
    // Click the second item
    fireEvent.click(screen.getByRole("button", { name: /tasks-spec\.md/i }));
    await waitFor(() =>
      expect(container.querySelector(".markdown-body h1")?.textContent).toBe("Tasks Spec"),
    );
    expect(
      screen.getByRole("button", { name: /tasks-spec\.md/i }).className,
    ).toContain("is-active");
  });

  it("shows the empty state when the spec list is empty", async () => {
    stubSpecFetch([]);
    renderPage(<SpecPage />);
    expect(await screen.findByText("No spec documents found")).toBeInTheDocument();
  });
});

describe("DashboardPage — TASK-025 analytics cards render", () => {
  const dashboardData = {
    handbackQueue: [],
    taskCounts: [
      { lane: "feature", status: "In Progress", n: 1 },
      { lane: "feature", status: "Done", n: 3 },
    ],
    contractCounts: [
      { status: "stable", n: 4 },
      { status: "draft", n: 1 },
    ],
    latestDecisions: [
      { id: "DEC-001", date: "2026-06-23", status: "active", title: "No-state-projection", body: "" },
    ],
    currentSpec: null,
    sprintGoal: null,
  };

  const telemetryData = {
    generated_at: "2026-06-23T20:00:00Z",
    total_events: 41,
    by_hook: {
      "cost-tracker": { total: 3, outcomes: { "session-end": 3 } },
    },
    drift_triggers: { "no-task-claimed": 1 },
    sessions: 1,
    by_session: {
      "abc-123": { total: 41, blocked: 0, flagged: 3, drift_fires: 1 },
    },
    lastSession: { toolUses: 52, transcriptLines: 342, sessionId: "abc-123" },
  };

  const findingsData = {
    review: { latestVerdict: "APPROVE", openCriticals: 0 },
    test: { lastRun: "2026-06-24", pass: 377, fail: 0 },
  };

  const gotchasData = [
    { title: "SSE stub closes stream", category: "Technology", confidence: "Verified", count: 1, firstSeen: "2026-06-23" },
  ];

  const frameworkData = {
    version: "1.2.3",
    updateAvailable: false,
    healthcheckLastRun: null,
    doctorClean: true,
  };

  const suggestionsData = [
    { id: "FS-001", title: "Clone ships artefacts" },
    { id: "FS-002", title: "code-conventions overwritten" },
  ];

  function stubAnalyticsFetch() {
    const routes: Record<string, unknown> = {
      "/api/dashboard": dashboardData,
      "/api/telemetry": telemetryData,
      "/api/findings": findingsData,
      "/api/gotchas": gotchasData,
      "/api/framework": frameworkData,
      "/api/suggestions": suggestionsData,
    };
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
      })
    );
  }

  beforeEach(() => stubAnalyticsFetch());

  it("shows hook total in Vitals and the per-hook breakdown in Framework Activity", async () => {
    renderPage(<DashboardPage />);
    expect(await screen.findByText("Framework Activity")).toBeInTheDocument();
    // The headline total now lives as a tile in the Vitals strip.
    expect(screen.getByText("Hook Events")).toBeInTheDocument();
    expect(screen.getByText("41")).toBeInTheDocument();
    // The card itself is now a single consistent table of per-hook events.
    expect(screen.getByText("cost-tracker")).toBeInTheDocument();
  });

  it("renders Open Criticals as a Vitals tile (promoted out of Quality)", async () => {
    renderPage(<DashboardPage />);
    // The tile (capitalised) lives in the strip…
    expect(await screen.findByText("Open Criticals")).toBeInTheDocument();
    // …and the old in-Quality row (lowercase 'criticals') is gone.
    expect(screen.queryByText("Open criticals")).not.toBeInTheDocument();
  });

  it("renders Quality Gate card with verdict", async () => {
    renderPage(<DashboardPage />);
    expect(await screen.findByText("Quality Gate")).toBeInTheDocument();
    expect(screen.getByText("APPROVE")).toBeInTheDocument();
    // Footer status line derived from review+criticals+tests (all clean here).
    expect(screen.getByText("All quality checks passing")).toBeInTheDocument();
  });

  it("renders Framework Backlog card with suggestion ids", async () => {
    renderPage(<DashboardPage />);
    expect(await screen.findByText("Framework Backlog")).toBeInTheDocument();
    expect(screen.getByText("FS-001")).toBeInTheDocument();
    expect(screen.getByText("FS-002")).toBeInTheDocument();
  });

  it("renders hero status pills (branch, update, doctor, health)", async () => {
    renderPage(<DashboardPage />);
    // Two-line label/value chips: BRANCH 1.2.3 · FRAMEWORK up to date · DOCTOR clean.
    expect(await screen.findByText("1.2.3")).toBeInTheDocument();
    expect(screen.getByText("up to date")).toBeInTheDocument();
    expect(screen.getByText("clean")).toBeInTheDocument();
    // Health rollup: doctor clean + no update available → nominal.
    expect(screen.getByText("all systems nominal")).toBeInTheDocument();
  });

  it("renders clean empty states when secondary data absent", async () => {
    // Override to return empty/null shapes for analytics endpoints
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/dashboard")) {
          return new Response(JSON.stringify(dashboardData), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        // Return 500 for all analytics endpoints — they should degrade to null
        return new Response("error", { status: 500 });
      })
    );
    renderPage(<DashboardPage />);
    // Dashboard should still render (primary data available)
    expect(await screen.findByText("Framework Activity")).toBeInTheDocument();
    // Cards render empty-state text instead of crashing
    expect(
      await screen.findByText(/No telemetry data yet/)
    ).toBeInTheDocument();
  });
});

describe("Error states", () => {
  it("KanbanPage shows an error + retry when the API fails", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 500, statusText: "Server Error" }));
    vi.stubGlobal("fetch", fetchMock);
    renderPage(<KanbanPage />);
    expect(await screen.findByText("Could not load this view")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
