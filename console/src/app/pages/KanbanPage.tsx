/**
 * KanbanPage — task board (read + click navigation).
 *
 * DEC-015: drag-and-drop was removed. A tile is a TASK, but verification happens
 * per sub-task in the Verify page, so dragging whole tasks between status columns
 * didn't map to the flow (and confused status-write with verify-verdict). Cards
 * are click targets:
 *   - a verifiable card (Ready for Test / Verify) → navigates to /verify/:id
 *   - the detail button (and a non-verifiable card click) → opens the
 *     CardDetailPanel drawer (full detail + inline status select + comments)
 * Lane tabs, canonical column order, and live-refresh (useAsync/SSE) preserved.
 */

import { Fragment, useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Circle,
  Clock,
  CheckCircle2,
  AlertCircle,
  Ban,
  ArrowRight,
  ExternalLink,
  Layers,
  Bug,
} from "lucide-react";
import { PageLayout, EmptyState } from "../components/PageLayout";
import { fetchTasks, type Lane, type TaskBoardColumn, type TaskItem, type TaskBoard } from "../api/state";
import { useAsync, LoadingState, ErrorState } from "./lib";
import { CardDetailPanel } from "../components/CardDetailPanel";
import { TaskFilterBar } from "../components/TaskFilterBar";
import {
  DEFAULT_FILTER,
  filterAndSortTasks,
  statusRank,
  type FilterState,
} from "../lib/taskFilter";
import "../../styles/pages.css";
import "../../styles/kanban-dnd.css";

// ── Column colour helpers ─────────────────────────────────────────────────

type ColorKey = "active" | "review" | "todo" | "done" | "blocked";

function columnStyle(status: string): { colorKey: ColorKey; icon: React.ReactNode } {
  const s = status.toLowerCase();
  if (s.includes("in progress") || s.includes("fixing")) {
    return { colorKey: "active", icon: <Clock size={12} /> };
  }
  if (s.includes("ready for review")) {
    return { colorKey: "review", icon: <AlertCircle size={12} /> };
  }
  if (s.includes("ready for test") || s.includes("verify")) {
    return { colorKey: "review", icon: <CheckCircle2 size={12} /> };
  }
  if (s.includes("done")) {
    return { colorKey: "done", icon: <CheckCircle2 size={12} /> };
  }
  if (s.includes("reported") || s.includes("blocked")) {
    return { colorKey: "blocked", icon: <Ban size={12} /> };
  }
  return { colorKey: "todo", icon: <Circle size={12} /> };
}

function isVerifiable(status: string): boolean {
  const s = status.toLowerCase();
  return s.includes("ready for test") || s.includes("verify");
}

// Canonical lifecycle order so columns always read left→right backlog→done in
// BOTH lanes (Todo/Reported first, Done last), regardless of TASKS.md document
// order. `statusRank` is shared with the filter/sort model (taskFilter.ts).
function sortColumns(cols: TaskBoardColumn[]): TaskBoardColumn[] {
  return [...cols].sort((a, b) => statusRank(a.status) - statusRank(b.status));
}

// Insert zero-width break opportunities after path separators so a long unbroken
// token (e.g. `.claude/framework/console/`) wraps at a `/` in a narrow card
// instead of spilling over the edge. The CSS `overflow-wrap` on .task-card-title
// is the last-resort fallback for a single over-long segment.
function withSlashBreaks(text: string): React.ReactNode {
  const parts = text.split(/(?<=[/\\])/); // keep each separator with its chunk
  if (parts.length === 1) return text;
  return parts.map((part, i) => (
    <Fragment key={i}>
      {part}
      {i < parts.length - 1 && <wbr />}
    </Fragment>
  ));
}

// ── Card ───────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: TaskItem;
  onOpenDetail: (task: TaskItem, opener: HTMLElement) => void;
}

