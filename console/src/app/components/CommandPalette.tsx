/**
 * CommandPalette.tsx — the ⌘K command palette (CONSOLE-V2-DESIGN.md §2.10,
 * TASK-103).
 *
 * A centered glass overlay (--radius-overlay / --shadow-float) with grouped
 * fuzzy results over injectable sources. The component takes
 * `sources: PaletteSource[]` — each { label, fetch(), toEntry() } — so the
 * Hub's Home instance can later mount the SAME component with a different
 * source registry (scope = injected list, one component).
 *
 * Project-instance sources (buildProjectSources): Tasks, Sessions, Docs,
 * Contracts, Decisions, Gotchas + a static Actions group (toggle theme, set
 * accent, navigate-to-page, open-in-VS-Code). Sources fetch lazily on first
 * open and refresh when >30s stale; a "Recent" group (localStorage, last 8
 * picks) floats on top of the empty-query view.
 *
 * Keyboard: ↑/↓ move, Enter opens, Tab / Shift+Tab cycle source groups,
 * Esc closes.
 *
 * Cross-scope handoff (Phase-4 STUB — interface only, no "Switch to project…"
 * source is registered here): entries may carry a `handoff` action, executed
 * by requestCrossScopeNavigate(). Framed under the shell it posts the
 * contract:console-deep-links message { type: "ccmaf:navigate", rootPath,
 * route } to window.parent (the Hub-served shell validates the origin and
 * forwards the route into the target tab); standalone it resolves
 * rootPath → port via GET /api/registry and window.open()s the target.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CornerDownLeft, Loader2, Search } from "lucide-react";
import { fuzzyScore } from "../lib/fuzzy";
import {
  fetchContracts,
  fetchDecisions,
  fetchTasks,
  type ContractSummary,
  type DecisionEntry,
  type TaskItem,
} from "../api/state";
import { fetchSessions, type SessionSummary } from "../api/sessions";
import { fetchDocsTree, type DocsNode } from "../api/docs";
import { fetchGotchas, type GotchaEntry } from "../api/analytics";
import { ACCENTS, useAccent, type Accent } from "../useAccent";

// ── Palette entry / source / action model ─────────────────────────────────────

/** What executing an entry does. `handoff` is the Phase-4 cross-scope kind. */
export type PaletteAction =
  | { kind: "navigate"; route: string }
  | { kind: "run"; run: (ctx: PaletteRunContext) => void | Promise<void> }
  | { kind: "handoff"; rootPath: string; route: string };

/** Capabilities handed to `run` actions at execution time. */
export interface PaletteRunContext {
  navigate: (route: string) => void;
  toggleTheme: () => void;
  setAccent: (a: Accent) => void;
  close: () => void;
}

export interface PaletteEntry {
  /** Stable id (e.g. "task:TASK-092") — keys the Recent list. */
  id: string;
  /** Primary text the fuzzy scorer matches (and highlights). */
  title: string;
  /** Secondary matched text — IDs, paths (mono, also scored). */
  hint?: string;
  /** Right-aligned meta chip — status, ago. Not scored. */
  meta?: string;
  action: PaletteAction;
}

/**
 * One result group. Method syntax (not property-arrow) is deliberate: it keeps
 * `PaletteSource<Specific>` assignable to `PaletteSource` (bivariance), so a
 * registry can mix typed sources.
 */
export interface PaletteSource<T = unknown> {
  /** Group label, e.g. "Tasks". */
  label: string;
  /** Fetch raw items — called lazily on first open, re-called when >30s stale. */
  fetch(): Promise<T[]>;
  /** Map one raw item to a palette entry. */
  toEntry(item: T): PaletteEntry;
}

// ── Cross-scope handoff (contract:console-deep-links, Phase-4 stub) ──────────

/** Message the shell (Hub) receives to activate a tab + forward a route. */
export interface CrossScopeNavigateMessage {
  type: "ccmaf:navigate";
  /** Absolute project root — the stable key; ports are reassignable. */
  rootPath: string;
  /** In-project SPA route, e.g. "/sessions/abc123". */
  route: string;
}

/** Registry entry shape served by GET /api/registry (secrets stripped). */
interface RegistryConsole {
  project: string;
  port: number;
  rootPath: string;
}

