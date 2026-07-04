/**
 * CardDetailPanel — right-hand drawer for a selected task card (TASK-012).
 *
 * Responsibilities:
 *  - Fetch full task detail (fetchTaskDetail) + comments (fetchComments)
 *  - Inline status <select> that calls putTaskStatus on change
 *  - Comments thread (newest-last) with relative time and author
 *  - Add-comment textarea + Send (postComment, optimistic append)
 *  - Close on Esc and on overlay click; focus trap; return focus to opener
 *
 * A11y:
 *  - role="dialog" aria-modal aria-labelledby
 *  - Focus trap: tab cycles within the panel; Escape closes
 *  - Returns focus to the card that opened the panel on close
 *
 * This component is purely presentational relative to the card list —
 * the KanbanPage owns the optimistic board state; this panel shows
 * supplementary detail + comments for the selected task.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { X, Loader2, MessageSquare, AlertTriangle, Send, Archive, ArchiveRestore } from "lucide-react";
import {
  fetchTaskDetail,
  fetchComments,
  putTaskStatus,
  putTaskArchived,
  postComment,
  type TaskDetail,
  type Comment,
  type CommentThread,
} from "../api/tasks-write.js";
import type { Lane, TaskBoardColumn } from "../api/state.js";
import { fetchVerifyFile, isComplete } from "../api/verify.js";
import { statusRank } from "../lib/taskFilter.js";
import "../../styles/card-detail.css";

// ── Relative-time formatter ───────────────────────────────────────────────

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "short" });

function relativeTime(isoTs: string): string {
  const diffMs = new Date(isoTs).getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, "seconds");
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minutes");
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hours");
  return rtf.format(diffDay, "days");
}

// ── Focus-trap helper ─────────────────────────────────────────────────────

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function trapFocus(e: KeyboardEvent, container: HTMLElement): void {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (n) => !n.closest("[inert]"),
  );
  if (nodes.length === 0) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey) {
    if (document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

// ── Sub-components ────────────────────────────────────────────────────────

function CommentItem({ comment }: { comment: Comment }) {
  return (
    <div className="cdp-comment">
      <div className="cdp-comment-meta">
        <span className="cdp-comment-author">{comment.author}</span>
        <span className="cdp-comment-ts" title={comment.ts}>
          {relativeTime(comment.ts)}
        </span>
      </div>
      <p className="cdp-comment-body">{comment.body}</p>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────

interface CardDetailPanelProps {
  taskId: string;
  /** All columns for this task's lane, used to populate the status <select>. */
  columns: TaskBoardColumn[];
  /** Current lane (needed when calling putTaskStatus). */
  lane: Lane;
  /** Called after a successful status change so the board can update optimistically. */
  onStatusChange?: (taskId: string, newStatus: string, lane: Lane) => void;
  /** Called after a successful archive/unarchive so the board can re-fetch. */
  onArchivedChange?: (taskId: string, archived: boolean) => void;
  /** Called when the panel is dismissed. */
  onClose: () => void;
  /** The element to return focus to when the panel closes. */
  returnFocusTo?: HTMLElement | null;
}

type DetailPhase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; detail: TaskDetail };

type CommentsPhase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; thread: CommentThread };

type StatusSavePhase = "idle" | "saving" | "error";
type CommentPostPhase = "idle" | "posting" | "error";

// ── Main component ────────────────────────────────────────────────────────

