/**
 * SessionsPage.tsx — the 3-pane agent-activity viewer (READ-ONLY).
 *
 *   NAV RAIL (left)      one merged tree: sessions grouped by day, the
 *                        selected session expanded with its agents nested;
 *                        live agents pulse, pin first, show latest activity.
 *   CONVERSATION (center) prose only — prompts, assistant text, collapsed
 *                        thinking; consecutive tool runs collapse to ONE
 *                        inline chip. Virtualized; opens at the END; paged
 *                        back with "load earlier"; follows the live tail.
 *   TOOL RAIL (right)    chronological tool ledger with filters, a mini
 *                        activity timeline and in-place result expansion.
 *                        Two-way sync: chip ⇄ rail.
 *
 * Routing: /sessions/:sessionId/:agentId (+ ?turn=<uuid>) — selection lives
 * in the URL; refresh restores place. Keyboard: j/k rows · [ ] agents ·
 * t rail · e expand · / search · Esc. On narrow viewports (≤1100px) the
 * tool rail becomes a slide-in DRAWER (`t` / floating Tools button / Esc).
 *
 * Data: /api/sessions endpoints (see api/sessions.ts). Liveness: per-session
 * SSE triggers TAIL refetches (not full reloads). Observe-only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Keyboard,
  Network,
  PanelRightOpen,
  RefreshCw,
  Search,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { PageLayout, EmptyState } from "../components/PageLayout";
import {
  fetchAgentWindow,
  fetchSessions,
  fetchSessionTree,
  subscribeToSession,
  type SearchMatch,
  type SessionTree,
} from "../api/sessions";
import { useAsync, LoadingState, ErrorState } from "./lib";
import { NavRail, agentCycleOrder, isLiveSession } from "../sessions/NavRail";
import { ConversationPane } from "../sessions/ConversationPane";
import { ToolRail } from "../sessions/ToolRail";
import { SearchOverlay } from "../sessions/SearchOverlay";
import { useConversation } from "../sessions/useConversation";
import {
  buildRowModel,
  humanToolSummary,
  matchesRailFilter,
  type ConvoRow,
  type LedgerEntry,
  type RailFilter,
} from "../sessions/rows";
import type { VirtualListHandle } from "../sessions/VirtualList";
import "../../styles/pages.css";
import "../../styles/sessions.css";

/** SSE change → refetch debounce (transcripts append in bursts). */
const SSE_DEBOUNCE_MS = 1500;
/** Auto "load earlier" attempts when chasing a ?turn deep link. */
const DEEP_LINK_MAX_LOADS = 3;
/** How long a jump highlight stays on a row/card. */
const HIGHLIGHT_MS = 2400;

/**
 * Below this width the tool rail leaves the grid and becomes a slide-in
 * DRAWER (toggled by `t` and a floating Tools button) — an embedded/side-panel
 * viewport can't afford a third fixed column, but the ledger must stay
 * reachable. KEEP IN SYNC with the `@media (max-width: 1100px)` block in
 * styles/sessions.css.
 */
const RAIL_DRAWER_QUERY = "(max-width: 1100px)";

/** Keep the last ready value so live refetches don't blank a pane. */
function useLastReady<T>(phase: string, data: T | undefined): T | undefined {
  const ref = useRef<T | undefined>(undefined);
  if (phase === "ready" && data !== undefined) ref.current = data;
  return phase === "ready" ? data : ref.current;
}