/** True when this console runs inside the tabbed shell's iframe. */
export function isEmbeddedInShell(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // cross-origin parent → definitely framed
  }
}

/**
 * Ask for navigation into another project's console. Framed: post the
 * navigate message to the shell (which validates against the registry and
 * routes the target tab). Standalone: resolve rootPath → port via
 * /api/registry and open the target console directly.
 *
 * Phase-4 STUB — exported so the Hub-side "Switch to project…" source can use
 * it; no source in the project instance registers a handoff entry yet.
 */
export async function requestCrossScopeNavigate(
  rootPath: string,
  route: string,
): Promise<void> {
  const msg: CrossScopeNavigateMessage = {
    type: "ccmaf:navigate",
    rootPath,
    route,
  };
  if (isEmbeddedInShell()) {
    // No secret travels here; the RECEIVING shell validates sender origin
    // against the registry's loopback ports (§2.10).
    window.parent.postMessage(msg, "*");
    return;
  }
  const res = await fetch("/api/registry", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`registry unavailable (${res.status})`);
  const consoles = (await res.json()) as RegistryConsole[];
  const hit = consoles.find((c) => c.rootPath === rootPath);
  if (!hit) throw new Error(`no running console for ${rootPath}`);
  const path = route.startsWith("/") ? route : `/${route}`;
  window.open(`http://127.0.0.1:${hit.port}${path}`, "_blank", "noopener");
}

// ── Recent picks (localStorage, last 8) ───────────────────────────────────────

const RECENT_KEY = "console-palette-recent";
const RECENT_MAX = 8;

interface RecentPick {
  id: string;
  title: string;
  hint?: string;
  meta?: string;
  /** Stored for navigate/handoff entries so a stale pick can still navigate. */
  route?: string;
}

function readRecent(): RecentPick[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RecentPick =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as RecentPick).id === "string" &&
        typeof (r as RecentPick).title === "string",
    );
  } catch {
    return [];
  }
}

function pushRecent(entry: PaletteEntry): void {
  const route =
    entry.action.kind === "navigate" || entry.action.kind === "handoff"
      ? entry.action.route
      : undefined;
  const pick: RecentPick = {
    id: entry.id,
    title: entry.title,
    hint: entry.hint,
    meta: entry.meta,
    route,
  };
  const next = [pick, ...readRecent().filter((r) => r.id !== entry.id)].slice(
    0,
    RECENT_MAX,
  );
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — Recent is a nicety */
  }
}

// ── Project-instance source registry ──────────────────────────────────────────

