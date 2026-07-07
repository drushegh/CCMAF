/**
 * NavRail.tsx — the merged session + agent tree (left pane of the Sessions view).
 *
 * ONE tree (role="tree"): sessions grouped by day ("Live now" pinned on top),
 * the selected session expanded in place with its agents nested under it.
 * Sibling agents order by RECENCY — live first, then lastActivity DESC within
 * each partition (§4.1: the agent that just did something is the top row) —
 * with a 5s pointer-freeze guard so live re-sorts never jump rows under the
 * cursor. Session and day-group carets are REAL collapse toggles
 * (`<button aria-expanded>`, BUG-017): `expanded = selected && !collapsed`,
 * collapse state owned by SessionsPage (sessionStorage-persisted). ←/→ on a
 * focused session/day row collapse/expand (tree-view keys). Sessions renamed
 * in the editor carry a subtle pencil glyph (§4.3, titleSource "rename").
 *
 * Selection is routed — clicking navigates; the rail renders whatever the
 * URL says is selected.
 */

import { Fragment, useMemo, useRef } from "react";
import { Bot, ChevronDown, ChevronRight, Pencil, User } from "lucide-react";
import type { AgentNode, SessionSummary, SessionTree } from "../api/sessions";

/* ── time helpers (shared style with the old page) ── */

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diffS = Math.max(0, (Date.now() - then) / 1000);
  if (diffS < 60) return "just now";
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m ago`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h ago`;
  if (diffS < 7 * 86400) return `${Math.floor(diffS / 86400)}d ago`;
  return new Date(then).toLocaleDateString();
}

export function shortModel(model: string | null): string | null {
  if (!model) return null;
  return model.replace(/^claude-/, "");
}

/** Session considered live when its last activity is within this window. */
const LIVE_WINDOW_MS = 120_000;

/** Live re-sorts freeze for this long after any pointer activity over the
 *  rail, so rows never reorder under the cursor mid-click (§4.1). */
const POINTER_FREEZE_MS = 5000;

export function isLiveSession(s: SessionSummary, now = Date.now()): boolean {
  if (!s.lastActivity) return false;
  const t = Date.parse(s.lastActivity);
  return !Number.isNaN(t) && now - t <= LIVE_WINDOW_MS;
}

