/**
 * ToolRail.tsx — the right-hand chronological tool LEDGER of the Sessions view.
 *
 * Every tool call of the loaded window, in order: icon + name + one-line
 * summary; click a card to expand the (truncated) result in place; "Open full
 * result" fetches the untruncated text from /tools/:toolUseId (cached, and
 * gracefully absent on the pre-pagination backend). Per-tool + errors-only
 * filters, and a mini activity timeline for orientation in long runs.
 * Virtualized like the conversation (a big session has thousands of calls).
 */

import { forwardRef, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CornerUpLeft,
  Loader2,
  PanelRightClose,
  TriangleAlert,
} from "lucide-react";
import { fetchToolResult } from "../api/sessions";
import { ApiError } from "../api/state";
import type { LedgerEntry, RailFilter } from "./rows";
import { buildTimeline, filterLedger } from "./rows";
import { toolIcon } from "./toolIcons";
import { VirtualList, type VirtualListHandle } from "./VirtualList";

export interface ToolRailProps {
  sessionId: string;
  ledger: LedgerEntry[];
  toolCounts: [string, number][];
  errorCount: number;
  filter: RailFilter;
  onFilterChange: (f: RailFilter) => void;
  /** Group key to highlight (chip → rail sync). */
  highlightGroupKey: string | null;
  /** Individual entry highlight (call → rail sync). */
  highlightToolUseId: string | null;
  expanded: ReadonlySet<string>;
  onToggleExpand: (toolUseId: string) => void;
  onJumpToTurn: (entry: LedgerEntry) => void;
  onClose: () => void;
  /** The current agent is live — the newest un-resulted call shows "running". */
  live: boolean;
}

const EST_COLLAPSED = 46;
const EST_EXPANDED = 240;

/** Max filter pills before the tail tools collapse into the All pill only. */
const MAX_TOOL_PILLS = 4;

export const ToolRail = forwardRef<VirtualListHandle, ToolRailProps>(
  function ToolRail(props, listRef) {
    const { ledger, toolCounts, errorCount, filter, onFilterChange, onClose } =
      props;

    const filtered = useMemo(
      () => filterLedger(ledger, filter),
      [ledger, filter],
    );
    const timeline = useMemo(() => buildTimeline(ledger), [ledger]);

    const items = useMemo(
      () =>
        filtered.map((e) => ({
          key: e.toolUseId || `i${e.index}`,
          entry: e,
        })),
      [filtered],
    );

    return (
      <aside className="sess-rail" aria-label="Tool activity">
        <header className="sess-rail-head">
          <span className="sess-rail-title">
            Tool activity
            <span className="sess-rail-count">{ledger.length}</span>
          </span>
          <button
            type="button"
            className="sess-rail-close"
            onClick={onClose}
            title="Hide tool rail (t)"
            aria-label="Hide tool rail"
          >
            <PanelRightClose size={14} aria-hidden="true" />
          </button>
        </header>

        <div
          className="sess-rail-filters"
          role="toolbar"
          aria-label="Filter tool calls"
        >
          <FilterPill
            label="All"
            count={ledger.length}
            active={filter === "all"}
            onClick={() => onFilterChange("all")}
          />
          {toolCounts.slice(0, MAX_TOOL_PILLS).map(([name, n]) => (
            <FilterPill
              key={name}
              label={name}
              count={n}
              active={typeof filter === "object" && filter.tool === name}
              onClick={() =>
                onFilterChange(
                  typeof filter === "object" && filter.tool === name
                    ? "all"
                    : { tool: name },
                )
              }
            />
          ))}
          {errorCount > 0 && (
            <FilterPill
              label="Errors"
              count={errorCount}
              active={filter === "errors"}
              danger
              onClick={() =>
                onFilterChange(filter === "errors" ? "all" : "errors")
              }
            />
          )}
        </div>

        {timeline.length > 1 && (
          <Timeline
            timeline={timeline}
            total={ledger.length}
            onSeek={(ledgerIndex) => {
              const e = ledger[ledgerIndex];
              if (!e) return;
              onFilterChange("all");
              // scroll happens next frame, once the unfiltered list renders
              requestAnimationFrame(() => {
                (
                  listRef as React.RefObject<VirtualListHandle>
                )?.current?.scrollToKey(e.toolUseId || `i${e.index}`, "start");
              });
            }}
          />
        )}

        {items.length === 0 ? (
          <div className="sess-rail-empty">
            {ledger.length === 0 ? (
              <>No tool calls in the loaded turns.</>
            ) : (
              <>
                No matches for this filter.
                <button
                  type="button"
                  className="sess-expand-btn"
                  onClick={() => onFilterChange("all")}
                >
                  Show all
                </button>
              </>
            )}
          </div>
        ) : (
          <VirtualList
            ref={listRef}
            items={items}
            estimateHeight={(it) =>
              props.expanded.has(it.entry.toolUseId)
                ? EST_EXPANDED
                : EST_COLLAPSED
            }
            className="sess-rail-list"
            aria-label="Tool calls"
            renderRow={(it) => (
              <ToolCallCard
                entry={it.entry}
                rail={props}
                isLast={it.entry.index === ledger.length - 1}
              />
            )}
          />
        )}
      </aside>
    );
  },
);

