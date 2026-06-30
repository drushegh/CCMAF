/**
 * smoke.test.tsx — Basic render sanity for DashboardPage (updated for TASK-007)
 *
 * DashboardPage now fetches real data (useAsync + fetchDashboard), so smoke tests
 * must stub fetch and await the async render rather than expecting synchronous output.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "../src/app/pages/DashboardPage";

/** Minimal DashboardSummary to satisfy the component. */
const STUB_DASHBOARD = {
  handbackQueue: [],
  taskCounts: [
    { lane: "feature", status: "In Progress", n: 1 },
    { lane: "feature", status: "Done", n: 2 },
  ],
  contractCounts: [
    { status: "stable", n: 3 },
    { status: "draft", n: 0 },
  ],
  latestDecisions: [
    { id: "DEC-010", date: "2026-06-23", status: "active", title: "UI quality bar", body: "" },
  ],
  currentSpec: "SPEC-project-console",
  sprintGoal: "Deliver the Project Console v1",
};

/** Minimal stubs for the TASK-025 analytics endpoints. */
const STUB_ANALYTICS: Record<string, unknown> = {
  "/api/telemetry": {
    generated_at: null,
    total_events: 0,
    by_hook: {},
    drift_triggers: {},
    sessions: 0,
    by_session: {},
    lastSession: null,
  },
  "/api/gotchas": [],
  "/api/findings": {
    review: { latestVerdict: null, openCriticals: 0 },
    test: { lastRun: null, pass: null, fail: null },
  },
  "/api/framework": {
    version: null,
    updateAvailable: false,
    healthcheckLastRun: null,
    doctorClean: true,
  },
  "/api/suggestions": [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(dashboardBody: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // Match analytics endpoints first
      const analyticsKey = Object.keys(STUB_ANALYTICS).find((k) =>
        url.includes(k)
      );
      if (analyticsKey) {
        return new Response(JSON.stringify(STUB_ANALYTICS[analyticsKey]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      // Fall back to the dashboard stub for /api/dashboard
      return new Response(JSON.stringify(dashboardBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );
}

describe("Project Console — smoke tests", () => {
  it("renders the Dashboard page without crashing", async () => {
    stubFetch(STUB_DASHBOARD); // now routes dashboard + analytics stubs
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    // The loading state renders first; wait for the hero title to appear.
    expect(await screen.findByText("Project Console")).toBeInTheDocument();
  });

  it("Dashboard shows the Handback Queue section", async () => {
    stubFetch(STUB_DASHBOARD);
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    expect(await screen.findByText("Handback Queue")).toBeInTheDocument();
  });

  it("Dashboard shows task count stats in the Vitals strip", async () => {
    stubFetch(STUB_DASHBOARD);
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    );
    // Task lifecycle counts now live as tiles in the Vitals strip.
    // ("Ready for Test" also appears in the handback empty-state copy, so assert
    // on labels unique to the strip.)
    expect(await screen.findByText("Ready for Review")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Hook Events")).toBeInTheDocument();
  });
});

// ── TASK-027: new framework-surface pages ─────────────────────────────────────

import { StatusPage } from "../src/app/pages/StatusPage";
import { GotchasPage } from "../src/app/pages/GotchasPage";
import { FindingsPage } from "../src/app/pages/FindingsPage";
import { DocsPage } from "../src/app/pages/DocsPage";
import { HeadroomPage } from "../src/app/pages/HeadroomPage";

/** Route a set of URL-substring → JSON-body pairs through a stubbed fetch. */
function stubRoutes(routes: Record<string, unknown>) {
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

describe("Framework-surface pages — TASK-027", () => {
  it("Status page renders STATUS.md markdown", async () => {
    stubRoutes({
      "/api/statedoc/status": {
        key: "status",
        exists: true,
        markdown: "# Project Status\n\nCurrent sprint goal text.",
      },
    });
    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>
    );
    expect(await screen.findByText("Project Status")).toBeInTheDocument();
    expect(screen.getByText("Current sprint goal text.")).toBeInTheDocument();
  });

  it("Status page shows an empty state when STATUS.md is absent", async () => {
    stubRoutes({
      "/api/statedoc/status": { key: "status", exists: false, markdown: "" },
    });
    render(
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>
    );
    expect(await screen.findByText("No STATUS.md found")).toBeInTheDocument();
  });

  it("Gotchas page renders grouped entries with confidence + body", async () => {
    stubRoutes({
      "/api/gotchas": [
        {
          title: "Verify files are user data",
          category: "Project-specific",
          confidence: "Verified (caught 2026-06-24)",
          count: 2,
          firstSeen: "2026-06-24",
          body: "Never write the real pass-files in tests.",
        },
      ],
    });
    render(
      <MemoryRouter>
        <GotchasPage />
      </MemoryRouter>
    );
    expect(
      await screen.findByText("Verify files are user data")
    ).toBeInTheDocument();
    expect(screen.getByText("Project-specific")).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(
      screen.getByText("Never write the real pass-files in tests.")
    ).toBeInTheDocument();
  });

  it("Findings page renders summary + the two finding docs", async () => {
    stubRoutes({
      "/api/findings": {
        review: { latestVerdict: "APPROVE", openCriticals: 0 },
        test: { lastRun: "2026-06-25", pass: 428, fail: 0 },
      },
      "/api/statedoc/review-findings": {
        key: "review-findings",
        exists: true,
        markdown: "## Review\n\nNo open criticals.",
      },
      "/api/statedoc/test-findings": {
        key: "test-findings",
        exists: true,
        markdown: "## Tests\n\nAll green.",
      },
    });
    render(
      <MemoryRouter>
        <FindingsPage />
      </MemoryRouter>
    );
    expect(await screen.findByText("APPROVE")).toBeInTheDocument();
    expect(screen.getByText("Review findings")).toBeInTheDocument();
    expect(screen.getByText("Test findings")).toBeInTheDocument();
    expect(screen.getByText("No open criticals.")).toBeInTheDocument();
  });

  it("Docs page renders the tree and the first markdown file", async () => {
    // /api/docs returns JSON; /api/docs/raw returns the raw file TEXT.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/docs/raw")) {
          return new Response("# Docs root\n\nBrowse me.", {
            status: 200,
            headers: { "Content-Type": "text/markdown" },
          });
        }
        if (url.includes("/api/docs")) {
          return new Response(
            JSON.stringify({
              exists: true,
              root: {
                name: "docs",
                path: "",
                type: "dir",
                children: [
                  { name: "README.md", path: "README.md", type: "file", ext: "md" },
                  {
                    name: "inspiration",
                    path: "inspiration",
                    type: "dir",
                    children: [
                      {
                        name: "shot.png",
                        path: "inspiration/shot.png",
                        type: "file",
                        ext: "png",
                      },
                    ],
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("not found", { status: 404 });
      })
    );
    render(
      <MemoryRouter>
        <DocsPage />
      </MemoryRouter>
    );
    // Tree shows the file + the nested dir…
    expect(await screen.findByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("inspiration")).toBeInTheDocument();
    // …and the first file (README.md) renders in the content pane.
    expect(await screen.findByText("Docs root")).toBeInTheDocument();
    expect(screen.getByText("Browse me.")).toBeInTheDocument();
  });

  it("Docs page shows an empty state when docs/ is absent", async () => {
    stubRoutes({ "/api/docs": { exists: false, root: null } });
    render(
      <MemoryRouter>
        <DocsPage />
      </MemoryRouter>
    );
    expect(await screen.findByText("No docs/ folder yet")).toBeInTheDocument();
  });

  it("Headroom page shows an empty state until Headroom has run", async () => {
    stubRoutes({
      "/api/headroom": {
        available: false,
        recordCount: 0,
        tokensIn: 0,
        tokensOut: 0,
        tokensSaved: 0,
        avgCompressionRatio: null,
        costUsd: 0,
        lastRun: null,
        recent: [],
      },
    });
    render(
      <MemoryRouter>
        <HeadroomPage />
      </MemoryRouter>
    );
    expect(
      await screen.findByText("No Headroom metrics yet")
    ).toBeInTheDocument();
  });

  it("Headroom page renders real aggregates + records when available", async () => {
    stubRoutes({
      "/api/headroom": {
        available: true,
        recordCount: 2,
        tokensIn: 8000,
        tokensOut: 3000,
        tokensSaved: 5000,
        avgCompressionRatio: 0.4,
        costUsd: 0.01,
        lastRun: "2026-06-25T16:35:00Z",
        recent: [
          {
            eventId: "hdr-2",
            ts: "2026-06-25T16:35:00Z",
            model: "claude-opus-4-8",
            tokensIn: 3000,
            tokensOut: 1500,
            tokensSaved: 1500,
            compressionRatio: 0.5,
            costUsd: null,
            latencyMs: null,
          },
        ],
      },
    });
    render(
      <MemoryRouter>
        <HeadroomPage />
      </MemoryRouter>
    );
    // headline aggregate (5,000 saved) + avg reduction = ratio itself (0.4 → 40%,
    // since compression_ratio is the fraction removed, not tokens_out/tokens_in)
    expect(await screen.findByText("5,000")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("Recent records")).toBeInTheDocument();
  });
});
