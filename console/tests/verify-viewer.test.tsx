import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { VerifyViewer } from "../src/app/verify/VerifyViewer";
import { VerifyPage } from "../src/app/pages/VerifyPage";
import { saveVerdicts, type VerifyFile } from "../src/app/api/verify";

function makeFile(overrides: Partial<VerifyFile> = {}): VerifyFile {
  return {
    schemaVersion: 1,
    task: "TASK-005",
    status: "in-review",
    items: [
      {
        id: "TP-01",
        kind: "test-plan-item",
        title: "First item",
        verdict: "pending",
        severity: null,
        notes: "",
      },
      {
        id: "TP-02",
        kind: "test-plan-item",
        title: "Second item",
        verdict: "pending",
        severity: null,
        notes: "",
      },
    ],
    ...overrides,
  };
}

describe("VerifyViewer — verdict + rollup", () => {
  it("starts with all items pending in the rollup", () => {
    render(<VerifyViewer file={makeFile()} />);
    expect(screen.getByTestId("rollup-count-pending").textContent).toBe("2");
    expect(screen.getByTestId("rollup-count-pass").textContent).toBe("0");
    expect(screen.getByTestId("rollup-reviewed").textContent).toBe(
      "0/2 reviewed"
    );
  });

  it("updates the rollup when a verdict changes", () => {
    render(<VerifyViewer file={makeFile()} />);

    // The verdict control for TP-01 — click its "Pass" radio.
    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /pass/i }));

    expect(screen.getByTestId("rollup-count-pass").textContent).toBe("1");
    expect(screen.getByTestId("rollup-count-pending").textContent).toBe("1");
    expect(screen.getByTestId("rollup-reviewed").textContent).toBe(
      "1/2 reviewed"
    );
  });
});

describe("VerifyViewer — severity gating", () => {
  it("disables severity unless verdict is fail or warn", () => {
    render(<VerifyViewer file={makeFile()} />);
    const sev = screen.getByTestId("severity-TP-01") as HTMLSelectElement;

    // pending → disabled
    expect(sev.disabled).toBe(true);

    // → fail enables it
    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /fail/i }));
    expect(sev.disabled).toBe(false);

    // → warn keeps it enabled
    fireEvent.click(within(group).getByRole("radio", { name: /warn/i }));
    expect(sev.disabled).toBe(false);

    // → pass disables it again
    fireEvent.click(within(group).getByRole("radio", { name: /pass/i }));
    expect(sev.disabled).toBe(true);
  });

  it("clears severity when leaving fail/warn (contract: non-null only on fail/warn)", async () => {
    const onSave = vi.fn().mockResolvedValue(makeFile());
    render(<VerifyViewer file={makeFile()} onSave={onSave} />);

    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /fail/i }));

    const sev = screen.getByTestId("severity-TP-01") as HTMLSelectElement;
    fireEvent.change(sev, { target: { value: "P1" } });
    expect(sev.value).toBe("P1");

    // switch to pass — severity must reset
    fireEvent.click(within(group).getByRole("radio", { name: /pass/i }));
    expect(sev.value).toBe("");

    fireEvent.click(screen.getByTestId("save-btn"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const patches = onSave.mock.calls[0][0];
    const tp01 = patches.find((p: { id: string }) => p.id === "TP-01");
    expect(tp01.verdict).toBe("pass");
    expect(tp01.severity).toBeNull();
  });
});

describe("VerifyViewer — Save", () => {
  it("Save is disabled until an edit is made", () => {
    render(<VerifyViewer file={makeFile()} onSave={vi.fn()} />);
    const btn = screen.getByTestId("save-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /pass/i }));
    expect(btn.disabled).toBe(false);
  });

  it("Save calls onSave with the full VerdictPatch[]", async () => {
    const onSave = vi.fn().mockResolvedValue(makeFile());
    render(<VerifyViewer file={makeFile()} onSave={onSave} />);

    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /warn/i }));

    const sev = screen.getByTestId("severity-TP-01") as HTMLSelectElement;
    fireEvent.change(sev, { target: { value: "P2" } });

    fireEvent.change(screen.getByTestId("notes-TP-01"), {
      target: { value: "needs a fix" },
    });

    fireEvent.click(screen.getByTestId("save-btn"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    const patches = onSave.mock.calls[0][0];
    expect(patches).toHaveLength(2);
    const tp01 = patches.find((p: { id: string }) => p.id === "TP-01");
    expect(tp01).toEqual({
      id: "TP-01",
      verdict: "warn",
      severity: "P2",
      notes: "needs a fix",
      bugId: null,
    });
  });
});