function FilterPill({
  label,
  count,
  active,
  danger,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`sess-filter-pill${active ? " is-active" : ""}${danger ? " is-danger" : ""}`}
      aria-pressed={active ? "true" : "false"}
      onClick={onClick}
    >
      {danger && <TriangleAlert size={10} aria-hidden="true" />}
      {label}
      <span className="sess-filter-pill-n">{count}</span>
    </button>
  );
}

function Timeline({
  timeline,
  total,
  onSeek,
}: {
  timeline: ReturnType<typeof buildTimeline>;
  total: number;
  onSeek: (ledgerIndex: number) => void;
}) {
  const max = Math.max(1, ...timeline.map((b) => b.count));
  return (
    <div className="sess-rail-timeline" aria-label="Activity timeline">
      {timeline.map((b, i) => (
        <button
          key={i}
          type="button"
          className={`sess-timeline-bar${b.errors > 0 ? " has-error" : ""}`}
          style={{ height: `${20 + (b.count / max) * 80}%` }}
          title={`Calls ${b.start + 1}–${Math.min(total, b.start + b.count)}${b.errors > 0 ? ` · ${b.errors} error${b.errors === 1 ? "" : "s"}` : ""}`}
          aria-label={`Jump to call ${b.start + 1}`}
          onClick={() => onSeek(b.start)}
        />
      ))}
    </div>
  );
}

/* ── Card ── */

function ToolCallCard({
  entry,
  rail,
  isLast,
}: {
  entry: LedgerEntry;
  rail: ToolRailProps;
  isLast: boolean;
}) {
  const expanded = rail.expanded.has(entry.toolUseId);
  const highlighted =
    rail.highlightToolUseId === entry.toolUseId ||
    (rail.highlightGroupKey !== null &&
      entry.groupKey === rail.highlightGroupKey);
  const inFlight = entry.result === null && rail.live && isLast;

  return (
    <div
      className={`sess-tool-card${entry.result?.isError ? " is-error" : ""}${highlighted ? " is-highlight" : ""}${expanded ? " is-open" : ""}`}
      data-tooluseid={entry.toolUseId}
    >
      <div className="sess-tool-card-row">
        <button
          type="button"
          className="sess-tool-card-jump"
          onClick={() => rail.onJumpToTurn(entry)}
          title="Show this call in the conversation"
        >
          <span className="sess-tool-card-icon">{toolIcon(entry.name)}</span>
          <span className="sess-tool-card-name">{entry.name}</span>
          <span className="sess-tool-card-sum" title={entry.summary}>
            {entry.summary || "—"}
          </span>
        </button>
        {entry.result?.isError && (
          <TriangleAlert
            size={11}
            className="sess-tool-card-erricon"
            aria-label="errored"
          />
        )}
        {inFlight && <span className="sess-tool-card-running">running</span>}
        <button
          type="button"
          className="sess-tool-card-expand"
          onClick={() => rail.onToggleExpand(entry.toolUseId)}
          aria-expanded={expanded ? "true" : "false"}
          aria-label={expanded ? "Collapse result" : "Expand result"}
        >
          {expanded ? (
            <ChevronDown size={13} aria-hidden="true" />
          ) : (
            <ChevronRight size={13} aria-hidden="true" />
          )}
        </button>
      </div>
      {expanded && <CardResult entry={entry} sessionId={rail.sessionId} />}
    </div>
  );
}

function CardResult({
  entry,
  sessionId,
}: {
  entry: LedgerEntry;
  sessionId: string;
}) {
  const [full, setFull] = useState<string | null>(
    fullResultCache.get(entry.toolUseId) ?? null,
  );
  const [fullState, setFullState] = useState<
    "idle" | "loading" | "unavailable" | "error"
  >("idle");

  const openFull = async () => {
    setFullState("loading");
    try {
      const detail = await fetchToolResult(sessionId, entry.toolUseId);
      fullResultCache.set(entry.toolUseId, detail.result.text);
      setFull(detail.result.text);
      setFullState("idle");
    } catch (err) {
      setFullState(
        err instanceof ApiError && err.status === 404 ? "unavailable" : "error",
      );
    }
  };

  if (entry.result === null && full === null) {
    return (
      <div className="sess-tool-card-body sess-tool-card-body--pending">
        No result recorded yet.
      </div>
    );
  }

  const text = full ?? entry.result?.text ?? "";
  const truncated = full === null && entry.result?.truncated === true;

  return (
    <div
      className={`sess-tool-card-body${entry.result?.isError ? " is-error" : ""}`}
    >
      <pre className="sess-tool-card-result">{text || "(empty result)"}</pre>
      {truncated && (
        <div className="sess-tool-card-more">
          <span className="sess-trunc">truncated</span>
          <button
            type="button"
            className="sess-expand-btn"
            onClick={openFull}
            disabled={fullState === "loading"}
          >
            {fullState === "loading" ? (
              <>
                <Loader2 size={11} className="sess-spin" aria-hidden="true" />
                Loading full result…
              </>
            ) : (
              <>
                <CornerUpLeft size={11} aria-hidden="true" />
                Open full result
              </>
            )}
          </button>
          {fullState === "unavailable" && (
            <span className="sess-tool-card-note">
              Full result needs the updated Console server.
            </span>
          )}
          {fullState === "error" && (
            <span className="sess-tool-card-note">
              Could not load the full result.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Session-lifetime cache of untruncated results (keyed by toolUseId). */
const fullResultCache = new Map<string, string>();