function ago(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function flattenDocFiles(
  node: DocsNode | null,
  out: DocsNode[] = [],
): DocsNode[] {
  if (!node) return out;
  if (node.type === "file") out.push(node);
  for (const child of node.children ?? []) flattenDocFiles(child, out);
  return out;
}

const NAV_PAGES: { route: string; label: string }[] = [
  { route: "/dashboard", label: "Dashboard" },
  { route: "/kanban", label: "Kanban" },
  { route: "/sessions", label: "Sessions" },
  { route: "/verify", label: "Verify" },
  { route: "/status", label: "Status" },
  { route: "/findings", label: "Findings" },
  { route: "/gotchas", label: "Gotchas" },
  { route: "/contracts", label: "Contracts" },
  { route: "/decisions", label: "Decisions" },
  { route: "/spec", label: "Spec" },
  { route: "/docs", label: "Docs" },
  { route: "/readme", label: "README" },
];

/**
 * Open the project root in VS Code via the vscode:// protocol handler.
 * ⚠️ Needs a protocol smoke-test in the chromeless --app window (§2.3 flags
 * the same caveat for per-file links) — the OS prompt behaviour is untested.
 */
async function openProjectInVsCode(): Promise<void> {
  const res = await fetch("/api/health", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return;
  const health = (await res.json()) as { projectRoot?: string };
  if (!health.projectRoot) return;
  const posix = health.projectRoot.replace(/\\/g, "/");
  window.open(`vscode://file/${encodeURI(posix)}`, "_blank");
}

/**
 * The static Actions group. Future actions (copy-resume #5, file-gotcha #7,
 * timeline #8) slot in by appending an entry here — `run(ctx)` receives
 * navigate/theme/accent/close capabilities, so no palette rewrite is needed.
 */
function buildActionEntries(): PaletteEntry[] {
  return [
    {
      id: "action:toggle-theme",
      title: "Toggle theme",
      meta: "dark / light",
      action: { kind: "run", run: (ctx) => ctx.toggleTheme() },
    },
    ...ACCENTS.map((a): PaletteEntry => ({
      id: `action:accent-${a}`,
      title: `Accent: ${a}`,
      action: { kind: "run", run: (ctx) => ctx.setAccent(a) },
    })),
    ...NAV_PAGES.map((p): PaletteEntry => ({
      id: `action:go-${p.route}`,
      title: `Go to ${p.label}`,
      action: { kind: "navigate", route: p.route },
    })),
    {
      id: "action:open-vscode",
      title: "Open project in VS Code",
      hint: "vscode://",
      action: { kind: "run", run: () => openProjectInVsCode() },
    },
  ];
}

/**
 * The project-scoped source registry — existing cheap reads only
 * (contract:console-http-api endpoints). The Hub's Home instance will inject
 * its own registry (projects, global sessions, global inbox, Hub actions).
 */
export function buildProjectSources(): PaletteSource[] {
  const tasks: PaletteSource<TaskItem> = {
    label: "Tasks",
    fetch: async () => {
      const board = await fetchTasks();
      return board.columns.flatMap((c) => c.items).filter((t) => !t.archived);
    },
    toEntry: (t) => ({
      id: `task:${t.id}`,
      title: t.title,
      hint: t.id,
      meta: t.status,
      action: {
        kind: "navigate",
        // S2 grammar /kanban?task=… — the CardDetailPanel auto-open is a
        // separate S2 work item; lane= keeps the right lane visible today.
        route: `/kanban?lane=${t.lane}&task=${encodeURIComponent(t.id)}`,
      },
    }),
  };

  const sessions: PaletteSource<SessionSummary> = {
    label: "Sessions",
    fetch: () => fetchSessions(),
    toEntry: (s) => ({
      id: `session:${s.id}`,
      title: s.title ?? s.firstPrompt ?? s.id.slice(0, 8),
      hint: s.id.slice(0, 8),
      meta: [
        ago(s.lastActivity),
        s.agentCount > 0 ? `${s.agentCount} agents` : "",
      ]
        .filter(Boolean)
        .join(" · "),
      action: {
        kind: "navigate",
        route: `/sessions/${encodeURIComponent(s.id)}`,
      },
    }),
  };

  const docs: PaletteSource<DocsNode> = {
    label: "Docs",
    fetch: async () => flattenDocFiles((await fetchDocsTree()).root),
    // DocsPage has no ?path= deep-select yet (S2 follow-up) — land on /docs.
    toEntry: (n) => ({
      id: `doc:${n.path}`,
      title: n.name,
      hint: n.path,
      action: { kind: "navigate", route: "/docs" },
    }),
  };

  const contracts: PaletteSource<ContractSummary> = {
    label: "Contracts",
    fetch: () => fetchContracts(),
    toEntry: (c) => ({
      id: `contract:${c.id}`,
      title: c.title || c.id,
      hint: c.id,
      meta: c.status,
      action: { kind: "navigate", route: "/contracts" },
    }),
  };

  const decisions: PaletteSource<DecisionEntry> = {
    label: "Decisions",
    fetch: () => fetchDecisions(),
    toEntry: (d) => ({
      id: `decision:${d.id}`,
      title: d.title,
      hint: d.id,
      meta: d.status ?? d.date,
      action: { kind: "navigate", route: "/decisions" },
    }),
  };

  const gotchas: PaletteSource<GotchaEntry> = {
    label: "Gotchas",
    fetch: () => fetchGotchas(),
    toEntry: (g) => ({
      id: `gotcha:${g.title}`,
      title: g.title,
      meta: g.category,
      action: { kind: "navigate", route: "/gotchas" },
    }),
  };

  const actions: PaletteSource<PaletteEntry> = {
    label: "Actions",
    fetch: async () => buildActionEntries(),
    toEntry: (e) => e,
  };

  return [tasks, sessions, docs, contracts, decisions, gotchas, actions];
}

// ── The component ─────────────────────────────────────────────────────────────

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  sources: PaletteSource[];
  /**
   * Theme toggle from the mounting scope — Shell owns the useTheme instance,
   * so its header icon stays in sync when the palette flips the theme.
   */
  onToggleTheme: () => void;
}

interface ResultRow {
  entry: PaletteEntry;
  /** Highlight positions into `title` (present when the title matched). */
  positions?: number[];
  flatIdx: number;
}

interface ResultGroup {
  label: string;
  rows: ResultRow[];
}

const STALE_MS = 30_000;
const EMPTY_QUERY_CAP = 5; // entries shown per group before typing
const QUERY_CAP = 8; // matched entries kept per group
const RECENT_BOOST = 15;

function Highlight({
  text,
  positions,
}: {
  text: string;
  positions?: number[];
}) {
  if (!positions || positions.length === 0) return <>{text}</>;
  const set = new Set(positions);
  return (
    <>
      {Array.from(text).map((ch, i) =>
        set.has(i) ? (
          <mark key={i} className="palette-hl">
            {ch}
          </mark>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

export function CommandPalette({
  open,
  onClose,
  sources,
  onToggleTheme,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [pending, setPending] = useState(0);
  // Bumped when a source lands so the results memo recomputes.
  const [loadedTick, setLoadedTick] = useState(0);
  const cacheRef = useRef(
    new Map<string, { at: number; entries: PaletteEntry[] }>(),
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  // NOTE: a second useAccent instance — writes through to <html> + storage
  // correctly; AccentPicker's own checkmark may go stale until next pick.
  const { setAccent } = useAccent();

  // Lazy fetch on open; refresh sources whose cache is >30s old.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIdx(0);
    const now = Date.now();
    for (const src of sources) {
      const cached = cacheRef.current.get(src.label);
      if (cached && now - cached.at < STALE_MS) continue;
      setPending((p) => p + 1);
      void src
        .fetch()
        .then(
          (items) => {
            cacheRef.current.set(src.label, {
              at: Date.now(),
              entries: items.map((i) => src.toEntry(i)),
            });
          },
          () => {
            // Failed source: keep any stale cache; otherwise show nothing for
            // this group (per-source isolation — one dead endpoint never
            // blanks the palette).
            if (!cacheRef.current.has(src.label)) {
              cacheRef.current.set(src.label, { at: Date.now(), entries: [] });
            }
          },
        )
        .finally(() => {
          setPending((p) => p - 1);
          setLoadedTick((t) => t + 1);
        });
    }
  }, [open, sources]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  /** Find a live entry by id across all cached sources (Recent resolution). */
  const resolveById = useCallback((id: string): PaletteEntry | null => {
    for (const cached of cacheRef.current.values()) {
      for (const e of cached.entries) if (e.id === id) return e;
    }
    return null;
  }, []);

  const { groups, flat } = useMemo(() => {
    const q = query.trim();
    const outGroups: ResultGroup[] = [];
    const outFlat: ResultRow[] = [];
    let flatIdx = 0;
    const push = (label: string, rows: Omit<ResultRow, "flatIdx">[]) => {
      if (rows.length === 0) return;
      const numbered = rows.map((r) => ({ ...r, flatIdx: flatIdx++ }));
      outGroups.push({ label, rows: numbered });
      outFlat.push(...numbered);
    };

    const recents = readRecent();
    if (!q) {
      // Recent floats on top of the empty-query view.
      const rows: Omit<ResultRow, "flatIdx">[] = [];
      for (const r of recents) {
        const live = resolveById(r.id);
        if (live) rows.push({ entry: live });
        else if (r.route)
          rows.push({
            entry: {
              id: r.id,
              title: r.title,
              hint: r.hint,
              meta: r.meta,
              action: { kind: "navigate", route: r.route },
            },
          });
        // unresolvable non-navigate pick (e.g. removed action) → drop
      }
      push("Recent", rows);
    }
    const recentIds = new Set(recents.map((r) => r.id));

    for (const src of sources) {
      const cached = cacheRef.current.get(src.label);
      if (!cached) continue; // still loading
      if (!q) {
        push(
          src.label,
          cached.entries.slice(0, EMPTY_QUERY_CAP).map((entry) => ({ entry })),
        );
        continue;
      }
      const scored = cached.entries
        .map((entry) => {
          const onTitle = fuzzyScore(q, entry.title);
          const onHint = entry.hint ? fuzzyScore(q, entry.hint) : null;
          if (!onTitle && !onHint) return null;
          const best = Math.max(
            onTitle?.score ?? -Infinity,
            onHint?.score ?? -Infinity,
          );
          const score = best + (recentIds.has(entry.id) ? RECENT_BOOST : 0);
          const positions =
            onTitle && onTitle.score >= (onHint?.score ?? -Infinity)
              ? onTitle.positions
              : undefined;
          return { entry, positions, score };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.score - a.score)
        .slice(0, QUERY_CAP);
      push(
        src.label,
        scored.map(({ entry, positions }) => ({ entry, positions })),
      );
    }
    return { groups: outGroups, flat: outFlat };
    // loadedTick invalidates when a source cache lands/refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sources, loadedTick, open, resolveById]);

  // Keep the active row valid as results change; reset on new query.
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);
  useEffect(() => {
    setActiveIdx((i) => Math.min(i, Math.max(0, flat.length - 1)));
  }, [flat.length]);
  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(`palette-opt-${activeIdx}`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeIdx, open]);

  const runCtx: PaletteRunContext = {
    navigate: (route) => navigate(route),
    toggleTheme: onToggleTheme,
    setAccent,
    close: onClose,
  };

  const execute = (entry: PaletteEntry) => {
    pushRecent(entry);
    const a = entry.action;
    if (a.kind === "navigate") navigate(a.route);
    else if (a.kind === "handoff")
      void requestCrossScopeNavigate(a.rootPath, a.route);
    else void a.run(runCtx);
    onClose();
  };

  /** Tab / Shift+Tab jump to the first row of the next / previous group. */
  const cycleGroup = (dir: 1 | -1) => {
    if (groups.length === 0) return;
    const starts = groups.map((g) => g.rows[0].flatIdx);
    let cur = groups.length - 1;
    for (let gi = 0; gi < groups.length; gi++) {
      const next = starts[gi + 1] ?? Infinity;
      if (activeIdx >= starts[gi] && activeIdx < next) {
        cur = gi;
        break;
      }
    }
    const n = groups.length;
    setActiveIdx(starts[(((cur + dir) % n) + n) % n]);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Tab") {
      e.preventDefault();
      cycleGroup(e.shiftKey ? -1 : 1);
    } else if (e.key === "Enter" && flat[activeIdx]) {
      e.preventDefault();
      execute(flat[activeIdx].entry);
    }
  };

  if (!open) return null;

  return (
    <div className="palette-backdrop" onClick={onClose} role="presentation">
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="palette-inputrow">
          <Search size={14} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="palette-input"
            placeholder="Jump to a task, session, doc… or run an action"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={
              flat[activeIdx] ? `palette-opt-${activeIdx}` : undefined
            }
            aria-label="Command palette query"
            autoComplete="off"
            spellCheck={false}
          />
          {pending > 0 && (
            <Loader2 size={13} className="palette-spin" aria-hidden="true" />
          )}
        </div>

        <div
          className="palette-list"
          id="palette-list"
          role="listbox"
          aria-label="Results"
        >
          {groups.map((g) => (
            <div key={g.label} className="palette-group" role="presentation">
              <div className="palette-group-label">{g.label}</div>
              {g.rows.map((row) => (
                <button
                  key={row.entry.id}
                  type="button"
                  id={`palette-opt-${row.flatIdx}`}
                  role="option"
                  aria-selected={row.flatIdx === activeIdx ? "true" : "false"}
                  className={`palette-row${row.flatIdx === activeIdx ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveIdx(row.flatIdx)}
                  onClick={() => execute(row.entry)}
                >
                  <span className="palette-row-title">
                    <Highlight
                      text={row.entry.title}
                      positions={row.positions}
                    />
                  </span>
                  {row.entry.hint && (
                    <span className="palette-row-hint">{row.entry.hint}</span>
                  )}
                  {row.entry.meta && (
                    <span className="palette-row-meta">{row.entry.meta}</span>
                  )}
                  <CornerDownLeft
                    size={11}
                    className="palette-row-enter"
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          ))}

          {flat.length === 0 && (
            <div className="palette-none">
              {pending > 0 ? "Loading sources…" : "No matches."}
            </div>
          )}
        </div>

        <div className="palette-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>Tab</kbd> groups
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