// ── VerifyViewer — after-save the viewer is clean (regression: nav guard fired post-save) ──

describe("VerifyViewer — clean after save", () => {
  it("clears dirty after a successful save even though the file prop is unchanged", async () => {
    // The server reconciles and echoes back the saved verdicts. The parent does
    // NOT re-fetch the file prop after a write, so the viewer must adopt this
    // response as its new baseline.
    const onSave = vi.fn(async (patches) => {
      return makeFile({
        items: patches.map((p: { id: string; verdict: string; severity: unknown; notes: string }) => ({
          id: p.id,
          kind: "test-plan-item" as const,
          title: p.id,
          verdict: p.verdict,
          severity: p.severity ?? null,
          notes: p.notes ?? "",
        })),
      });
    });
    const onDirtyChange = vi.fn();
    render(
      <VerifyViewer file={makeFile()} onSave={onSave} onDirtyChange={onDirtyChange} />
    );

    // Edit → dirty → Save enabled.
    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /pass/i }));
    const saveBtn = screen.getByTestId("save-btn") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(saveBtn);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    // After save, the *prop* is still the original (all pending) — but the viewer
    // adopted the reconciled response, so it must be clean.
    await waitFor(() => expect(saveBtn.disabled).toBe(true));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(screen.getByText(/^Saved$/)).toBeInTheDocument();
  });
});

// ── VerifyViewer — severity rule: switching away from fail/warn nulls severity ──

describe("VerifyViewer — severity contract on verdict switch", () => {
  it("emits severity:null in the patch when switching from fail to pass", async () => {
    const onSave = vi.fn().mockResolvedValue(makeFile());
    render(<VerifyViewer file={makeFile()} onSave={onSave} />);

    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /fail/i }));
    const sev = screen.getByTestId("severity-TP-01") as HTMLSelectElement;
    fireEvent.change(sev, { target: { value: "P0" } });

    // Switch to pass — severity must be null in the patch.
    // Note: we land on a different verdict than the original (pending) so the
    // item is still dirty and Save is enabled.
    fireEvent.click(within(group).getByRole("radio", { name: /pass/i }));
    fireEvent.click(screen.getByTestId("save-btn"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const patch = onSave.mock.calls[0][0].find((p: { id: string }) => p.id === "TP-01");
    expect(patch.verdict).toBe("pass");
    expect(patch.severity).toBeNull();
  });

  it("emits severity:null in the patch when switching from fail to blocked", async () => {
    const onSave = vi.fn().mockResolvedValue(makeFile());
    render(<VerifyViewer file={makeFile()} onSave={onSave} />);

    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /fail/i }));
    const sev = screen.getByTestId("severity-TP-01") as HTMLSelectElement;
    fireEvent.change(sev, { target: { value: "P2" } });

    fireEvent.click(within(group).getByRole("radio", { name: /blocked/i }));
    fireEvent.click(screen.getByTestId("save-btn"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const patch = onSave.mock.calls[0][0].find((p: { id: string }) => p.id === "TP-01");
    expect(patch.verdict).toBe("blocked");
    expect(patch.severity).toBeNull();
  });
});

// ── VerifyViewer — write failure: surfaces error with role=alert, stays dirty ──

describe("VerifyViewer — write failure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows role=alert with the error message and keeps dirty state after a failed save", async () => {
    const onSave = vi
      .fn()
      .mockRejectedValue(new Error("Server error: 500 Internal"));
    render(<VerifyViewer file={makeFile()} onSave={onSave} />);

    // Make an edit to enable Save.
    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /pass/i }));

    const saveBtn = screen.getByTestId("save-btn") as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);

    fireEvent.click(saveBtn);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toBeInTheDocument()
    );

    // Error message must be visible.
    expect(screen.getByRole("alert").textContent).toMatch(/Server error/i);

    // Save button must still be enabled (state is still dirty).
    expect(saveBtn.disabled).toBe(false);
  });
});

// ── VerifyViewer — file prop change resync (#1) ──