export function SessionsPage() {
  const params = useParams<{ sessionId?: string; agentId?: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const sessionId = params.sessionId ?? null;
  const agentId = sessionId ? (params.agentId ?? "root") : null;

  /* ── Session list ── */
  const sessions = useAsync(fetchSessions, []);
  const list = useLastReady(sessions.phase, sessions.data);

  // No session in the URL → route to the newest one (replace, no history spam).
  useEffect(() => {
    if (!sessionId && list && list.length > 0) {
      navigate(`/sessions/${list[0].id}/root`, { replace: true });
    }
  }, [sessionId, list, navigate]);

  // /sessions/:id (no agent) → normalise to /root.
  useEffect(() => {
    if (sessionId && !params.agentId) {
      navigate(`/sessions/${sessionId}/root${window.location.search}`, {
        replace: true,
      });
    }
  }, [sessionId, params.agentId, navigate]);

  /* ── Agent tree of the selected session ── */
  const tree = useAsync<SessionTree | null>(
    () => (sessionId ? fetchSessionTree(sessionId) : Promise.resolve(null)),
    [sessionId],
  );
  const treeData = useLastReady(tree.phase, tree.data) ?? null;

  /* ── Conversation window ── */
  const conv = useConversation(sessionId, agentId);

  /* ── UI state (reset per agent) ── */
  // Narrow viewport → the rail renders as a slide-in drawer (closed by
  // default so it never covers the conversation on load).
  const railDrawer = useMediaQuery(RAIL_DRAWER_QUERY);
  const [railOpen, setRailOpen] = useState(
    () => !matchesMedia(RAIL_DRAWER_QUERY),
  );
  useEffect(() => {
    setRailOpen(!railDrawer);
  }, [railDrawer]);
  const [railFilter, setRailFilter] = useState<RailFilter>("all");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(
    new Set(),
  );
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(
    new Set(),
  );
  const [railExpanded, setRailExpanded] = useState<Set<string>>(new Set());
  const [highlightRowKey, setHighlightRowKey] = useState<string | null>(null);
  const [highlightGroupKey, setHighlightGroupKey] = useState<string | null>(
    null,
  );
  const [highlightToolUseId, setHighlightToolUseId] = useState<string | null>(
    null,
  );
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [deepLinkMiss, setDeepLinkMiss] = useState(false);

  useEffect(() => {
    setRailFilter("all");
    setExpandedGroups(new Set());
    setExpandedPrompts(new Set());
    setExpandedThinking(new Set());
    setRailExpanded(new Set());
    setHighlightRowKey(null);
    setHighlightGroupKey(null);
    setHighlightToolUseId(null);
    setCursorKey(null);
    setDeepLinkMiss(false);
  }, [sessionId, agentId]);

  /* ── Follow mode (pinned to bottom) ── */
  const [follow, setFollow] = useState(true);
  const followRef = useRef(true);
  const setFollowBoth = useCallback((v: boolean) => {
    followRef.current = v;
    setFollow(v);
  }, []);

  const convoListRef = useRef<VirtualListHandle>(null);
  const railListRef = useRef<VirtualListHandle>(null);

  /* ── Row model ── */
  const model = useMemo(
    () => buildRowModel(conv.turns, { hasEarlier: conv.hasMore }),
    [conv.turns, conv.hasMore],
  );

  /* ── Open at the end (unless deep-linked) ── */
  const openedRef = useRef<string | null>(null);
  const turnParam = searchParams.get("turn");
  useEffect(() => {
    const target = `${sessionId}/${agentId}`;
    if (conv.phase !== "ready" || openedRef.current === target) return;
    openedRef.current = target;
    setFollowBoth(!turnParam);
    if (!turnParam) {
      requestAnimationFrame(() => convoListRef.current?.scrollToBottom());
    }
  }, [conv.phase, sessionId, agentId, turnParam, setFollowBoth]);

  /* Follow-mode pinning lives in VirtualList (pinToBottom prop) — it re-glues
     on content growth AND on post-measurement height corrections. */

  /* ── Deep link: ?turn=<uuid> ── */
  const deepLinkRef = useRef<{ uuid: string; loads: number; done: boolean }>({
    uuid: "",
    loads: 0,
    done: true,
  });
  useEffect(() => {
    if (!turnParam) return;
    if (deepLinkRef.current.uuid !== turnParam) {
      deepLinkRef.current = { uuid: turnParam, loads: 0, done: false };
      setDeepLinkMiss(false);
    }
  }, [turnParam]);
  useEffect(() => {
    const dl = deepLinkRef.current;
    if (dl.done || !turnParam || conv.phase !== "ready") return;
    const rowKey = model.rowKeyByTurnUuid.get(turnParam);
    if (rowKey) {
      dl.done = true;
      setFollowBoth(false);
      requestAnimationFrame(() => {
        convoListRef.current?.scrollToKey(rowKey, "center");
        flashRow(rowKey);
      });
    } else if (conv.hasMore && dl.loads < DEEP_LINK_MAX_LOADS) {
      dl.loads++;
      void conv.loadEarlier();
    } else {
      dl.done = true;
      setDeepLinkMiss(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnParam, conv.phase, conv.hasMore, model]);

  /* ── Highlight helpers (fade after a beat) ── */
  const rowFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashRow = useCallback((key: string) => {
    setHighlightRowKey(key);
    if (rowFlashTimer.current) clearTimeout(rowFlashTimer.current);
    rowFlashTimer.current = setTimeout(
      () => setHighlightRowKey(null),
      HIGHLIGHT_MS,
    );
  }, []);
  const railFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashRail = useCallback(
    (groupKey: string | null, toolUseId: string | null) => {
      setHighlightGroupKey(groupKey);
      setHighlightToolUseId(toolUseId);
      if (railFlashTimer.current) clearTimeout(railFlashTimer.current);
      railFlashTimer.current = setTimeout(() => {
        setHighlightGroupKey(null);
        setHighlightToolUseId(null);
      }, HIGHLIGHT_MS);
    },
    [],
  );
  useEffect(
    () => () => {
      if (rowFlashTimer.current) clearTimeout(rowFlashTimer.current);
      if (railFlashTimer.current) clearTimeout(railFlashTimer.current);
    },
    [],
  );

  /* ── SSE liveness: tail refetch + tree refresh ── */
  const sseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const treeReload = tree.reload;
  const refreshTail = conv.refreshTail;
  useEffect(() => {
    if (!sessionId) return;
    const unsub = subscribeToSession(sessionId, () => {
      if (sseTimer.current !== null) clearTimeout(sseTimer.current);
      sseTimer.current = setTimeout(() => {
        sseTimer.current = null;
        treeReload();
        void refreshTail(followRef.current);
      }, SSE_DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (sseTimer.current !== null) {
        clearTimeout(sseTimer.current);
        sseTimer.current = null;
      }
    };
  }, [sessionId, treeReload, refreshTail]);

  /* ── Live-agent subtitles (latest tool call, one line) ── */
  const subtitles = useLiveSubtitles(sessionId, treeData);

  /* ── Two-way sync callbacks ── */
  const onChipJump = useCallback(
    (row: Extract<ConvoRow, { kind: "toolGroup" }>) => {
      setRailOpen(true);
      // PRESERVE the active rail filter mid-triage: land on the group's first
      // entry that the filter shows. Only when the group has NO match does the
      // filter widen to All (the pill visibly deactivates — never silent).
      const group = model.ledger.slice(row.ledgerStart, row.ledgerEnd);
      let target = group.find((e) => matchesRailFilter(e, railFilter)) ?? null;
      if (!target) {
        setRailFilter("all");
        target = group[0] ?? null;
      }
      const t = target;
      flashRail(row.key, null);
      requestAnimationFrame(() => {
        if (t) {
          railListRef.current?.scrollToKey(
            t.toolUseId || `i${t.index}`,
            "start",
          );
        }
      });
    },
    [model.ledger, railFilter, flashRail],
  );

  const onCallJump = useCallback(
    (entry: LedgerEntry) => {
      setRailOpen(true);
      // Keep the filter when it already shows this call; widen only when the
      // clicked call would otherwise be invisible in the rail.
      if (!matchesRailFilter(entry, railFilter)) setRailFilter("all");
      flashRail(null, entry.toolUseId);
      requestAnimationFrame(() => {
        railListRef.current?.scrollToKey(
          entry.toolUseId || `i${entry.index}`,
          "center",
        );
      });
    },
    [railFilter, flashRail],
  );

  const onJumpToTurn = useCallback(
    (entry: LedgerEntry) => {
      const rowKey =
        model.rowKeyByToolUseId.get(entry.toolUseId) ??
        model.rowKeyByTurnUuid.get(entry.turnUuid);
      if (!rowKey) return;
      setFollowBoth(false);
      convoListRef.current?.scrollToKey(rowKey, "center");
      flashRow(rowKey);
      // Reflect the anchor in the URL without spamming history.
      const next = new URLSearchParams(searchParams);
      next.set("turn", entry.turnUuid);
      deepLinkRef.current = { uuid: entry.turnUuid, loads: 0, done: true };
      setSearchParams(next, { replace: true });
    },
    [model, searchParams, setSearchParams, flashRow, setFollowBoth],
  );

  const onSearchPick = useCallback(
    (m: SearchMatch) => {
      setSearchOpen(false);
      if (m.agentId !== agentId) {
        navigate(
          `/sessions/${sessionId}/${m.agentId}?turn=${encodeURIComponent(m.turnUuid)}`,
        );
        return;
      }
      const rowKey = model.rowKeyByTurnUuid.get(m.turnUuid);
      if (rowKey) {
        setFollowBoth(false);
        convoListRef.current?.scrollToKey(rowKey, "center");
        flashRow(rowKey);
        const next = new URLSearchParams(searchParams);
        next.set("turn", m.turnUuid);
        deepLinkRef.current = { uuid: m.turnUuid, loads: 0, done: true };
        setSearchParams(next, { replace: true });
      } else {
        // Not in the window — route through the deep-link loader.
        const next = new URLSearchParams(searchParams);
        next.set("turn", m.turnUuid);
        deepLinkRef.current = { uuid: m.turnUuid, loads: 0, done: false };
        setSearchParams(next, { replace: true });
      }
    },
    [
      agentId,
      sessionId,
      model,
      navigate,
      searchParams,
      setSearchParams,
      flashRow,
      setFollowBoth,
    ],
  );

  const onJumpToLatest = useCallback(() => {
    if (conv.gapBehindLive) {
      void conv.jumpToLive().then(() => {
        requestAnimationFrame(() => convoListRef.current?.scrollToBottom());
      });
    } else {
      convoListRef.current?.scrollToBottom(true);
    }
    conv.acknowledgeUnseen();
    setFollowBoth(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    conv.gapBehindLive,
    conv.jumpToLive,
    conv.acknowledgeUnseen,
    setFollowBoth,
  ]);

  const onAtBottomChange = useCallback(
    (atBottom: boolean) => {
      setFollowBoth(atBottom);
      if (atBottom) conv.acknowledgeUnseen();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conv.acknowledgeUnseen, setFollowBoth],
  );

  /* ── Keyboard map ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (searchOpen) return; // overlay owns its keys
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case "j":
        case "k": {
          e.preventDefault();
          const rows = model.rows;
          if (rows.length === 0) break;
          const idx = cursorKey
            ? rows.findIndex((r) => r.key === cursorKey)
            : -1;
          // No cursor yet (tail-open): BOTH keys start at the LAST row — the
          // one on screen. (j must never teleport a tail reader to row 0.)
          const next =
            idx === -1
              ? rows.length - 1
              : e.key === "j"
                ? Math.min(rows.length - 1, idx + 1)
                : Math.max(0, idx - 1);
          const key = rows[next].key;
          setCursorKey(key);
          setFollowBoth(next === rows.length - 1);
          convoListRef.current?.scrollToKey(key, "center");
          break;
        }
        case "[":
        case "]": {
          if (!treeData || !sessionId) break;
          e.preventDefault();
          const order = agentCycleOrder(treeData);
          const cur = Math.max(0, order.indexOf(agentId ?? "root"));
          const next =
            e.key === "]"
              ? Math.min(order.length - 1, cur + 1)
              : Math.max(0, cur - 1);
          if (order[next] !== agentId) {
            navigate(`/sessions/${sessionId}/${order[next]}`);
          }
          break;
        }
        case "t":
          e.preventDefault();
          setRailOpen((o) => !o);
          break;
        case "e": {
          if (!cursorKey) break;
          const row = model.rows.find((r) => r.key === cursorKey);
          if (!row) break;
          e.preventDefault();
          if (row.kind === "toolGroup") toggleIn(setExpandedGroups, row.key);
          else if (row.kind === "prompt" && (row.long || row.noise))
            toggleIn(setExpandedPrompts, row.key);
          else if (row.kind === "thinking")
            toggleIn(setExpandedThinking, row.key);
          break;
        }
        case "/":
          e.preventDefault();
          setSearchOpen(true);
          break;
        case "Escape":
          if (railDrawer && railOpen) {
            // Drawer-mode rail is an overlay — Esc dismisses it first.
            setRailOpen(false);
            break;
          }
          setCursorKey(null);
          setHighlightRowKey(null);
          setDeepLinkMiss(false);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    searchOpen,
    model,
    cursorKey,
    treeData,
    sessionId,
    agentId,
    navigate,
    setFollowBoth,
    railDrawer,
    railOpen,
  ]);

  /* ── Render ── */

  if (sessions.phase === "loading" && !list) {
    return (
      <PageLayout
        title="Sessions"
        subtitle="Agent activity"
        badge="transcripts"
      >
        <LoadingState label="Loading sessions…" />
      </PageLayout>
    );
  }
  if (sessions.phase === "error" && !list) {
    return (
      <PageLayout
        title="Sessions"
        subtitle="Agent activity"
        badge="transcripts"
      >
        <ErrorState error={sessions.error} onRetry={sessions.reload} />
      </PageLayout>
    );
  }
  if (list && list.length === 0) {
    return (
      <PageLayout
        title="Sessions"
        subtitle="Agent activity"
        badge="transcripts"
      >
        <EmptyState
          icon={<Network size={22} />}
          title="No sessions recorded"
          description="No Claude Code transcripts were found for this project. Run a session in this project and it will appear here, along with any subagents it spawns."
        />
      </PageLayout>
    );
  }

  const selectedSession = list?.find((s) => s.id === sessionId) ?? null;
  const live =
    (treeData &&
      (agentId === "root"
        ? treeData.root.status === "running"
        : treeData.agents.find((a) => a.id === agentId)?.status ===
          "running")) ||
    (selectedSession ? isLiveSession(selectedSession) : false);

  const agentLabel =
    agentId === "root" ? "Main session" : conv.agentType || agentId || "agent";

  // Persistent deep-link marker: while ?turn= is in the URL, its row keeps a
  // left-edge accent bar (the flash alone decays after ~2s).
  const markedKey =
    (turnParam ? model.rowKeyByTurnUuid.get(turnParam) : null) ?? null;

  const toolRail = (
    <ToolRail
      ref={railListRef}
      sessionId={sessionId ?? ""}
      ledger={model.ledger}
      toolCounts={model.toolCounts}
      errorCount={model.errorCount}
      filter={railFilter}
      onFilterChange={setRailFilter}
      highlightGroupKey={highlightGroupKey}
      highlightToolUseId={highlightToolUseId}
      expanded={railExpanded}
      onToggleExpand={(id) => toggleIn(setRailExpanded, id)}
      onJumpToTurn={onJumpToTurn}
      onClose={() => setRailOpen(false)}
      live={!!live}
      autoFocusClose={railDrawer}
    />
  );

  return (
    <PageLayout
      title="Sessions"
      subtitle="Agent activity — read from Claude Code's transcripts, observe-only"
      badge="transcripts"
      actions={
        <div className="sess-actions">
          <span
            className="sess-kbd-hint"
            title="Keyboard: j/k rows · [ ] agents · t tool rail · e expand · / search · Esc"
          >
            <Keyboard size={12} aria-hidden="true" />
            j/k · [ ] · t · e · /
          </span>
          <button
            type="button"
            className="sessions-refresh-btn"
            onClick={() => setSearchOpen(true)}
            title="Search in session (/)"
          >
            <Search size={13} aria-hidden="true" />
            Search
          </button>
          <button
            type="button"
            className="sessions-refresh-btn"
            onClick={() => {
              sessions.reload();
              treeReload();
              conv.reload();
            }}
            title="Refresh"
          >
            <RefreshCw size={13} aria-hidden="true" />
            Refresh
          </button>
        </div>
      }
    >
      <div
        className={`sess-shell${railDrawer ? " sess-shell--drawer" : railOpen ? "" : " sess-shell--norail"}`}
      >
        <NavRail
          sessions={list ?? []}
          selectedSessionId={sessionId}
          selectedAgentId={agentId}
          tree={treeData}
          treeLoading={tree.phase === "loading"}
          subtitles={subtitles}
          onSelectSession={(id) =>
            id !== sessionId && navigate(`/sessions/${id}/root`)
          }
          onSelectAgent={(sid, aid) =>
            (sid !== sessionId || aid !== agentId) &&
            navigate(`/sessions/${sid}/${aid}`)
          }
        />

        <div className="sess-center">
          {deepLinkMiss && (
            <div className="sess-deeplink-note" role="status">
              That turn isn't in the loaded range — use “Load earlier” to reach
              it.
            </div>
          )}
          {conv.phase === "error" ? (
            <ErrorState error={conv.error!} onRetry={conv.reload} />
          ) : conv.phase === "loading" ? (
            <LoadingState label="Loading conversation…" />
          ) : model.rows.length === 0 ? (
            <EmptyState
              icon={<Network size={22} />}
              title="Empty transcript"
              description="This agent has no displayable turns yet."
            />
          ) : (
            <ConversationPane
              ref={convoListRef}
              rows={model.rows}
              ledger={model.ledger}
              agentId={agentId ?? "root"}
              agentType={conv.agentType}
              description={conv.description}
              model={conv.model}
              loadedCount={conv.turns.length}
              total={conv.total}
              live={!!live}
              hasMore={conv.hasMore}
              loadingEarlier={conv.loadingEarlier}
              follow={follow}
              unseenCount={follow ? 0 : conv.unseenCount}
              gapBehindLive={conv.gapBehindLive}
              expandedGroups={expandedGroups}
              expandedPrompts={expandedPrompts}
              expandedThinking={expandedThinking}
              highlightKey={highlightRowKey}
              cursorKey={cursorKey}
              markedKey={markedKey}
              onLoadEarlier={() => void conv.loadEarlier()}
              onToggleGroup={(k) => toggleIn(setExpandedGroups, k)}
              onTogglePrompt={(k) => toggleIn(setExpandedPrompts, k)}
              onToggleThinking={(k) => toggleIn(setExpandedThinking, k)}
              onChipJump={onChipJump}
              onCallJump={onCallJump}
              onJumpToLatest={onJumpToLatest}
              onAtBottomChange={onAtBottomChange}
              onRowClick={setCursorKey}
            />
          )}
        </div>

        {railDrawer ? (
          railOpen ? (
            /* Narrow viewport: the rail is a slide-in DRAWER over the page —
               reachable via `t`, the Tools button, and closable via Esc /
               backdrop / its own close button. */
            <>
              <button
                type="button"
                className="sess-drawer-backdrop"
                onClick={() => setRailOpen(false)}
                aria-label="Close tool rail"
                tabIndex={-1}
              />
              <div
                className="sess-drawer"
                role="dialog"
                aria-modal="true"
                aria-label="Tool activity"
              >
                {toolRail}
              </div>
            </>
          ) : (
            <button
              type="button"
              className="sess-drawer-fab"
              onClick={() => setRailOpen(true)}
              title="Show tool rail (t)"
              aria-label="Show tool rail"
            >
              <Wrench size={13} aria-hidden="true" />
              Tools
              {model.ledger.length > 0 && (
                <span className="sess-drawer-fab-count">
                  {model.ledger.length}
                </span>
              )}
              {model.errorCount > 0 && (
                <span className="sess-drawer-fab-err">
                  <TriangleAlert size={11} aria-hidden="true" />
                  {model.errorCount}
                </span>
              )}
            </button>
          )
        ) : railOpen ? (
          toolRail
        ) : (
          <button
            type="button"
            className="sess-rail-reopen"
            onClick={() => setRailOpen(true)}
            title="Show tool rail (t)"
            aria-label="Show tool rail"
          >
            <PanelRightOpen size={14} aria-hidden="true" />
            <span className="sess-rail-reopen-label">Tools</span>
            {model.ledger.length > 0 && (
              <span className="sess-rail-reopen-count">
                {model.ledger.length}
              </span>
            )}
          </button>
        )}
      </div>

      {searchOpen && sessionId && (
        <SearchOverlay
          sessionId={sessionId}
          agentId={agentId ?? "root"}
          agentLabel={agentLabel}
          loadedTurns={conv.turns}
          onPick={onSearchPick}
          onClose={() => setSearchOpen(false)}
        />
      )}
    </PageLayout>
  );
}

/* ── helpers ── */

/** Synchronous matchMedia read (false where unavailable, e.g. jsdom). */
function matchesMedia(query: string): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(query).matches
  );
}

/** Live media-query state (guarded for environments without matchMedia). */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesMedia(query));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // Legacy listener API (older WebKit).
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);
  return matches;
}

function toggleIn(
  set: React.Dispatch<React.SetStateAction<Set<string>>>,
  key: string,
): void {
  set((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
}

/**
 * One-line "latest activity" per LIVE subagent (nav-rail subtitles): probe the
 * tail (limit=3) of each running agent, take its most recent tool call. Root
 * is never probed (its transcript can be tens of MB on the pre-pagination
 * backend; its activity is the conversation itself). Re-probes when the tree
 * refreshes (which the SSE stream already debounces).
 */
function useLiveSubtitles(
  sessionId: string | null,
  tree: SessionTree | null,
): Map<string, string> {
  const [subtitles, setSubtitles] = useState<Map<string, string>>(new Map());
  const runningIds = useMemo(
    () =>
      tree
        ? tree.agents
            .filter((a) => a.status === "running")
            .map((a) => a.id)
            .slice(0, 6)
        : [],
    [tree],
  );
  const runningKey = runningIds.join(",");

  useEffect(() => {
    if (!sessionId || runningIds.length === 0) {
      setSubtitles((m) => (m.size === 0 ? m : new Map()));
      return;
    }
    let live = true;
    void Promise.all(
      runningIds.map(async (id) => {
        try {
          const c = await fetchAgentWindow(sessionId, id, { limit: 3 });
          for (let i = c.turns.length - 1; i >= 0; i--) {
            for (let j = c.turns[i].blocks.length - 1; j >= 0; j--) {
              const b = c.turns[i].blocks[j];
              if (b.kind === "tool_use") {
                return [
                  id,
                  `${b.name} · ${humanToolSummary(b.name, b.summary)}`,
                ] as const;
              }
            }
          }
          return [id, "working…"] as const;
        } catch {
          return [id, ""] as const;
        }
      }),
    ).then((entries) => {
      if (!live) return;
      setSubtitles(new Map(entries.filter(([, v]) => v !== "")));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, runningKey, tree]);

  return subtitles;
}
