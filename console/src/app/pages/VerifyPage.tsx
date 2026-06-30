import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  CheckSquare,
  Clock,
  Circle,
  CheckCircle2,
  AlertCircle,
  Loader2,
  MousePointerClick,
} from "lucide-react";
import { PageLayout, EmptyState } from "../components/PageLayout";
import { VerifyViewer, type VerifyViewerHandle } from "../verify/VerifyViewer";
import { TaskFilterBar } from "../components/TaskFilterBar";
import {
  DEFAULT_FILTER,
  taskMatchesFilter,
  compareTasks,
  type FilterState,
} from "../lib/taskFilter";
import {
  fetchVerifyQueue,
  fetchVerifyFile,
  saveVerdicts,
  type VerdictPatch,
  type VerifyFile,
  type VerifyItem,
  type VerifyRef,
} from "../api/verify";
import { createBug, putTaskStatus } from "../api/tasks-write";
import type { Lane } from "../api/state";
// verify.css is imported by VerifyViewer (single owner — avoids double-load).

type QueueState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; queue: VerifyRef[] };

type FileState =
  | { phase: "loading"; task: string }
  | { phase: "error"; task: string; message: string }
  | { phase: "ready"; file: VerifyFile };

/**
 * Overall verification progress for a queued task's left-list status icon:
 *   todo     = nothing reviewed yet (all pending)  → red
 *   progress = some reviewed, some pending          → amber
 *   done     = every item has a verdict             → green
 * (Outcome — pass/fail/warn — is shown by the coloured count chips, not the icon.)
 */
type ProgressState = "todo" | "progress" | "done";

function progressState(counts: Record<string, number>): ProgressState {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const reviewed = total - (counts.pending ?? 0);
  if (total === 0 || reviewed === 0) return "todo";
  if (reviewed >= total) return "done";
  return "progress";
}

function progressIcon(state: ProgressState) {
  if (state === "done") return <CheckCircle2 size={15} />;
  if (state === "progress") return <Clock size={15} />;
  return <Circle size={15} />;
}

