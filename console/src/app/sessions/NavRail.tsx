/**
 * NavRail.tsx — the merged session + agent tree (left pane of the Sessions view).
 *
 * ONE tree: sessions grouped by day ("Live now" pinned on top), the selected
 * session expanded in place with its agents nested under it (live agents
 * pinned first among siblings, pulsing, with a one-line latest-activity
 * subtitle when available). Replaces the old separate session list +
 * horizontal agent band.
 *
 * Selection is routed — clicking navigates; the rail renders whatever the
 * URL says is selected.
 */

import { Fragment } from "react";
import { Bot, ChevronDown, ChevronRight, User } from "lucide-react";
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

/** Agents ordered for display: children nested under parents, live first. */
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
  // Live agents pin first among siblings (stable within each partition).
  for (const list of childrenOf.values()) {
    const live = list.filter((a) => a.status === "running");
    const done = list.filter((a) => a.status !== "running");
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

/** Flat keyboard order for [ / ] agent cycling: root, then nested agents. */
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
  onSelectSession: (sessionId: string) => void;
  onSelectAgent: (sessionId: string, agentId: string) => void;
}

export function NavRail({
  sessions,
  selectedSessionId,
  selectedAgentId,
  tree,
  treeLoading,
  subtitles,
  onSelectSession,
  onSelectAgent,
}: NavRailProps) {
  const { live, days } = groupSessions(sessions);

  const renderSession = (s: SessionSummary, liveGroup: boolean) => {
    const selected = s.id === selectedSessionId;
    return (
      <Fragment key={s.id}>
        <SessionNode
          session={s}
          live={liveGroup}
          selected={selected}
          expanded={selected}
          onSelect={() => onSelectSession(s.id)}
        />
        {selected && (
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
                  selected={selectedAgentId === "root"}
                  subtitle={subtitles.get("root") ?? null}
                  onSelect={() => onSelectAgent(s.id, "root")}
                />
                {orderAgents(tree).map(({ node, depth }) => (
                  <AgentRow
                    key={node.id}
                    node={node}
                    depth={depth + 1}
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
    <nav className="sess-nav" aria-label="Sessions and agents">
      {live.length > 0 && (
        <section
          className="sess-nav-group"
          aria-label={`Live now (${live.length})`}
        >
          <h3 className="sess-nav-day sess-nav-day--live">
            <span className="sess-live-dot" aria-hidden="true" />
            Live now
          </h3>
          {live.map((s) => renderSession(s, true))}
        </section>
      )}
      {days.map((g) => (
        <section key={g.label} className="sess-nav-group" aria-label={g.label}>
          <h3 className="sess-nav-day">{g.label}</h3>
          {g.sessions.map((s) => renderSession(s, false))}
        </section>
      ))}
    </nav>
  );
}

function SessionNode({
  session,
  live,
  selected,
  expanded,
  onSelect,
}: {
  session: SessionSummary;
  live: boolean;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
}) {
  const label =
    session.title ?? session.firstPrompt ?? `${session.id.slice(0, 8)}…`;
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      aria-expanded={expanded ? "true" : "false"}
      className={`sess-nav-session ${selected ? "is-selected" : ""} ${live ? "is-live" : ""}`}
      onClick={onSelect}
    >
      <span className="sess-nav-session-caret" aria-hidden="true">
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </span>
      <span className="sess-nav-session-main">
        <span className="sess-nav-session-title">{label}</span>
        <span className="sess-nav-session-meta">
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
      </span>
    </button>
  );
}

function AgentRow({
  node,
  depth,
  selected,
  subtitle,
  onSelect,
}: {
  node: AgentNode;
  depth: number;
  selected: boolean;
  subtitle: string | null;
  onSelect: () => void;
}) {
  const isRoot = node.id === "root";
  const running = node.status === "running";
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
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