export function CardDetailPanel({
  taskId,
  columns,
  lane,
  onStatusChange,
  onArchivedChange,
  onClose,
  returnFocusTo,
}: CardDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // ── Load task detail ────────────────────────────────────────────────────
  const [detailPhase, setDetailPhase] = useState<DetailPhase>({ kind: "loading" });
  const [commentsPhase, setCommentsPhase] = useState<CommentsPhase>({ kind: "loading" });
  // Count of this task's verify-file items that are NOT terminal-good (pass/cr)
  // — used only by the Done-dropdown guard below. null = no verify file / not
  // loaded yet / fetch failed; the guard then falls back to the pre-Verify
  // check alone rather than blocking on an unknown.
  const [unverifiedCount, setUnverifiedCount] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    setDetailPhase({ kind: "loading" });
    setCommentsPhase({ kind: "loading" });
    setUnverifiedCount(null);

    fetchTaskDetail(taskId)
      .then((detail) => {
        if (live) setDetailPhase({ kind: "ready", detail });
      })
      .catch((err: unknown) => {
        if (live)
          setDetailPhase({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
      });

    fetchComments(taskId)
      .then((thread) => {
        if (live) setCommentsPhase({ kind: "ready", thread });
      })
      .catch((err: unknown) => {
        if (live)
          setCommentsPhase({
            kind: "error",
            message: err instanceof Error ? err.message : String(err),
          });
      });

    // Best-effort: most tasks won't have a verify file yet (pre-Verify), and a
    // 404 there is normal, not an error — the dropdown guard below just falls
    // back to the pre-Verify check alone when this stays null.
    fetchVerifyFile(taskId)
      .then((file) => {
        if (live) setUnverifiedCount(file.items.filter((it) => !isComplete(it.verdict)).length);
      })
      .catch(() => {
        /* no verify file yet, or unreadable — leave unverifiedCount null */
      });

    return () => {
      live = false;
    };
  }, [taskId]);

  // ── Focus management ────────────────────────────────────────────────────
  // Focus the first focusable element inside the panel on open.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const first = panel.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, []);

  // Restore focus on unmount.
  useEffect(() => {
    return () => {
      returnFocusTo?.focus();
    };
  }, [returnFocusTo]);

  // Keyboard handling: Esc = close, Tab = trap within panel.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        trapFocus(e, panelRef.current);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // ── Inline status change ────────────────────────────────────────────────
  const [statusSavePhase, setStatusSavePhase] = useState<StatusSavePhase>("idle");
  const [statusError, setStatusError] = useState("");

  const currentStatus =
    detailPhase.kind === "ready" ? detailPhase.detail.status : "";

  const handleStatusChange = useCallback(
    async (newStatus: string) => {
      if (newStatus === currentStatus) return;

      // Dropdown guard (manual override, change 6): jumping straight to Done
      // from anywhere is still allowed, but when the task hasn't been through
      // Verify yet, or its verify file still has unverified use cases, an
      // explicit confirm shows the truth first rather than silently skipping
      // the human gate. window.confirm is used deliberately here (not a
      // custom modal) — this is a rare safety-net path, not the primary flow.
      if (newStatus.trim().toLowerCase() === "done") {
        const preVerify = statusRank(currentStatus) < statusRank("Verify");
        const unverified = unverifiedCount ?? 0;
        if (preVerify || unverified > 0) {
          const reason =
            unverified > 0
              ? `${unverified} use case${unverified === 1 ? "" : "s"} unverified — mark Done anyway?`
              : "This task hasn't reached Verify yet — mark Done anyway?";
          if (!window.confirm(reason)) return;
        }
      }

      setStatusSavePhase("saving");
      setStatusError("");
      try {
        // Same completion bookkeeping as the normal path (there is no
        // additional verify-file bookkeeping on the Accept & Done path today
        // — putTaskStatus is the whole of it; the Verify queue filter (change
        // 5) reads the board status directly, so moving here keeps it consistent).
        await putTaskStatus(taskId, newStatus, lane);
        setStatusSavePhase("idle");
        // Update the detail panel's local view of the current status
        setDetailPhase((prev) =>
          prev.kind === "ready"
            ? { kind: "ready", detail: { ...prev.detail, status: newStatus } }
            : prev,
        );
        onStatusChange?.(taskId, newStatus, lane);
      } catch (err) {
        setStatusSavePhase("error");
        setStatusError(err instanceof Error ? err.message : "Status update failed");
      }
    },
    [taskId, lane, currentStatus, unverifiedCount, onStatusChange],
  );

  // ── Archive / unarchive ──────────────────────────────────────────────────
  const [archiveSaving, setArchiveSaving] = useState(false);
  const [archiveError, setArchiveError] = useState("");

  const handleArchiveToggle = useCallback(async () => {
    if (detailPhase.kind !== "ready") return;
    const next = !detailPhase.detail.archived;
    setArchiveSaving(true);
    setArchiveError("");
    try {
      await putTaskArchived(taskId, next);
      setDetailPhase((prev) =>
        prev.kind === "ready"
          ? { kind: "ready", detail: { ...prev.detail, archived: next } }
          : prev,
      );
      onArchivedChange?.(taskId, next);
    } catch (err) {
      setArchiveError(err instanceof Error ? err.message : "Archive failed");
    } finally {
      setArchiveSaving(false);
    }
  }, [detailPhase, taskId, onArchivedChange]);

  // ── Comment posting ─────────────────────────────────────────────────────
  const [commentText, setCommentText] = useState("");
  const [commentPostPhase, setCommentPostPhase] = useState<CommentPostPhase>("idle");
  const [commentPostError, setCommentPostError] = useState("");

  const handlePostComment = useCallback(async () => {
    const body = commentText.trim();
    if (!body) return;
    setCommentPostPhase("posting");
    setCommentPostError("");

    // Optimistic append
    const optimisticComment: Comment = {
      id: `optimistic-${Date.now()}`,
      author: "human",
      ts: new Date().toISOString(),
      body,
    };
    setCommentsPhase((prev) => {
      if (prev.kind !== "ready") return prev;
      return {
        kind: "ready",
        thread: {
          ...prev.thread,
          comments: [...prev.thread.comments, optimisticComment],
        },
      };
    });
    setCommentText("");

    try {
      const updated = await postComment(taskId, body);
      setCommentsPhase({ kind: "ready", thread: updated });
      setCommentPostPhase("idle");
    } catch (err) {
      // Revert optimistic append
      setCommentsPhase((prev) => {
        if (prev.kind !== "ready") return prev;
        return {
          kind: "ready",
          thread: {
            ...prev.thread,
            comments: prev.thread.comments.filter(
              (c) => c.id !== optimisticComment.id,
            ),
          },
        };
      });
      setCommentText(body); // restore the typed text
      setCommentPostPhase("error");
      setCommentPostError(err instanceof Error ? err.message : "Comment failed");
    }
  }, [taskId, commentText]);

  // Allow Ctrl+Enter / Cmd+Enter to submit.
  const handleCommentKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        void handlePostComment();
      }
    },
    [handlePostComment],
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop — click outside to close */}
      <div
        className="card-detail-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="card-detail-panel"
        data-testid="card-detail-panel"
      >
        {/* Header */}
        <div className="cdp-header">
          <div className="cdp-header-content">
            <div className="cdp-header-meta">
              <code className="cdp-task-id">{taskId}</code>
              <span className={`cdp-lane-badge${lane === "bug" ? " cdp-lane-badge--bug" : ""}`}>
                {lane}
              </span>
            </div>
            {detailPhase.kind === "ready" ? (
              <h2 id={titleId} className="cdp-title">
                {detailPhase.detail.title}
              </h2>
            ) : (
              <h2 id={titleId} className="cdp-title">
                {taskId}
              </h2>
            )}
          </div>
          <button
            type="button"
            className="cdp-close-btn"
            onClick={onClose}
            aria-label="Close detail panel"
            data-testid="cdp-close-btn"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        {/* Status row */}
        <div className="cdp-status-row">
          <span className="cdp-status-label">Status</span>
          {detailPhase.kind === "loading" ? (
            <span className="cdp-status-saving">Loading…</span>
          ) : detailPhase.kind === "error" ? (
            <span className="cdp-inline-error">—</span>
          ) : (
            <select
              className="cdp-status-select"
              value={detailPhase.detail.status}
              disabled={statusSavePhase === "saving"}
              onChange={(e) => void handleStatusChange(e.target.value)}
              aria-label="Change task status"
              data-testid="cdp-status-select"
            >
              {columns.map((col) => (
                <option key={col.status} value={col.status}>
                  {col.status}
                </option>
              ))}
            </select>
          )}
          {statusSavePhase === "saving" && (
            <span className="cdp-status-saving">Saving…</span>
          )}
          {statusSavePhase === "error" && (
            <span
              className="cdp-inline-error"
              role="alert"
              data-testid="cdp-status-error"
            >
              {statusError}
            </span>
          )}

          <button
            type="button"
            className="cdp-archive-btn"
            onClick={() => void handleArchiveToggle()}
            disabled={archiveSaving || detailPhase.kind !== "ready"}
            data-testid="cdp-archive-btn"
            title={
              detailPhase.kind === "ready" && detailPhase.detail.archived
                ? "Unarchive this task"
                : "Archive this task (hidden by default in lists)"
            }
          >
            {detailPhase.kind === "ready" && detailPhase.detail.archived ? (
              <>
                <ArchiveRestore size={13} aria-hidden="true" />
                Unarchive
              </>
            ) : (
              <>
                <Archive size={13} aria-hidden="true" />
                Archive
              </>
            )}
          </button>
          {archiveError && (
            <span className="cdp-inline-error" role="alert" data-testid="cdp-archive-error">
              {archiveError}
            </span>
          )}
        </div>

        {/* Scrollable body */}
        <div className="cdp-body">
          {/* Task body lines */}
          <section aria-label="Task description">
            <p className="cdp-section-title">Description</p>
            {detailPhase.kind === "loading" && (
              <div className="cdp-inline-state" aria-live="polite">
                <Loader2 size={14} aria-hidden="true" />
                Loading…
              </div>
            )}
            {detailPhase.kind === "error" && (
              <p className="cdp-inline-error" role="alert">
                <AlertTriangle size={13} aria-hidden="true" /> {detailPhase.message}
              </p>
            )}
            {detailPhase.kind === "ready" &&
              (detailPhase.detail.body.length === 0 ? (
                <p className="cdp-body-empty">No description.</p>
              ) : (
                <div className="cdp-body-lines">
                  {detailPhase.detail.body.map((line, i) => (
                    // body lines from TASKS.md — stable index key is fine, lines are static
                    // eslint-disable-next-line react/no-array-index-key
                    <p key={i} className="cdp-body-line">
                      {line}
                    </p>
                  ))}
                </div>
              ))}
          </section>

          {/* Comments */}
          <section aria-label="Comments">
            <p className="cdp-section-title">
              <MessageSquare size={11} className="cdp-section-icon" aria-hidden="true" />
              Comments
            </p>

            {commentsPhase.kind === "loading" && (
              <div className="cdp-inline-state" aria-live="polite">
                <Loader2 size={14} aria-hidden="true" />
                Loading comments…
              </div>
            )}
            {commentsPhase.kind === "error" && (
              <p className="cdp-inline-error" role="alert">
                <AlertTriangle size={13} aria-hidden="true" /> {commentsPhase.message}
              </p>
            )}
            {commentsPhase.kind === "ready" && (
              <>
                {commentsPhase.thread.comments.length === 0 ? (
                  <p className="cdp-comments-empty">No comments yet.</p>
                ) : (
                  <div
                    className="cdp-comments-list"
                    data-testid="cdp-comments-list"
                    aria-live="polite"
                    aria-label="Comment thread"
                  >
                    {commentsPhase.thread.comments.map((c) => (
                      <CommentItem key={c.id} comment={c} />
                    ))}
                  </div>
                )}

                {/* Add comment */}
                <div className="cdp-add-comment cdp-add-comment--spaced">
                  <textarea
                    className="cdp-comment-textarea"
                    placeholder="Add a comment (Ctrl+Enter to send)…"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={handleCommentKeyDown}
                    disabled={commentPostPhase === "posting"}
                    aria-label="New comment"
                    data-testid="cdp-comment-textarea"
                    rows={3}
                  />
                  <div className="cdp-comment-actions">
                    {commentPostPhase === "error" && (
                      <span
                        className="cdp-comment-submit-msg cdp-comment-submit-msg--error"
                        role="alert"
                        data-testid="cdp-comment-error"
                      >
                        {commentPostError}
                      </span>
                    )}
                    <button
                      type="button"
                      className="cdp-btn cdp-btn--primary"
                      onClick={() => void handlePostComment()}
                      disabled={!commentText.trim() || commentPostPhase === "posting"}
                      aria-label="Send comment"
                      data-testid="cdp-comment-submit"
                    >
                      <Send size={12} aria-hidden="true" />
                      {commentPostPhase === "posting" ? "Sending…" : "Send"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