function dayLabel(iso: string | null, now = new Date()): string {
  if (!iso) return "Undated";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Undated";
  const startOfDay = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/* ── grouping ── */

interface DayGroup {
  label: string;
  sessions: SessionSummary[];
}

export function groupSessions(
  sessions: SessionSummary[],
  now = Date.now(),
): { live: SessionSummary[]; days: DayGroup[] } {
  const live: SessionSummary[] = [];
  const days: DayGroup[] = [];
  const nowDate = new Date(now);
  for (const s of sessions) {
    if (isLiveSession(s, now)) {
      live.push(s);
      continue;
    }
    const label = dayLabel(s.lastActivity, nowDate);
    const last = days[days.length - 1];
    if (last && last.label === label) last.sessions.push(s);
    else days.push({ label, sessions: [s] });
  }
  return { live, days };
}

/** Sibling comparator (§4.1): lastActivity DESC, nulls last, id ASC tiebreak
 *  (stable across polls when timestamps tie). */
function byRecency(a: AgentNode, b: AgentNode): number {
  const ta = a.lastActivity ? Date.parse(a.lastActivity) : NaN;
  const tb = b.lastActivity ? Date.parse(b.lastActivity) : NaN;
  const va = Number.isNaN(ta) ? Number.NEGATIVE_INFINITY : ta;
  const vb = Number.isNaN(tb) ? Number.NEGATIVE_INFINITY : tb;
  if (va !== vb) return vb - va;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Agents ordered for display: children nested under parents (hierarchy is
 * preserved — only SIBLING order changes); within each sibling list the live
 * partition pins first, and BOTH partitions sort most-recent-activity first
 * (§4.1), so the newest agent activity is always the top row under its
 * spawner. `agentCycleOrder` inherits this, so [ / ] cycling follows recency.
 */
export function orderAgents(tree: SessionTree): {
  node: AgentNode;
  depth: number;
}[] {
  const childrenOf = new Map<string, AgentNode[]>();
  for (const a of tree.agents) {
    const pid = a.parentId ?? "root";
    const list = childrenOf.get(pid);
    if (list) list.push(a);
    else childrenOf.set(pid, [a]);
  }
  // Live agents pin first among siblings; each partition sorts by recency.
  for (const list of childrenOf.values()) {
    const live = list.filter((a) => a.status === "running").sort(byRecency);
    const done = list.filter((a) => a.status !== "running").sort(byRecency);
    list.splice(0, list.length, ...live, ...done);
  }
  const out: { node: AgentNode; depth: number }[] = [];
  const walk = (id: string, depth: number): void => {
    for (const child of childrenOf.get(id) ?? []) {
      out.push({ node: child, depth });
      walk(child.id, depth + 1);
    }
  };
  walk("root", 1);
  return out;
}

/** Flat keyboard order for [ / ] agent cycling: root, then nested agents
 *  (recency-ordered — see orderAgents). */
export function agentCycleOrder(tree: SessionTree): string[] {
  return ["root", ...orderAgents(tree).map((a) => a.node.id)];
}

/* ── components ── */

export interface NavRailProps {
  sessions: SessionSummary[];
  selectedSessionId: string | null;
  selectedAgentId: string | null;
  /** Tree of the SELECTED session (agents nest under it), if loaded. */
  tree: SessionTree | null;
  treeLoading: boolean;
  /** agentId → one-line latest activity (live agents; paged backend only). */
  subtitles: Map<string, string>;
  /** Session ids whose agent group the user collapsed (BUG-017) — owned by
   *  SessionsPage, sessionStorage-persisted. `expanded = selected && !has`. */
  collapsedSessions: Set<string>;
  /** Day-group labels the user collapsed ("Live now" is never collapsible). */
  collapsedDays: Set<string>;
  onSelectSession: (sessionId: string) => void;
  onSelectAgent: (sessionId: string, agentId: string) => void;
  onToggleSessionCollapsed: (sessionId: string) => void;
  onToggleDayCollapsed: (label: string) => void;
}

/**
 * Display order of the selected session's agents, with the pointer-freeze
 * guard (§4.1): while the pointer was active over the rail within the last
 * POINTER_FREEZE_MS and the agent SET is unchanged, the previous sibling
 * order is kept (fresh node data, frozen positions) so live re-sorts never
 * yank a row out from under the cursor. A membership change (new agent) or
 * a different session always takes the fresh order.
 */
function useFrozenAgentOrder(
  tree: SessionTree | null,
  lastPointerRef: { readonly current: number },
): { node: AgentNode; depth: number }[] {
  const frozenRef = useRef<{ sessionId: string; ids: string[] } | null>(null);
  return useMemo(() => {
    if (!tree) {
      frozenRef.current = null;
      return [];
    }
    const fresh = orderAgents(tree);
    const prev = frozenRef.current;
    const pointerRecent =
      Date.now() - lastPointerRef.current < POINTER_FREEZE_MS;
    if (
      prev &&
      pointerRecent &&
      prev.sessionId === tree.sessionId &&
      prev.ids.length === fresh.length
    ) {
      const byId = new Map(fresh.map((f) => [f.node.id, f]));
      const remapped: { node: AgentNode; depth: number }[] = [];
      for (const id of prev.ids) {
        const f = byId.get(id);
        if (!f) break;
        remapped.push(f);
      }
      if (remapped.length === fresh.length) return remapped; // freeze holds
    }
    frozenRef.current = {
      sessionId: tree.sessionId,
      ids: fresh.map((f) => f.node.id),
    };
    return fresh;
  }, [tree, lastPointerRef]);
}

export function NavRail({
  sessions,
  selectedSessionId,
  selectedAgentId,
  tree,
  treeLoading,
  subtitles,
  collapsedSessions,
  collapsedDays,
  onSelectSession,
  onSelectAgent,
  onToggleSessionCollapsed,
  onToggleDayCollapsed,
}: NavRailProps) {
  const { live, days } = groupSessions(sessions);

  const lastPointerRef = useRef(0);
  const markPointer = () => {
    lastPointerRef.current = Date.now();
  };
  const orderedAgents = useFrozenAgentOrder(tree, lastPointerRef);

  const renderSession = (
    s: SessionSummary,
    liveGroup: boolean,
    level: number,
  ) => {
    const selected = s.id === selectedSessionId;
    const expanded = selected && !collapsedSessions.has(s.id);
    return (
      <Fragment key={s.id}>
        <SessionNode
          session={s}
          live={liveGroup}
          selected={selected}
          expanded={expanded}
          level={level}
          onSelect={() => onSelectSession(s.id)}
          onToggleExpand={() => {
            // Caret on an unselected session selects it (selection implies
            // interest — SessionsPage clears its collapsed flag on select).
            if (selected) onToggleSessionCollapsed(s.id);
            else onSelectSession(s.id);
          }}
        />
        {expanded && (
          <div
            role="group"
            aria-label="Agents in this session"
            className="sess-nav-agents"
          >
            {treeLoading && !tree && (
              <div className="sess-nav-skeleton" aria-hidden="true">
                <span />
                <span />
              </div>
            )}
            {tree && (
              <>
                <AgentRow
                  node={tree.root}
                  depth={1}
                  level={level + 1}
                  selected={selectedAgentId === "root"}
                  subtitle={subtitles.get("root") ?? null}
                  onSelect={() => onSelectAgent(s.id, "root")}
                />
                {orderedAgents.map(({ node, depth }) => (
                  <AgentRow
                    key={node.id}
                    node={node}
                    depth={depth + 1}
                    level={level + 1 + depth}
                    selected={selectedAgentId === node.id}
                    subtitle={subtitles.get(node.id) ?? null}
                    onSelect={() => onSelectAgent(s.id, node.id)}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <nav
      className="sess-nav"
      aria-label="Sessions and agents"
      onPointerMove={markPointer}
      onPointerDown={markPointer}
    >
      <div role="tree" aria-label="Sessions">
        {live.length > 0 && (
          <div className="sess-nav-group">
            {/* Live-now is NEVER collapsible — a live agent must not be
                hideable by a stale collapse flag. Presentation-only header. */}
            <h3 className="sess-nav-day sess-nav-day--live" role="presentation">
              <span className="sess-live-dot" aria-hidden="true" />
              Live now
              <span className="sess-nav-day-count">({live.length})</span>
            </h3>
            {live.map((s) => renderSession(s, true, 1))}
          </div>
        )}
        {days.map((g) => {
          const collapsed = collapsedDays.has(g.label);
          return (
            <div key={g.label} className="sess-nav-group">
              <button
                type="button"
                role="treeitem"
                aria-level={1}
                aria-expanded={!collapsed}
                className="sess-nav-day sess-nav-day--toggle"
                onClick={() => onToggleDayCollapsed(g.label)}
                onKeyDown={(e) => {
                  if (
                    (e.key === "ArrowLeft" && !collapsed) ||
                    (e.key === "ArrowRight" && collapsed)
                  ) {
                    e.preventDefault();
                    onToggleDayCollapsed(g.label);
                  }
                }}
              >
                <span className="sess-nav-day-caret" aria-hidden="true">
                  {collapsed ? (
                    <ChevronRight size={10} />
                  ) : (
                    <ChevronDown size={10} />
                  )}
                </span>
                {g.label}
                <span className="sess-nav-day-count">
                  ({g.sessions.length})
                </span>
              </button>
              {!collapsed && (
                <div role="group">
                  {g.sessions.map((s) => renderSession(s, false, 2))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}

function SessionNode({
  session,
  live,
  selected,
  expanded,
  level,
  onSelect,
  onToggleExpand,
}: {
  session: SessionSummary;
  live: boolean;
  selected: boolean;
  expanded: boolean;
  level: number;
  onSelect: () => void;
  onToggleExpand: () => void;
}) {
  const label =
    session.title ?? session.firstPrompt ?? `${session.id.slice(0, 8)}…`;
  const renamed = session.titleSource === "rename";
  return (
    // Wrapper div (not a button): the caret is a REAL nested collapse toggle
    // (BUG-017) and buttons cannot legally nest inside buttons.
    <div
      role="treeitem"
      aria-level={level}
      aria-selected={selected}
      aria-expanded={expanded}
      className={`sess-nav-session ${selected ? "is-selected" : ""} ${live ? "is-live" : ""}`}
    >
      <button
        type="button"
        className="sess-nav-session-caret"
        aria-expanded={expanded}
        aria-label={
          expanded ? "Collapse session agents" : "Expand session agents"
        }
        title={expanded ? "Collapse (←)" : "Expand (→)"}
        onClick={(e) => {
          e.stopPropagation();
          onToggleExpand();
        }}
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      <button
        type="button"
        className="sess-nav-session-main"
        aria-current={selected ? "true" : undefined}
        onClick={onSelect}
        onKeyDown={(e) => {
          // Standard tree-view keys: ← collapses, → expands (§4.2).
          if (
            (e.key === "ArrowLeft" && expanded) ||
            (e.key === "ArrowRight" && !expanded)
          ) {
            e.preventDefault();
            onToggleExpand();
          }
        }}
      >
        <span className="sess-nav-session-title">{label}</span>
        <span className="sess-nav-session-meta">
          {renamed && (
            <span
              className="sess-nav-session-renamed"
              title="Renamed in editor"
              aria-label="Renamed in editor"
            >
              <Pencil size={9} aria-hidden="true" />
            </span>
          )}
          {live && <span className="sess-live-label">live</span>}
          <span>{timeAgo(session.lastActivity)}</span>
          {/* Raw transcript records (incl. subagent sidechains) — labelled
              "lines" so it never reads as the per-agent "turns" count in the
              conversation header (they measure different things). */}
          <span>· {session.messageCount} lines</span>
          {session.agentCount > 0 && (
            <span className="sess-nav-session-agents">
              · <Bot size={9} aria-hidden="true" /> {session.agentCount}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

function AgentRow({
  node,
  depth,
  level,
  selected,
  subtitle,
  onSelect,
}: {
  node: AgentNode;
  depth: number;
  level: number;
  selected: boolean;
  subtitle: string | null;
  onSelect: () => void;
}) {
  const isRoot = node.id === "root";
  const running = node.status === "running";
  return (
    <button
      type="button"
      role="treeitem"
      aria-level={level}
      aria-selected={selected}
      className={`sess-nav-agent ${selected ? "is-selected" : ""} ${running ? "is-live" : ""}`}
      style={{ paddingLeft: 14 + depth * 14 }}
      onClick={onSelect}
    >
      <span
        className={`sess-status-dot sess-status-dot--${node.status}`}
        title={running ? "Running" : "Finished"}
        aria-hidden="true"
      />
      <span className="sess-nav-agent-main">
        <span className="sess-nav-agent-head">
          <span
            className={`sess-agent-pill ${isRoot ? "sess-agent-pill--root" : ""}`}
          >
            {isRoot ? (
              <User size={9} aria-hidden="true" />
            ) : (
              <Bot size={9} aria-hidden="true" />
            )}
            {node.agentType}
          </span>
          <span
            className="sess-nav-agent-desc"
            title={node.description ?? undefined}
          >
            {node.description ?? (isRoot ? "Main session" : node.id)}
          </span>
        </span>
        {running && subtitle && (
          <span className="sess-nav-agent-activity" title={subtitle}>
            {subtitle}
          </span>
        )}
      </span>
      <span className="sess-nav-agent-meta">
        {running ? (
          <span className="sess-live-label">live</span>
        ) : (
          <span>{node.messageCount}</span>
        )}
      </span>
    </button>
  );
}
