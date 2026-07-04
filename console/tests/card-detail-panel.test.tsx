/**
 * card-detail-panel.test.tsx — tests for CardDetailPanel (TASK-012).
 *
 * Covers:
 *   - Renders task detail (title, id, status) when fetchTaskDetail resolves
 *   - Loading and error states for detail + comments
 *   - Inline status <select> calls putTaskStatus on change
 *   - Comments thread renders newest-last with author
 *   - Add-comment textarea: Send button disabled when empty
 *   - Posting a comment calls postComment and appends optimistically
 *   - Reverts optimistic comment on postComment failure
 *   - onClose called on backdrop click and Escape key
 *   - onStatusChange callback fired after successful status change
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CardDetailPanel } from "../src/app/components/CardDetailPanel.js";
import type { TaskBoardColumn } from "../src/app/api/state.js";
import type { TaskDetail, CommentThread } from "../src/app/api/tasks-write.js";
import type { VerifyFile } from "../src/app/api/verify.js";

// ── Module mocks ──────────────────────────────────────────────────────────

const mockFetchTaskDetail = vi.fn<() => Promise<TaskDetail>>();
const mockFetchComments = vi.fn<() => Promise<CommentThread>>();
const mockPutTaskStatus = vi.fn();
const mockPostComment = vi.fn<() => Promise<CommentThread>>();
const mockFetchVerifyFile = vi.fn<() => Promise<VerifyFile>>();

vi.mock("../src/app/api/tasks-write.js", () => ({
  fetchTaskDetail: (...args: unknown[]) => mockFetchTaskDetail(...args),
  fetchComments: (...args: unknown[]) => mockFetchComments(...args),
  putTaskStatus: (...args: unknown[]) => mockPutTaskStatus(...args),
  postComment: (...args: unknown[]) => mockPostComment(...args),
  readConsoleToken: () => "test-token",
  TasksApiError: class TasksApiError extends Error {
    status: number;
    constructor(msg: string, status: number) {
      super(msg);
      this.status = status;
    }
  },
}));

vi.mock("../src/app/api/verify.js", () => ({
  fetchVerifyFile: (...args: unknown[]) => mockFetchVerifyFile(...args),
  isComplete: (verdict: string) => verdict === "pass" || verdict === "cr",
}));

// ── Fixtures ──────────────────────────────────────────────────────────────

const DETAIL: TaskDetail = {
  id: "TASK-011",
  title: "Interactive Kanban",
  lane: "feature",
  status: "In Progress",
  body: ["- Drag cards between columns", "- Card detail side panel"],
  comments: 1,
};

const THREAD: CommentThread = {
  schemaVersion: 1,
  taskId: "TASK-011",
  comments: [
    { id: "c-1", author: "human", ts: new Date(Date.now() - 60_000).toISOString(), body: "First comment" },
    { id: "c-2", author: "claude", ts: new Date(Date.now() - 30_000).toISOString(), body: "Acknowledged" },
  ],
};

const EMPTY_THREAD: CommentThread = {
  schemaVersion: 1,
  taskId: "TASK-011",
  comments: [],
};

const COLUMNS: TaskBoardColumn[] = [
  { status: "Backlog", lane: "feature", items: [] },
  { status: "In Progress", lane: "feature", items: [] },
  { status: "Done", lane: "feature", items: [] },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof CardDetailPanel>> = {}) {
  return render(
    <CardDetailPanel
      taskId="TASK-011"
      columns={COLUMNS}
      lane="feature"
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockFetchTaskDetail.mockResolvedValue(DETAIL);
  mockFetchComments.mockResolvedValue(THREAD);
  mockPutTaskStatus.mockResolvedValue({ ok: true, board: { columns: [] } });
  mockPostComment.mockResolvedValue(EMPTY_THREAD);
  // Default: no verify file for this task (the common case for most tasks —
  // a 404 from the real endpoint). The dropdown-guard tests override this.
  mockFetchVerifyFile.mockRejectedValue(new Error("404"));
  // Default: the user confirms, so pre-existing tests that jump straight to
  // Done (from a pre-Verify status) keep their original behaviour. The
  // guard-specific tests below override this per case.
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  // restoreAllMocks (not just clearAllMocks) so the window.confirm spy is
  // torn down cleanly between tests instead of stacking.
  vi.restoreAllMocks();
});

describe("CardDetailPanel — renders task detail", () => {
  it("shows the task id in the header immediately", () => {
    renderPanel();
    // getByText would match multiple elements; use the specific code element
    expect(screen.getByText("TASK-011", { selector: "code.cdp-task-id" })).toBeInTheDocument();
  });

  it("shows the task title after detail loads", async () => {
    renderPanel();
    expect(await screen.findByText("Interactive Kanban")).toBeInTheDocument();
  });

  it("shows the lane badge", () => {
    renderPanel();
    expect(screen.getByText("feature")).toBeInTheDocument();
  });

  it("renders the body lines", async () => {
    renderPanel();
    expect(await screen.findByText("- Drag cards between columns")).toBeInTheDocument();
    expect(screen.getByText("- Card detail side panel")).toBeInTheDocument();
  });

  it("shows an empty-description message when body is empty", async () => {
    mockFetchTaskDetail.mockResolvedValue({ ...DETAIL, body: [] });
    renderPanel();
    expect(await screen.findByText("No description.")).toBeInTheDocument();
  });
});

describe("CardDetailPanel — loading states", () => {
  it("shows a loading indicator while detail is fetching", () => {
    mockFetchTaskDetail.mockReturnValue(new Promise(() => {})); // never resolves
    mockFetchComments.mockReturnValue(new Promise(() => {}));
    renderPanel();
    // Both detail and comments show "Loading…" — confirm at least one exists
    expect(screen.getAllByText(/loading…/i).length).toBeGreaterThanOrEqual(1);
  });

  it("shows an error alert when detail fails to load", async () => {
    mockFetchTaskDetail.mockRejectedValue(new Error("Network error"));
    renderPanel();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert").textContent).toMatch(/Network error/);
  });
});

describe("CardDetailPanel — inline status select", () => {
  it("renders the status select with all columns as options", async () => {
    renderPanel();
    const select = await screen.findByTestId("cdp-status-select");
    expect(select).toBeInTheDocument();
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(["Backlog", "In Progress", "Done"]);
  });

  it("select value matches the current task status", async () => {
    renderPanel();
    const select = (await screen.findByTestId("cdp-status-select")) as HTMLSelectElement;
    expect(select.value).toBe("In Progress");
  });

  it("calls putTaskStatus when the status changes", async () => {
    renderPanel();
    const select = await screen.findByTestId("cdp-status-select");
    fireEvent.change(select, { target: { value: "Done" } });
    await waitFor(() => expect(mockPutTaskStatus).toHaveBeenCalledOnce());
    expect(mockPutTaskStatus).toHaveBeenCalledWith("TASK-011", "Done", "feature");
  });

  it("calls onStatusChange callback after a successful status change", async () => {
    const onStatusChange = vi.fn();
    renderPanel({ onStatusChange });
    const select = await screen.findByTestId("cdp-status-select");
    fireEvent.change(select, { target: { value: "Done" } });
    await waitFor(() => expect(onStatusChange).toHaveBeenCalledOnce());
    expect(onStatusChange).toHaveBeenCalledWith("TASK-011", "Done", "feature");
  });

  it("shows an error alert when putTaskStatus fails", async () => {
    mockPutTaskStatus.mockRejectedValue(new Error("Status update failed (401)"));
    renderPanel();
    const select = await screen.findByTestId("cdp-status-select");
    fireEvent.change(select, { target: { value: "Done" } });
    expect(await screen.findByTestId("cdp-status-error")).toBeInTheDocument();
  });

  it("is a no-op when selecting the current status", async () => {
    renderPanel();
    const select = await screen.findByTestId("cdp-status-select");
    fireEvent.change(select, { target: { value: "In Progress" } }); // same as current
    await waitFor(() => expect(mockPutTaskStatus).not.toHaveBeenCalled());
  });
});

describe("CardDetailPanel — Done dropdown guard (change 6)", () => {
  it("shows a confirm and aborts the move when a pre-Verify task is jumped straight to Done and the user cancels", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPanel(); // DETAIL.status = "In Progress" — pre-Verify
    const select = await screen.findByTestId("cdp-status-select");
    fireEvent.change(select, { target: { value: "Done" } });

    await waitFor(() => expect(window.confirm).toHaveBeenCalledOnce());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/verify/i));
    expect(mockPutTaskStatus).not.toHaveBeenCalled();
  });

  it("proceeds with the same putTaskStatus call once the user confirms a pre-Verify → Done jump", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel();
    const select = await screen.findByTestId("cdp-status-select");
    fireEvent.change(select, { target: { value: "Done" } });

    await waitFor(() => expect(window.confirm).toHaveBeenCalledOnce());
    await waitFor(() => expect(mockPutTaskStatus).toHaveBeenCalledWith("TASK-011", "Done", "feature"));
  });

  it("shows the truthful unverified-use-case count when the task is already at Verify but not all items are complete", async () => {
    mockFetchVerifyFile.mockResolvedValue({
      schemaVersion: 1,
      task: "TASK-011",
      status: "in-review",
      items: [
        { id: "uc-1", kind: "usecase", title: "a", verdict: "pass" },
        { id: "uc-2", kind: "usecase", title: "b", verdict: "pending" },
      ],
    });
    mockFetchTaskDetail.mockResolvedValue({ ...DETAIL, status: "Verify" });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPanel({
      columns: [
        { status: "In Progress", lane: "feature", items: [] },
        { status: "Verify", lane: "feature", items: [] },
        { status: "Done", lane: "feature", items: [] },
      ],
    });

    const select = await screen.findByTestId("cdp-status-select");
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("Verify"));
    fireEvent.change(select, { target: { value: "Done" } });

    await waitFor(() => expect(window.confirm).toHaveBeenCalledOnce());
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/1 use case unverified/i));
    expect(mockPutTaskStatus).toHaveBeenCalledWith("TASK-011", "Done", "feature");
  });

  it("does not show a confirm when the task is at Verify and every use case is pass/cr", async () => {
    mockFetchVerifyFile.mockResolvedValue({
      schemaVersion: 1,
      task: "TASK-011",
      status: "in-review",
      items: [
        { id: "uc-1", kind: "usecase", title: "a", verdict: "pass" },
        { id: "uc-2", kind: "usecase", title: "b", verdict: "cr" },
      ],
    });
    mockFetchTaskDetail.mockResolvedValue({ ...DETAIL, status: "Verify" });
    const confirmSpy = vi.spyOn(window, "confirm");
    renderPanel({
      columns: [
        { status: "In Progress", lane: "feature", items: [] },
        { status: "Verify", lane: "feature", items: [] },
        { status: "Done", lane: "feature", items: [] },
      ],
    });

    const select = await screen.findByTestId("cdp-status-select");
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe("Verify"));
    fireEvent.change(select, { target: { value: "Done" } });

    await waitFor(() => expect(mockPutTaskStatus).toHaveBeenCalledWith("TASK-011", "Done", "feature"));
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe("CardDetailPanel — comments thread", () => {
  it("renders all comments in order", async () => {
    renderPanel();
    const list = await screen.findByTestId("cdp-comments-list");
    expect(list.children).toHaveLength(2);
    expect(list.textContent).toContain("First comment");
    expect(list.textContent).toContain("Acknowledged");
  });

  it("shows each comment's author", async () => {
    renderPanel();
    await screen.findByTestId("cdp-comments-list");
    expect(screen.getByText("human")).toBeInTheDocument();
    expect(screen.getByText("claude")).toBeInTheDocument();
  });

  it("shows empty-comments message when thread is empty", async () => {
    mockFetchComments.mockResolvedValue(EMPTY_THREAD);
    renderPanel();
    expect(await screen.findByText("No comments yet.")).toBeInTheDocument();
  });
});

describe("CardDetailPanel — add comment", () => {
  it("Send button is disabled when textarea is empty", async () => {
    mockFetchComments.mockResolvedValue(EMPTY_THREAD);
    renderPanel();
    await screen.findByText("No comments yet.");
    const btn = screen.getByTestId("cdp-comment-submit") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("Send button becomes enabled when text is entered", async () => {
    mockFetchComments.mockResolvedValue(EMPTY_THREAD);
    renderPanel();
    await screen.findByText("No comments yet.");
    const textarea = screen.getByTestId("cdp-comment-textarea");
    fireEvent.change(textarea, { target: { value: "New comment" } });
    const btn = screen.getByTestId("cdp-comment-submit") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("Send button is disabled when text is only whitespace", async () => {
    mockFetchComments.mockResolvedValue(EMPTY_THREAD);
    renderPanel();
    await screen.findByText("No comments yet.");
    const textarea = screen.getByTestId("cdp-comment-textarea");
    fireEvent.change(textarea, { target: { value: "   " } });
    const btn = screen.getByTestId("cdp-comment-submit") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("clicking Send calls postComment and appends comment optimistically", async () => {
    mockFetchComments.mockResolvedValue(EMPTY_THREAD);
    const updatedThread: CommentThread = {
      schemaVersion: 1,
      taskId: "TASK-011",
      comments: [{ id: "c-new", author: "human", ts: new Date().toISOString(), body: "New comment" }],
    };
    mockPostComment.mockResolvedValue(updatedThread);

    renderPanel();
    await screen.findByText("No comments yet.");

    const textarea = screen.getByTestId("cdp-comment-textarea");
    fireEvent.change(textarea, { target: { value: "New comment" } });
    fireEvent.click(screen.getByTestId("cdp-comment-submit"));

    // Optimistic append: comment appears immediately
    expect(screen.getByText("New comment")).toBeInTheDocument();

    await waitFor(() => expect(mockPostComment).toHaveBeenCalledOnce());
    expect(mockPostComment).toHaveBeenCalledWith("TASK-011", "New comment");

    // After server reply, the thread is updated (server comment replaces optimistic)
    await waitFor(() => expect(screen.getByText("New comment")).toBeInTheDocument());
  });

  it("clears textarea after successful post", async () => {
    mockFetchComments.mockResolvedValue(EMPTY_THREAD);
    mockPostComment.mockResolvedValue({
      schemaVersion: 1,
      taskId: "TASK-011",
      comments: [{ id: "c-1", author: "human", ts: new Date().toISOString(), body: "hi" }],
    });
    renderPanel();
    await screen.findByText("No comments yet.");
    const textarea = screen.getByTestId("cdp-comment-textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("cdp-comment-submit"));
    // The textarea clears optimistically before the server responds
    await waitFor(() => expect(textarea.value).toBe(""));
  });

  it("reverts optimistic comment and restores text on postComment failure", async () => {
    mockFetchComments.mockResolvedValue(EMPTY_THREAD);
    mockPostComment.mockRejectedValue(new Error("Server error: 500"));

    renderPanel();
    await screen.findByText("No comments yet.");

    const textarea = screen.getByTestId("cdp-comment-textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Failing comment" } });
    fireEvent.click(screen.getByTestId("cdp-comment-submit"));

    // Error message appears
    const errMsg = await screen.findByTestId("cdp-comment-error");
    expect(errMsg).toBeInTheDocument();
    expect(errMsg.textContent).toMatch(/Server error/i);

    // Text is restored in the textarea
    expect(textarea.value).toBe("Failing comment");
  });
});

describe("CardDetailPanel — close behaviour", () => {
  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.click(screen.getByTestId("cdp-close-btn"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    const backdrop = document.querySelector(".card-detail-backdrop") as HTMLElement;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("has role=dialog and aria-modal", () => {
    renderPanel();
    const panel = screen.getByTestId("card-detail-panel");
    expect(panel).toHaveAttribute("role", "dialog");
    expect(panel).toHaveAttribute("aria-modal", "true");
  });
});
