/**
 * ConversationPane.tsx — the center, PROSE-ONLY conversation of the Sessions
 * view: user prompts, assistant text, collapsed thinking — with every
 * consecutive tool run compressed into one inline group chip that deep-links
 * into the tool rail. Rendering is fully virtualized (VirtualList); the pane
 * opens at the END of the conversation and follows the live tail.
 */

import { forwardRef, memo } from "react";
import {
  ArrowDown,
  Bot,
  ChevronDown,
  ChevronRight,
  History,
  Loader2,
  TriangleAlert,
  User,
  Wrench,
} from "lucide-react";
import type { ConvoRow, LedgerEntry } from "./rows";
import { groupChipSegments } from "./rows";
import { shortModel, timeAgo } from "./NavRail";
import { toolIcon } from "./toolIcons";
import { VirtualList, type VirtualListHandle } from "./VirtualList";

/* ── Row height estimates (px) — refined by measurement at runtime ── */

export function estimateRowHeight(row: ConvoRow): number {
  switch (row.kind) {
    case "loadEarlier":
      return 44;
    case "prompt":
      return row.noise
        ? 34
        : Math.min(190, 74 + Math.ceil(row.text.length / 90) * 19);
    case "assistant":
      return Math.min(420, 66 + Math.ceil(row.text.length / 90) * 19);
    case "thinking":
      return 36;
    case "toolGroup":
      return 46;
  }
}

/* ── Pane ── */

export interface ConversationPaneProps {
  rows: ConvoRow[];
  ledger: LedgerEntry[];
  /** Agent identity for the header strip. */
  agentId: string;
  agentType: string;
  description: string | null;
  model: string | null;
  loadedCount: number;
  total: number;
  live: boolean;
  hasMore: boolean;
  loadingEarlier: boolean;
  /** Pinned-to-bottom follow mode (owner state; drives VirtualList pinning). */
  follow: boolean;
  /** Rows the user hasn't seen because they scrolled up (pill). */
  unseenCount: number;
  gapBehindLive: boolean;
  /** UI state owned by the page (survives virtualization unmounts). */
  expandedGroups: ReadonlySet<string>;
  expandedPrompts: ReadonlySet<string>;
  expandedThinking: ReadonlySet<string>;
  highlightKey: string | null;
  cursorKey: string | null;
  onLoadEarlier: () => void;
  onToggleGroup: (key: string) => void;
  onTogglePrompt: (key: string) => void;
  onToggleThinking: (key: string) => void;
  onChipJump: (row: Extract<ConvoRow, { kind: "toolGroup" }>) => void;
  onCallJump: (entry: LedgerEntry) => void;
  onJumpToLatest: () => void;
  onAtBottomChange: (atBottom: boolean) => void;
  onRowClick: (key: string) => void;
}

export const ConversationPane = forwardRef<
  VirtualListHandle,
  ConversationPaneProps