function TaskCard({ task, onOpenDetail }: TaskCardProps) {
  const verifiable = isVerifiable(task.status);

  const inner = (
    <>
      <div className="task-card-header">
        <code className="task-card-id">{task.id}</code>
        <div className="task-card-header-actions">
          {task.archived && (
            <span className="task-card-archived-badge" title="Archived">
              Archived
            </span>
          )}
          {verifiable && (
            <span className="task-card-verify-cue">
              Verify <ArrowRight size={11} />
            </span>
          )}
          {/* Detail button — opens the popout; stop the click from following the
              card link / re-triggering the card's own click. */}
          <button
            type="button"
            className="task-card-detail-btn"
            aria-label={`Open details for ${task.id}`}
            data-testid={`open-detail-${task.id}`}
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onOpenDetail(task, e.currentTarget);
            }}
          >
            <ExternalLink size={11} aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="task-card-title">{withSlashBreaks(task.title)}</p>
    </>
  );

  // Verifiable card → the whole card navigates to the Verify page.
  if (verifiable) {
    return (
      <Link
        to={`/verify/${task.id}`}
        className={`task-card task-card--link${task.archived ? " task-card--archived" : ""}`}
        data-testid={`task-card-${task.id}`}
        aria-label={`Verify ${task.id}: ${task.title}`}
      >
        {inner}
      </Link>
    );
  }

  // Non-verifiable card → opens the detail popout.
  return (
    <div
      className={`task-card task-card--clickable${task.archived ? " task-card--archived" : ""}`}
      data-testid={`task-card-${task.id}`}
      role="button"
      tabIndex={0}
      aria-label={`${task.id}: ${task.title}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail(task, e.currentTarget);
        }
      }}
      onClick={(e) => onOpenDetail(task, e.currentTarget)}
    >
      {inner}
    </div>
  );
}

// ── Column ───────────────────────────────────────────────────────────────────

interface ColumnProps {
  column: TaskBoardColumn;
  filter: FilterState;
  onOpenDetail: (task: TaskItem, opener: HTMLElement) => void;
}

function Column({ column, filter, onOpenDetail }: ColumnProps) {
  const { colorKey, icon } = columnStyle(column.status);
  // Apply the active filter/sort to this column's cards. The header count
  // reflects what's actually visible.
  const items = filterAndSortTasks(column.items, filter);
  return (
    <div className="kanban-column">
      <div className={`kanban-column-header kanban-column-header--${colorKey}`}>
        <span className="kanban-column-icon">{icon}</span>
        <span className="kanban-column-status">{column.status}</span>
        <span className="kanban-column-count">{items.length}</span>
      </div>
      <div
        className="kanban-column-body"
        data-testid={`column-${column.lane}-${column.status}`}
      >
        {items.length === 0 ? (
          <div className="kanban-column-empty">—</div>
        ) : (
          items.map((t) => (
            <TaskCard key={t.id} task={t} onOpenDetail={onOpenDetail} />
          ))
        )}
      </div>
    </div>
  );
}

// ── Lane board ──────────────────────────────────────────────────────────────

interface LaneBoardProps {
  lane: Lane;
  columns: TaskBoardColumn[];
  filter: FilterState;
  onOpenDetail: (task: TaskItem, opener: HTMLElement) => void;
}

function LaneBoard({ lane, columns, filter, onOpenDetail }: LaneBoardProps) {
  const laneColumns = sortColumns(columns.filter((c) => c.lane === lane));
  if (laneColumns.length === 0) {
    return <div className="kanban-lane-empty">No columns in this lane yet.</div>;
  }
  return (
    <div className="kanban-board">
      {laneColumns.map((col) => (
        <Column
          key={`${col.lane}:${col.status}`}
          column={col}
          filter={filter}
          onOpenDetail={onOpenDetail}
        />
      ))}
    </div>
  );
}

// ── Optimistic board helper (used by the detail popout's inline status change) ──

/**
 * Move a task card from its current column to a target column in the board.
 * Returns a new TaskBoard with the card relocated; the original is not mutated.
 */
export function applyOptimisticMove(
  board: TaskBoard,
  taskId: string,
  targetStatus: string,
  targetLane: Lane,
): TaskBoard {
  let moved: TaskItem | undefined;
  const columns = board.columns.map((col) => {
    const idx = col.items.findIndex((t) => t.id === taskId);
    if (idx === -1) return col;
    moved = { ...col.items[idx], status: targetStatus, lane: targetLane };
    return { ...col, items: col.items.filter((_, i) => i !== idx) };
  });

  if (!moved) return board; // task not found — leave board unchanged

  const withItem = columns.map((col) => {
    if (col.status === targetStatus && col.lane === targetLane) {
      return { ...col, items: [...col.items, moved!] };
    }
    return col;
  });

  return { columns: withItem };
}

// ── Root KanbanPage ───────────────────────────────────────────────────────

interface OpenPanel {
  task: TaskItem;
  openerElement: HTMLElement;
}

export function KanbanPage() {
  const { phase, data, error, reload } = useAsync(fetchTasks, []);

  // Optimistic overlay so a status change from the popout reflects immediately.
  const [optimisticBoard, setOptimisticBoard] = useState<TaskBoard | null>(null);
  const [openPanel, setOpenPanel] = useState<OpenPanel | null>(null);
  // Initial lane can be deep-linked (e.g. the dashboard "Open Bugs" tile →
  // /kanban?lane=bug). Defaults to the feature lane.
  const [searchParams] = useSearchParams();
  const [selectedLane, setSelectedLane] = useState<Lane>(
    searchParams.get("lane") === "bug" ? "bug" : "feature"
  );
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER);

  const board = optimisticBoard ?? (phase === "ready" ? data : null);

  // CRITICAL fix (mirrors VerifyViewer.tsx's "CRITICAL fix #1"): once a fresh,
  // authoritative board actually lands (`phase === "ready"` with new `data`),
  // drop the optimistic overlay so the reconciled board wins. Without this,
  // a single inline status change froze the board on its optimistic snapshot
  // forever — useAsync's SSE-triggered refetches (lib.tsx) updated `data`, but
  // `board` above preferred `optimisticBoard` unconditionally, so a server-side
  // auto-move (e.g. Verify → Done) never appeared until nav-away/back. Gated on
  // `phase === "ready"` (not just on `data` changing) so the transient
  // "loading" dip mid-reload doesn't prematurely clear the bridge and flash an
  // empty board before the refreshed data is actually in hand.
  useEffect(() => {
    if (phase === "ready") {
      setOptimisticBoard(null);
    }
  }, [data, phase]);

  const laneItemCount = (lane: Lane): number =>
    board
      ? board.columns
          .filter((c) => c.lane === lane)
          .reduce((n, c) => n + c.items.length, 0)
      : 0;

  const handleOpenDetail = useCallback((task: TaskItem, opener: HTMLElement) => {
    setOpenPanel({ task, openerElement: opener });
  }, []);

  const handleClosePanel = useCallback(() => {
    setOpenPanel(null);
    // Focus return is handled inside CardDetailPanel's unmount effect.
  }, []);

  // The popout's inline status select wrote back to TASKS.md — reflect it on the
  // board optimistically, then let the SSE live-refresh reconcile from disk.
  const handleStatusChangeFromPanel = useCallback(
    (taskId: string, newStatus: string, lane: Lane) => {
      if (!board) return;
      setOptimisticBoard(applyOptimisticMove(board, taskId, newStatus, lane));
      reload();
    },
    [board, reload],
  );

  // Archiving from the popout: the archived flag lives in TASKS.md, so just
  // re-fetch the board (the card hides itself if "Show archived" is off). Drop
  // any optimistic overlay so the fresh, reconciled board wins.
  const handleArchivedChangeFromPanel = useCallback(() => {
    setOptimisticBoard(null);
    reload();
  }, [reload]);

  const panelLaneColumns =
    board && openPanel
      ? sortColumns(board.columns.filter((c) => c.lane === openPanel.task.lane))
      : [];

  return (
    <PageLayout
      title="Kanban Board"
      subtitle="Click a card to verify it, or open its details — reads .claude/TASKS.md"
      badge="TASKS.md"
    >
      {phase === "loading" && !board && <LoadingState label="Loading task board…" />}
      {phase === "error" && !board && <ErrorState error={error} onRetry={reload} />}

      {board &&
        (board.columns.length === 0 ? (
          <EmptyState
            title="No tasks yet"
            description="Nothing has been parsed from .claude/TASKS.md. Once tasks exist, the feature and bug-fix lanes will render here."
          />
        ) : (
          <>
            <div className="kanban-lane-tabs" role="tablist" aria-label="Task lane">
              <button
                type="button"
                role="tab"
                aria-selected={selectedLane === "feature" ? "true" : "false"}
                className={`kanban-lane-tab${selectedLane === "feature" ? " kanban-lane-tab--active" : ""}`}
                onClick={() => setSelectedLane("feature")}
              >
                <Layers size={14} aria-hidden="true" />
                Feature Lane
                <span className="kanban-lane-tab-count">{laneItemCount("feature")}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={selectedLane === "bug" ? "true" : "false"}
                className={`kanban-lane-tab${selectedLane === "bug" ? " kanban-lane-tab--active" : ""}`}
                onClick={() => setSelectedLane("bug")}
              >
                <Bug size={14} aria-hidden="true" />
                Bug-Fix Lane
                <span className="kanban-lane-tab-count">{laneItemCount("bug")}</span>
              </button>
            </div>

            <TaskFilterBar value={filter} onChange={setFilter} />

            <LaneBoard
              lane={selectedLane}
              columns={board.columns}
              filter={filter}
              onOpenDetail={handleOpenDetail}
            />
          </>
        ))}

      {openPanel && (
        <CardDetailPanel
          taskId={openPanel.task.id}
          columns={panelLaneColumns}
          lane={openPanel.task.lane}
          onStatusChange={handleStatusChangeFromPanel}
          onArchivedChange={handleArchivedChangeFromPanel}
          onClose={handleClosePanel}
          returnFocusTo={openPanel.openerElement}
        />
      )}
    </PageLayout>
  );
}