describe("VerifyViewer — file prop resync", () => {
  it("discards local items and resets to new file when file.task changes", () => {
    const fileA = makeFile({ task: "TASK-A" });
    const fileB = makeFile({
      task: "TASK-B",
      items: [
        {
          id: "TP-10",
          kind: "test-plan-item",
          title: "Task B item",
          verdict: "pass",
          severity: null,
          notes: "",
        },
      ],
    });

    const { rerender } = render(<VerifyViewer file={fileA} />);

    // Make a local edit on fileA.
    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /fail/i }));
    expect(screen.getByTestId("rollup-count-fail").textContent).toBe("1");

    // Now swap to fileB — the viewer must show fileB's items, not the edited fileA items.
    act(() => {
      rerender(<VerifyViewer file={fileB} />);
    });

    // fileB has only TP-10 with verdict "pass"
    expect(screen.getByTestId("verdict-TP-10")).toBeInTheDocument();
    expect(screen.getByTestId("rollup-count-pass").textContent).toBe("1");
    // TP-01 should no longer be present
    expect(screen.queryByTestId("verdict-TP-01")).toBeNull();
  });

  it("does NOT resync items when the same file reference is re-rendered (same task)", () => {
    const file = makeFile();
    const { rerender } = render(<VerifyViewer file={file} />);

    // Make a local edit.
    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /pass/i }));
    expect(screen.getByTestId("rollup-count-pass").textContent).toBe("1");

    // Re-render with the same task (simulate a parent re-render without a new file fetch).
    act(() => {
      rerender(<VerifyViewer file={file} />);
    });

    // Local edit must be preserved.
    expect(screen.getByTestId("rollup-count-pass").textContent).toBe("1");
  });
});

// ── VerdictControl — roving tabindex keyboard navigation (#2) ──

describe("VerdictControl — roving tabindex + keyboard navigation", () => {
  it("only the selected radio has tabIndex=0; others have tabIndex=-1", () => {
    render(<VerifyViewer file={makeFile()} />);
    const group = screen.getByTestId("verdict-TP-01");
    const radios = within(group).getAllByRole("radio");

    // Initial verdict is "pending" (index 0 in OPTIONS).
    const pendingBtn = within(group).getByRole("radio", { name: /pending/i });
    expect(pendingBtn.tabIndex).toBe(0);
    radios
      .filter((r) => r !== pendingBtn)
      .forEach((r) => expect(r.tabIndex).toBe(-1));
  });

  it("ArrowRight moves focus+selection to the next option (wraps)", () => {
    render(<VerifyViewer file={makeFile()} />);
    const group = screen.getByTestId("verdict-TP-01");
    const pendingBtn = within(group).getByRole("radio", { name: /pending/i });

    // Focus the pending button first.
    pendingBtn.focus();
    fireEvent.keyDown(pendingBtn, { key: "ArrowRight" });

    // Selection should have moved to "pass" (index 1).
    const passBtn = within(group).getByRole("radio", { name: /pass/i });
    expect(passBtn).toHaveAttribute("aria-checked", "true");
    expect(passBtn.tabIndex).toBe(0);
  });

  it("ArrowLeft moves focus+selection to the previous option (wraps)", () => {
    render(<VerifyViewer file={makeFile()} />);
    const group = screen.getByTestId("verdict-TP-01");
    const pendingBtn = within(group).getByRole("radio", { name: /pending/i });

    pendingBtn.focus();
    fireEvent.keyDown(pendingBtn, { key: "ArrowLeft" });

    // OPTIONS has 5 entries; wrapping back from index 0 should give index 4 = "blocked".
    const blockedBtn = within(group).getByRole("radio", { name: /blocked/i });
    expect(blockedBtn).toHaveAttribute("aria-checked", "true");
    expect(blockedBtn.tabIndex).toBe(0);
  });

  it("Home key jumps to the first option", () => {
    // Start with a non-first verdict so the jump is observable.
    const file = makeFile({
      items: [
        {
          id: "TP-01",
          kind: "test-plan-item",
          title: "First item",
          verdict: "fail",
          severity: null,
          notes: "",
        },
        {
          id: "TP-02",
          kind: "test-plan-item",
          title: "Second item",
          verdict: "pending",
          severity: null,
          notes: "",
        },
      ],
    });
    render(<VerifyViewer file={file} />);
    const group = screen.getByTestId("verdict-TP-01");
    const failBtn = within(group).getByRole("radio", { name: /fail/i });

    failBtn.focus();
    fireEvent.keyDown(failBtn, { key: "Home" });

    const pendingBtn = within(group).getByRole("radio", { name: /pending/i });
    expect(pendingBtn).toHaveAttribute("aria-checked", "true");
  });

  it("End key jumps to the last option", () => {
    render(<VerifyViewer file={makeFile()} />);
    const group = screen.getByTestId("verdict-TP-01");
    const pendingBtn = within(group).getByRole("radio", { name: /pending/i });

    pendingBtn.focus();
    fireEvent.keyDown(pendingBtn, { key: "End" });

    const blockedBtn = within(group).getByRole("radio", { name: /blocked/i });
    expect(blockedBtn).toHaveAttribute("aria-checked", "true");
  });

  it("radiogroup aria-label includes the itemId", () => {
    render(<VerifyViewer file={makeFile()} />);
    const group = screen.getByTestId("verdict-TP-01");
    expect(group).toHaveAttribute("aria-label", "Verdict for TP-01");
  });
});