export function VerifyPage() {
  // Master-detail: the queue is always shown on the left; `/verify/:task`
  // selects a pass-file and renders its items on the right (deep-linkable, so
  // Kanban / Dashboard handback cards can link straight to a task).
  const { task: openTask = null } = useParams<{ task: string }>();
  const navigate = useNavigate();
  const [queueState, setQueueState] = useState<QueueState>({ phase: "loading" });
  const [fileState, setFileState] = useState<FileState | null>(null);
  // Bumped to force a re-fetch (Retry) without changing the route.
  const [queueNonce, setQueueNonce] = useState(0);
  const [fileNonce, setFileNonce] = useState(0);

  // Unsaved-changes nav guard: the viewer reports `dirty`; switching tasks while
  // dirty opens a Save / Discard / Cancel confirm.
  const viewerRef = useRef<VerifyViewerHandle>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingTask, setPendingTask] = useState<string | null>(null);

  // Filter/sort for the queue list. Verify items have no archived state and a
  // single status (Ready for Test), so the archived toggle + status sort are
  // omitted (id/title only).
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);

  // ── Load the queue ──
  useEffect(() => {
    const ac = new AbortController();
    setQueueState({ phase: "loading" });
    fetchVerifyQueue(ac.signal)
      .then((queue) => setQueueState({ phase: "ready", queue }))
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setQueueState({
          phase: "error",
          message: err instanceof Error ? err.message : "Could not load queue",
        });
      });
    return () => ac.abort();
  }, [queueNonce]);

  // ── Load the selected file ──
  useEffect(() => {
    if (!openTask) {
      setFileState(null);
      setDirty(false);
      return;
    }
    const ac = new AbortController();
    setFileState({ phase: "loading", task: openTask });
    fetchVerifyFile(openTask, ac.signal)
      .then((file) => setFileState({ phase: "ready", file }))
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setFileState({
          phase: "error",
          task: openTask,
          message: err instanceof Error ? err.message : "Could not load file",
        });
      });
    return () => ac.abort();
  }, [openTask, fileNonce]);

  const handleSave = useCallback(
    (patches: VerdictPatch[]): Promise<VerifyFile> => {
      if (!openTask) return Promise.reject(new Error("No task open"));
      return saveVerdicts(openTask, patches).then((file) => {
        // Refresh the left-list counts + progress icon to reflect the saved verdicts.
        setQueueNonce((n) => n + 1);
        return file;
      });
    },
    [openTask]
  );

  // Flag a failing use case as a bug → create BUG-XXX in the Bug-Fix lane and
  // return its id so the viewer can link it onto the item and persist.
  const handleCreateBug = useCallback(
    (item: VerifyItem): Promise<string> => {
      if (!openTask) return Promise.reject(new Error("No task open"));
      return createBug({
        title: item.title,
        severity: item.severity ?? undefined,
        sourceTask: openTask,
        sourceItem: item.id,
        round: item.round,
        note: item.notes,
      }).then((r) => r.bugId);
    },
    [openTask]
  );

  // Accept the story → move the task to Done in TASKS.md, refresh the queue, and
  // return to the queue view. (Bugs run the same lifecycle, so honour the lane.)
  const handleAccept = useCallback((): Promise<void> => {
    if (!openTask) return Promise.reject(new Error("No task open"));
    const lane: Lane = openTask.startsWith("BUG") ? "bug" : "feature";
    return putTaskStatus(openTask, "Done", lane).then(() => {
      setQueueNonce((n) => n + 1);
      navigate("/verify");
    });
  }, [openTask, navigate]);

  // ── Unsaved-changes nav guard ──
  // Warn on hard navigation (tab close / refresh / external link) while dirty.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Switching tasks in the queue: confirm first if there are unsaved verdicts.
  const requestSwitch = useCallback(
    (task: string) => {
      if (task === openTask) return;
      if (dirty) setPendingTask(task);
      else navigate(`/verify/${task}`);
    },
    [dirty, openTask, navigate]
  );

  const confirmDiscard = useCallback(() => {
    const task = pendingTask;
    setPendingTask(null);
    if (task) navigate(`/verify/${task}`);
  }, [pendingTask, navigate]);

  const confirmSaveThenSwitch = useCallback(async () => {
    const task = pendingTask;
    try {
      await viewerRef.current?.save();
    } catch {
      // Save failed — close the modal but stay so the viewer's error is visible.
      setPendingTask(null);
      return;
    }
    setPendingTask(null);
    if (task) navigate(`/verify/${task}`);
  }, [pendingTask, navigate]);

  // Apply the queue filter/sort (adapt VerifyRef → { id, title }).
  const visibleRefs =
    queueState.phase === "ready"
      ? queueState.queue
          .filter((r) => taskMatchesFilter({ id: r.task, title: r.title }, filter))
          .sort((a, b) =>
            compareTasks(
              { id: a.task, title: a.title },
              { id: b.task, title: b.title },
              filter,
            ),
          )
      : [];

  return (
    <PageLayout
      title="Verify"
      subtitle="Tasks awaiting your verdict — pass-files from .claude/console/verify/"
      badge="Ready for Test"
      badgeVariant="warning"
    >
      {queueState.phase === "ready" && queueState.queue.length > 0 && (
        <TaskFilterBar
          value={filter}
          onChange={setFilter}
          showArchivedToggle={false}
          sortKeys={["id", "title"]}
          searchPlaceholder="Filter tasks…"
        />
      )}

      <div className="vv-split">
        {/* ── Master: the queue ── */}
        <div className="vv-split-list" aria-label="Verify queue">
          {queueState.phase === "loading" && (
            <LoadingPanel label="Loading the verify queue…" />
          )}

          {queueState.phase === "error" && (
            <ErrorPanel
              message={queueState.message}
              onRetry={() => setQueueNonce((n) => n + 1)}
            />
          )}

          {queueState.phase === "ready" && queueState.queue.length === 0 && (
            <div className="vv-queue-empty">
              <EmptyState
                icon={<CheckSquare size={22} />}
                title="No tasks awaiting verdict"
                description="When a task reaches Ready for Test, a pass-file at .claude/console/verify/<TASK-ID>.json appears here for your verdict."
              />
            </div>
          )}

          {queueState.phase === "ready" &&
            queueState.queue.length > 0 &&
            visibleRefs.length === 0 && (
              <div className="vv-queue-empty">
                <EmptyState
                  icon={<CheckSquare size={22} />}
                  title="No matching tasks"
                  description="No queued task matches the current filter. Clear the search to see all tasks awaiting a verdict."
                />
              </div>
            )}

          {queueState.phase === "ready" && visibleRefs.length > 0 && (
            <ul className="vv-queue" role="list">
              {visibleRefs.map((ref) => {
                const active = ref.task === openTask;
                const st = progressState(ref.counts);
                return (
                  <li key={ref.task}>
                    <button
                      type="button"
                      className={`vv-queue-item${active ? " vv-queue-item--active" : ""}`}
                      aria-current={active ? "true" : undefined}
                      onClick={() => requestSwitch(ref.task)}
                    >
                      <span
                        className={`vv-queue-item-icon vv-queue-item-icon--${st}`}
                        title={`Verification: ${st === "done" ? "complete" : st === "progress" ? "in progress" : "not started"}`}
                      >
                        {progressIcon(st)}
                      </span>
                      <div className="vv-queue-item-text">
                        <div className="vv-queue-item-head">
                          <code className="vv-queue-item-task">{ref.task}</code>
                          {ref.title && ref.title !== ref.task && (
                            <span className="vv-queue-item-title">{ref.title}</span>
                          )}
                        </div>
                        <QueueCounts counts={ref.counts} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── Detail: the selected task's items ── */}
        <div className="vv-split-detail">
          {!openTask && (
            <div className="vv-detail-empty">
              <EmptyState
                icon={<MousePointerClick size={22} />}
                title="Select a task"
                description="Choose a task on the left to review its items and record a verdict."
              />
            </div>
          )}

          {openTask && fileState?.phase === "loading" && (
            <LoadingPanel label={`Loading ${fileState.task}…`} />
          )}

          {openTask && fileState?.phase === "error" && (
            <ErrorPanel
              message={fileState.message}
              onRetry={() => setFileNonce((n) => n + 1)}
            />
          )}

          {openTask && fileState?.phase === "ready" && (
            <VerifyViewer
              ref={viewerRef}
              file={fileState.file}
              onSave={handleSave}
              onDirtyChange={setDirty}
              onCreateBug={handleCreateBug}
              onAccept={handleAccept}
            />
          )}
        </div>
      </div>

      {pendingTask && (
        <div
          className="vv-confirm-overlay"
          role="presentation"
          onClick={() => setPendingTask(null)}
        >
          <div
            className="vv-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="vv-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="vv-confirm-title" className="vv-confirm-title">
              Unsaved verdicts
            </h2>
            <p className="vv-confirm-body">
              You have unsaved verdicts for <code>{openTask}</code>. Save them
              before switching to <code>{pendingTask}</code>?
            </p>
            <div className="vv-confirm-actions">
              <button
                type="button"
                className="vv-btn vv-btn--ghost"
                onClick={() => setPendingTask(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="vv-btn vv-btn--ghost"
                onClick={confirmDiscard}
              >
                Discard
              </button>
              <button
                type="button"
                className="vv-btn vv-btn--primary"
                onClick={() => void confirmSaveThenSwitch()}
              >
                Save &amp; switch
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

function QueueCounts({ counts }: { counts: Record<string, number> }) {
  const order = ["pending", "pass", "fail", "warn", "blocked"];
  const present = order.filter((v) => (counts[v] ?? 0) > 0);
  if (present.length === 0) {
    return <span className="vv-queue-counts vv-queue-counts--none">no items</span>;
  }
  return (
    <span className="vv-queue-counts">
      {present.map((v) => (
        <span key={v} className={`vv-queue-count vv-rollup-bar--${v}`}>
          <span className="vv-queue-count-dot" />
          {counts[v]} {v}
        </span>
      ))}
    </span>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className="vv-state-panel" role="status" aria-live="polite">
      <Loader2 size={20} className="vv-spinner" />
      <span className="vv-state-panel-label">{label}</span>
    </div>
  );
}

function ErrorPanel({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="vv-state-panel vv-state-panel--error" role="alert">
      <AlertCircle size={20} />
      <span className="vv-state-panel-label">{message}</span>
      <button type="button" className="vv-btn vv-btn--ghost" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