>(function ConversationPane(props, listRef) {
  const {
    rows,
    ledger,
    unseenCount,
    gapBehindLive,
    onJumpToLatest,
    onAtBottomChange,
  } = props;

  return (
    <section className="sess-convo" aria-label="Conversation">
      <ConvoHeader {...props} />
      <div className="sess-convo-scrollwrap">
        <VirtualList
          ref={listRef}
          items={rows}
          estimateHeight={estimateRowHeight}
          onAtBottomChange={onAtBottomChange}
          pinToBottom={props.follow}
          className="sess-convo-list"
          aria-label="Conversation turns"
          renderRow={(row) => <Row row={row} ledger={ledger} pane={props} />}
        />
        {(unseenCount > 0 || gapBehindLive) && (
          <button
            type="button"
            className="sess-new-pill"
            onClick={onJumpToLatest}
            aria-live="polite"
          >
            <ArrowDown size={12} aria-hidden="true" />
            {gapBehindLive
              ? "New activity"
              : `${unseenCount} new turn${unseenCount === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </section>
  );
});

function ConvoHeader({
  agentId,
  agentType,
  description,
  model,
  loadedCount,
  total,
  live,
}: ConversationPaneProps) {
  const m = shortModel(model);
  return (
    <header className="sess-convo-head">
      <span
        className={`sess-agent-pill ${agentId === "root" ? "sess-agent-pill--root" : ""}`}
      >
        {agentId === "root" ? (
          <User size={10} aria-hidden="true" />
        ) : (
          <Bot size={10} aria-hidden="true" />
        )}
        {agentId === "root" ? "Main session" : agentType}
      </span>
      {description && (
        <span className="sess-convo-head-desc" title={description}>
          {description}
        </span>
      )}
      <span className="sess-convo-head-meta">
        {live && <span className="sess-live-label">live</span>}
        {m && <span className="sess-convo-head-model">{m}</span>}
        <span className="sess-convo-head-count">
          {loadedCount < total ? `${loadedCount} of ${total}` : total} turns
        </span>
      </span>
    </header>
  );
}

/* ── Rows ── */

const Row = memo(function Row({
  row,
  ledger,
  pane,
}: {
  row: ConvoRow;
  ledger: LedgerEntry[];
  pane: ConversationPaneProps;
}) {
  const highlight = pane.highlightKey === row.key;
  const cursor = pane.cursorKey === row.key;
  const stateCls = `${highlight ? " is-highlight" : ""}${cursor ? " is-cursor" : ""}`;

  switch (row.kind) {
    case "loadEarlier":
      return (
        <div className={`sess-row sess-row--earlier${stateCls}`}>
          <button
            type="button"
            className="sess-load-earlier"
            onClick={pane.onLoadEarlier}
            disabled={pane.loadingEarlier}
          >
            {pane.loadingEarlier ? (
              <Loader2 size={12} className="sess-spin" aria-hidden="true" />
            ) : (
              <History size={12} aria-hidden="true" />
            )}
            {pane.loadingEarlier
              ? "Loading earlier turns…"
              : `Load earlier — ${Math.max(0, pane.total - pane.loadedCount)} older turns`}
          </button>
        </div>
      );

    case "prompt": {
      if (row.noise) {
        return (
          <div
            className={`sess-row sess-row--notice${stateCls}`}
            onClick={() => pane.onRowClick(row.key)}
          >
            <span className="sess-notice-text">{row.text}</span>
          </div>
        );
      }
      const expanded = pane.expandedPrompts.has(row.key);
      return (
        <article
          className={`sess-row sess-row--prompt${stateCls}`}
          onClick={() => pane.onRowClick(row.key)}
        >
          <header className="sess-row-head">
            <span className="sess-role sess-role--user">
              <User size={11} aria-hidden="true" /> user
            </span>
            {row.timestamp && (
              <time className="sess-row-time" dateTime={row.timestamp}>
                {timeAgo(row.timestamp)}
              </time>
            )}
          </header>
          <div
            className={`sess-prompt-text ${row.long && !expanded ? "is-clamped" : ""}`}
          >
            {row.text}
            {row.truncated && <span className="sess-trunc"> [truncated]</span>}
          </div>
          {row.long && (
            <button
              type="button"
              className="sess-expand-btn"
              onClick={(e) => {
                e.stopPropagation();
                pane.onTogglePrompt(row.key);
              }}
              aria-expanded={expanded ? "true" : "false"}
            >
              {expanded ? "Collapse prompt" : "Show full prompt"}
            </button>
          )}
        </article>
      );
    }

    case "assistant":
      return (
        <article
          className={`sess-row sess-row--assistant${stateCls}`}
          onClick={() => pane.onRowClick(row.key)}
        >
          <header className="sess-row-head">
            <span className="sess-role sess-role--assistant">
              <Bot size={11} aria-hidden="true" /> assistant
            </span>
            {shortModel(row.model) && (
              <span className="sess-row-model">{shortModel(row.model)}</span>
            )}
            {row.timestamp && (
              <time className="sess-row-time" dateTime={row.timestamp}>
                {timeAgo(row.timestamp)}
              </time>
            )}
          </header>
          <div className="sess-assistant-text">
            {row.text}
            {row.truncated && <span className="sess-trunc"> [truncated]</span>}
          </div>
        </article>
      );

    case "thinking": {
      const expanded = pane.expandedThinking.has(row.key);
      return (
        <div className={`sess-row sess-row--thinking${stateCls}`}>
          <button
            type="button"
            className="sess-thinking-toggle"
            onClick={() => {
              pane.onToggleThinking(row.key);
              pane.onRowClick(row.key);
            }}
            aria-expanded={expanded ? "true" : "false"}
          >
            {expanded ? (
              <ChevronDown size={11} aria-hidden="true" />
            ) : (
              <ChevronRight size={11} aria-hidden="true" />
            )}
            Thinking
            <span className="sess-thinking-len">
              {row.text.length.toLocaleString()} chars
            </span>
          </button>
          {expanded && (
            <div className="sess-thinking-body">
              {row.text}
              {row.truncated && (
                <span className="sess-trunc"> [truncated]</span>
              )}
            </div>
          )}
        </div>
      );
    }

    case "toolGroup":
      return (
        <ToolGroupRow
          row={row}
          ledger={ledger}
          pane={pane}
          stateCls={stateCls}
        />
      );
  }
});

function ToolGroupRow({
  row,
  ledger,
  pane,
  stateCls,
}: {
  row: Extract<ConvoRow, { kind: "toolGroup" }>;
  ledger: LedgerEntry[];
  pane: ConversationPaneProps;
  stateCls: string;
}) {
  const expanded = pane.expandedGroups.has(row.key);
  const { total, top, moreNames } = groupChipSegments(row);
  const calls = ledger.slice(row.ledgerStart, row.ledgerEnd);

  return (
    <div
      className={`sess-row sess-row--group${row.errorCount > 0 ? " has-error" : ""}${stateCls}`}
    >
      <div className="sess-chip">
        <button
          type="button"
          className="sess-chip-main"
          onClick={() => {
            pane.onChipJump(row);
            pane.onRowClick(row.key);
          }}
          title="Show these calls in the tool rail"
        >
          <Wrench size={12} aria-hidden="true" />
          <span className="sess-chip-count">
            {total} tool call{total === 1 ? "" : "s"}
          </span>
          <span className="sess-chip-names">
            {top.map(([name, n]) => (
              <span key={name} className="sess-chip-name">
                {name}
                {n > 1 && <span className="sess-chip-n">×{n}</span>}
              </span>
            ))}
            {moreNames > 0 && (
              <span className="sess-chip-name sess-chip-more">
                +{moreNames} more
              </span>
            )}
            {total === 1 && calls[0]?.summary && (
              <span className="sess-chip-name sess-chip-summary">
                {calls[0].summary}
              </span>
            )}
          </span>
          {row.errorCount > 0 && (
            <span className="sess-chip-err">
              <TriangleAlert size={11} aria-hidden="true" />
              {row.errorCount} error{row.errorCount === 1 ? "" : "s"}
            </span>
          )}
        </button>
        <button
          type="button"
          className="sess-chip-expand"
          onClick={() => {
            pane.onToggleGroup(row.key);
            pane.onRowClick(row.key);
          }}
          aria-expanded={expanded ? "true" : "false"}
          aria-label={expanded ? "Collapse tool calls" : "Expand tool calls"}
        >
          {expanded ? (
            <ChevronDown size={13} aria-hidden="true" />
          ) : (
            <ChevronRight size={13} aria-hidden="true" />
          )}
        </button>
      </div>

      {expanded && (
        <div className="sess-group-body">
          {interleave(row, calls).map((item) =>
            item.type === "thinking" ? (
              <div key={item.key} className="sess-group-thinking">
                {item.text}
              </div>
            ) : (
              <button
                key={item.entry.toolUseId || `i${item.entry.index}`}
                type="button"
                className={`sess-group-call${item.entry.result?.isError ? " is-error" : ""}`}
                onClick={() => pane.onCallJump(item.entry)}
                title="Show in tool rail"
              >
                <span className="sess-group-call-icon">
                  {toolIcon(item.entry.name)}
                </span>
                <span className="sess-group-call-name">{item.entry.name}</span>
                <span className="sess-group-call-sum">
                  {item.entry.summary}
                </span>
                {item.entry.result?.isError && (
                  <TriangleAlert
                    size={11}
                    className="sess-group-call-erricon"
                    aria-label="errored"
                  />
                )}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Interleave folded thinking snippets between the group's calls, in order. */
function interleave(
  row: Extract<ConvoRow, { kind: "toolGroup" }>,
  calls: LedgerEntry[],
): (
  | { type: "thinking"; key: string; text: string }
  | { type: "call"; entry: LedgerEntry }
)[] {
  const out: (
    | { type: "thinking"; key: string; text: string }
    | { type: "call"; entry: LedgerEntry }
  )[] = [];
  let t = 0;
  for (const entry of calls) {
    while (
      t < row.thinking.length &&
      row.thinking[t].beforeLedgerIndex <= entry.index
    ) {
      out.push({
        type: "thinking",
        key: row.thinking[t].key,
        text: row.thinking[t].text,
      });
      t++;
    }
    out.push({ type: "call", entry });
  }
  for (; t < row.thinking.length; t++) {
    out.push({
      type: "thinking",
      key: row.thinking[t].key,
      text: row.thinking[t].text,
    });
  }
  return out;
}