// ── VerifyViewer — iterative loop: flag-as-bug, retest, prior rounds, Accept ──

/** An onSave that echoes the patches back as items (preserving bugId). */
function echoSave() {
  return vi.fn(async (patches: Array<{ id: string; verdict: string; severity: unknown; notes?: string; bugId?: string | null }>) =>
    makeFile({
      items: patches.map((p) => ({
        id: p.id,
        kind: "test-plan-item" as const,
        title: p.id,
        verdict: p.verdict as "pass",
        severity: (p.severity ?? null) as null,
        notes: p.notes ?? "",
        bugId: p.bugId ?? null,
      })),
    })
  );
}

describe("VerifyViewer — flag as bug", () => {
  it("shows the flag-as-bug button only on a failing verdict", () => {
    render(<VerifyViewer file={makeFile()} onSave={vi.fn()} onCreateBug={vi.fn()} />);
    // pending → no flag button
    expect(screen.queryByTestId("flag-TP-01")).toBeNull();
    // fail → flag button appears
    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /fail/i }));
    expect(screen.getByTestId("flag-TP-01")).toBeInTheDocument();
  });

  it("does not show flag-as-bug at all without onCreateBug", () => {
    render(<VerifyViewer file={makeFile()} onSave={vi.fn()} />);
    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /fail/i }));
    expect(screen.queryByTestId("flag-TP-01")).toBeNull();
  });

  it("creates the bug with the item, persists the bugId, and shows the linked badge", async () => {
    const onCreateBug = vi.fn().mockResolvedValue("BUG-042");
    const onSave = echoSave();
    render(
      <VerifyViewer file={makeFile()} onSave={onSave} onCreateBug={onCreateBug} />
    );

    // Fail the first use case, then flag it.
    const group = screen.getByTestId("verdict-TP-01");
    fireEvent.click(within(group).getByRole("radio", { name: /fail/i }));
    fireEvent.click(screen.getByTestId("flag-TP-01"));

    await waitFor(() => expect(onCreateBug).toHaveBeenCalledTimes(1));
    expect(onCreateBug.mock.calls[0][0]).toMatchObject({ id: "TP-01", verdict: "fail" });

    // The viewer persists immediately with the bugId on the patch.
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const patch = onSave.mock.calls.at(-1)![0].find((p: { id: string }) => p.id === "TP-01");
    expect(patch.bugId).toBe("BUG-042");

    // The linked-bug confirmation replaces the flag button.
    expect(await screen.findByTestId("flagged-TP-01")).toBeInTheDocument();
    expect(screen.queryByTestId("flag-TP-01")).toBeNull();
  });
});

describe("VerifyViewer — retest rounds", () => {
  it("shows a retest badge and the prior round's note for a use case past round 1", () => {
    const file = makeFile({
      items: [
        {
          id: "TP-01",
          kind: "test-plan-item",
          title: "First item",
          verdict: "pending",
          severity: null,
          notes: "",
          round: 2,
          bugId: null,
          noteRounds: [
            { round: 1, note: "failed the first time" },
            { round: 2, note: "" },
          ],
        },
      ],
    });
    render(<VerifyViewer file={file} />);
    expect(screen.getByText(/Retest · round 2/)).toBeInTheDocument();
    const rounds = screen.getByTestId("rounds-TP-01");
    expect(within(rounds).getByText("failed the first time")).toBeInTheDocument();
  });
});

describe("VerifyViewer — Accept & Done gating", () => {
  it("enables Accept only when every use case passes and edits are saved", async () => {
    const onAccept = vi.fn().mockResolvedValue(undefined);
    const onSave = echoSave();
    render(<VerifyViewer file={makeFile()} onSave={onSave} onAccept={onAccept} />);

    const acceptBtn = screen.getByTestId("accept-btn") as HTMLButtonElement;
    // pending → disabled
    expect(acceptBtn.disabled).toBe(true);

    // pass both items — all pass but now DIRTY → still disabled
    for (const id of ["TP-01", "TP-02"]) {
      const g = screen.getByTestId(`verdict-${id}`);
      fireEvent.click(within(g).getByRole("radio", { name: /pass/i }));
    }
    expect(acceptBtn.disabled).toBe(true);

    // save → clean + all pass → enabled
    fireEvent.click(screen.getByTestId("save-btn"));
    await waitFor(() => expect(acceptBtn.disabled).toBe(false));

    fireEvent.click(acceptBtn);
    await waitFor(() => expect(onAccept).toHaveBeenCalledTimes(1));
  });

  it("does not render Accept without onAccept", () => {
    render(<VerifyViewer file={makeFile()} onSave={vi.fn()} />);
    expect(screen.queryByTestId("accept-btn")).toBeNull();
  });
});

// ── saveVerdicts(): the PUT + token header wiring ──

describe("saveVerdicts — PUT with token header", () => {
  beforeEach(() => {
    document
      .querySelectorAll('meta[name="x-console-token"]')
      .forEach((el) => el.remove());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends PUT to /api/verify/:task with X-Console-Token and the patch body", async () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "x-console-token");
    meta.setAttribute("content", "launch-token-abc");
    document.head.appendChild(meta);

    const returned: VerifyFile = makeFile();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => returned,
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const patches = [{ id: "TP-01", verdict: "pass" as const }];
    const result = await saveVerdicts("TASK-005", patches);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/verify/TASK-005");
    expect(init.method).toBe("PUT");
    expect(init.headers["X-Console-Token"]).toBe("launch-token-abc");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(patches);
    expect(result).toEqual(returned);

    meta.remove();
  });

  it("throws a useful error when the server rejects the write", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "missing or invalid x-console-token" }),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      saveVerdicts("TASK-005", [{ id: "TP-01", verdict: "pass" }])
    ).rejects.toThrow(/401/);
  });
});

// ── VerifyPage: queue list + deep-link routing + states ──

function stubRoutes(routes: Record<string, unknown>) {
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[key]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", impl);
  return impl;
}

function renderVerify(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/verify/:task" element={<VerifyPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("VerifyPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the empty state when the queue is empty", async () => {
    stubRoutes({ "/api/verify": [] });
    renderVerify("/verify");
    expect(
      await screen.findByText("No tasks awaiting verdict")
    ).toBeInTheDocument();
  });

  it("lists queued tasks and opens one into the viewer", async () => {
    stubRoutes({
      "/api/verify": [
        { task: "TASK-006", title: "Read-only pages", counts: { pending: 2 } },
      ],
      "/api/verify/TASK-006": makeFile({ task: "TASK-006" }),
    });
    renderVerify("/verify");

    const item = await screen.findByText("Read-only pages");
    fireEvent.click(item);

    // The viewer (with its toolbar task code) appears for the opened file.
    expect(await screen.findByTestId("verify-viewer")).toBeInTheDocument();
    expect(await screen.findByTestId("rollup")).toBeInTheDocument();
  });

  it("deep-links straight into the viewer at /verify/:task", async () => {
    stubRoutes({ "/api/verify/TASK-006": makeFile({ task: "TASK-006" }) });
    renderVerify("/verify/TASK-006");
    expect(await screen.findByTestId("verify-viewer")).toBeInTheDocument();
  });

  it("shows an error panel with retry when the file fails to load", async () => {
    // Master-detail: the queue (left) and the file (right) load independently.
    // Stub the queue to succeed (empty) so ONLY the file pane errors — otherwise
    // both panes render an alert and the query is ambiguous.
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("/api/verify/")) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    renderVerify("/verify/TASK-006");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
