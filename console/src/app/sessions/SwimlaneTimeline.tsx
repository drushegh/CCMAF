/**
 * SwimlaneTimeline.tsx — the Sessions center-pane "Timeline" mode (§2.8 of
 * CONSOLE-V2-DESIGN.md): one SVG swimlane per agent (root first, subagents
 * indented under their spawner), bars spanning startedAt → lastActivity with
 * thickness stepped by output tokens, tool-event ticks coloured by tool class
 * (errors = ✕ glyph — shape, not just hue), idle-gap snipping (⌇), a bottom
 * brush for zoom, and click-through to the conversation (S2 turn anchors).
 *
 * Motion restraint: the live bar's pulsing right edge is the ONLY animation,
 * and prefers-reduced-motion swaps it for a static arrow (swimlane.css).
 * Density restraint: events are binned server-side past ~2000/agent AND
 * client-side into 2px buckets — a dense burst renders as one ▮ block, never
 * an overplot smear.
 */
//
// INTEGRATION (for the SessionsPage owner — the pane-header mode switch is
// deliberately NOT wired here):
//
//   Mount this in place of the conversation scroller when the route says
//   `?mode=timeline` (the `Conversation | Timeline` segment in the pane
//   header reflects to that param, §2.8 / S2):
//
//     {mode === "timeline" ? (
//       <SwimlaneTimeline
//         sessionId={sessionId}
//         initialCenterTs={searchParams.get("t") ?? undefined}  // ?t=<iso>
//         onJumpToTurn={({ agentId, turnUuid }) => {
//           // Tick click → Conversation mode at that turn (existing deep-link
//           // chase + flash treatment). turnUuid === null (bar click) → the
//           // agent's conversation tail, no ?turn=.
//           navigate(
//             turnUuid
//               ? `/sessions/${sessionId}/${agentId}?turn=${encodeURIComponent(turnUuid)}`
//               : `/sessions/${sessionId}/${agentId}`,
//           );
//         }}
//       />
//     ) : (
//       <ConversationPane … />
//     )}
//
//   · The component fills its container (height 100%), fetches
//     /api/sessions/:id/timeline itself, and live-follows via the existing
//     per-session SSE stream — no other props are needed.
//   · When the user enters Timeline FROM a conversation turn, pass that
//     turn's timestamp as initialCenterTs (this is what `?t=` carries): the
//     view zooms to a window centred there and draws a dashed cursor marker.
//   · The nav rail + tool rail stay mounted — this replaces ONLY the center
//     scroller, so "the center is the session" holds.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from "react";
import { subscribeToSession } from "../api/sessions";
import "../../styles/swimlane.css";

/* ── Types (mirror src/server/parsers/transcript-insights.ts — the SPA never
      imports server code) ── */

export interface TimelineEvent {
  ts: string;
  toolUseId: string;
  name: string;
  isError: boolean;
  turnUuid: string;
  durMs?: number;
  summary?: string;
  /** >1 → server-side bin standing for `bin` collapsed events. */
  bin?: number;
  binErrors?: number;
}

export interface SwimlaneAgent {
  id: string;
  agentType: string;
  parentId: string | null;
  spawnTurnUuid: string | null;
  startedAt: string | null;
  /** null = still live (bar runs to "now"). */
  endedAt: string | null;
  outputTokens: number;
  events: TimelineEvent[];
}

export interface TimeGap {
  fromTs: string;
  toTs: string;
}

export interface SwimlaneData {
  sessionId: string;
  agents: SwimlaneAgent[];
  gaps: TimeGap[];
}

/** S2 turn anchor. turnUuid null = the agent's conversation tail. */
export interface TurnAnchor {
  sessionId: string;
  agentId: string;
  turnUuid: string | null;
}

export interface SwimlaneTimelineProps {
  sessionId: string;
  onJumpToTurn: (anchor: TurnAnchor) => void;
  /** ISO timestamp to centre on when entering from a conversation turn (?t=). */
  initialCenterTs?: string;
}

/* ── Geometry / behaviour constants ── */

const LABEL_W = 118;
const PAD_R = 16;
const AXIS_H = 22;
const LANE_H = 30;
const BRUSH_H = 26;
const BRUSH_GAP = 12;
/** Snipped idle gap renders as this many px (§2.8 "12px snip glyph"). */
const SNIP_PX = 12;
/** Client-side density-bin bucket (§2.8 ">1 event per 2px"). */
const BUCKET_PX = 2;
const MIN_DOMAIN_MS = 60_000;
/** A gap only snips if, after clipping to the visible domain, it's still long. */
const MIN_GAP_MS = 10 * 60_000;
const LIVE_TICK_MS = 10_000;
const REFETCH_MIN_GAP_MS = 4_000;

/* ── Small pure helpers ── */

function parseMs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

/** Bar thickness in 3 steps by output tokens (§2.8: <5k, <25k, ≥25k). */
function barThickness(outputTokens: number): number {
  if (outputTokens >= 25_000) return 10;
  if (outputTokens >= 5_000) return 7;
  return 4;
}

type ToolCls = "edit" | "read" | "bash" | "other";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "Grep", "Glob", "WebFetch", "WebSearch"]);
const BASH_TOOLS = new Set(["Bash", "BashOutput"]);

function toolClass(name: string): ToolCls {
  if (EDIT_TOOLS.has(name)) return "edit";
  if (READ_TOOLS.has(name)) return "read";
  if (BASH_TOOLS.has(name)) return "bash";
  return "other";
}

/** Lane hue from the shipped agent-hue tokens (theme.css). Substring rules,
 *  most-specific first; unknown types fall to the neutral ops hue. */
function agentHueVar(agentType: string, isRoot: boolean): string {
  if (isRoot) return "var(--hue-orch)";
  const t = agentType.toLowerCase();
  if (t.includes("arch")) return "var(--hue-arch)";
  if (t.includes("test") || t.includes("qa")) return "var(--hue-test)";
  if (t.includes("review") || t.includes("critic") || t.includes("verif")) {
    return "var(--hue-rev)";
  }
  if (t.includes("research") || t.includes("explor") || t.includes("guide")) {
    return "var(--hue-res)";
  }
  if (t.includes("dev") || t.includes("engineer")) return "var(--hue-dev)";
  if (t.includes("design") || t.startsWith("ui") || t.startsWith("ux")) {
    return "var(--hue-dev)"; // UI builders share the builder amber
  }
  return "var(--hue-ops)";
}

/** Deterministic in-lane y-jitter from the tool-use id (stable across renders). */
function jitterOf(id: string, amp: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 1000) / 1000 - 0.5) * 2 * amp;
}

function fmtClock(ms: number, withSeconds = false): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function fmtGapLen(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
}

/* ── Time scale with idle-gap snips ── */

interface ScaleSnip {
  x0: number;
  fromMs: number;
  toMs: number;
}

interface Seg {
  t0: number;
  t1: number;
  x0: number;
  x1: number;
}

interface TimeScale {
  d0: number;
  d1: number;
  x: (ms: number) => number;
  invert: (px: number) => number;
  snips: ScaleSnip[];
  /** Visible span with snipped gaps removed (axis-step selection). */
  realMs: number;
}

/** Piecewise-linear time→px scale: idle gaps compress to SNIP_PX each. */
function buildScale(
  d0: number,
  d1: number,
  gaps: TimeGap[],
  px0: number,
  px1: number,
): TimeScale {
  // Clip gaps to the domain, keep only still-long ones, merge overlaps.
  const clipped = gaps
    .map((g) => ({
      from: Math.max(parseMs(g.fromTs) ?? Number.NaN, d0),
      to: Math.min(parseMs(g.toTs) ?? Number.NaN, d1),
    }))
    .filter(
      (g) =>
        Number.isFinite(g.from) &&
        Number.isFinite(g.to) &&
        g.to - g.from >= MIN_GAP_MS,
    )
    .sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const g of clipped) {
    const last = merged[merged.length - 1];
    if (last && g.from <= last.to) last.to = Math.max(last.to, g.to);
    else merged.push({ ...g });
  }

  const width = Math.max(10, px1 - px0);
  const gapMs = merged.reduce((n, g) => n + (g.to - g.from), 0);
  const realMs = Math.max(1, d1 - d0 - gapMs);
  const pxPerMs = Math.max(0, width - merged.length * SNIP_PX) / realMs;

  const segs: Seg[] = [];
  const snips: ScaleSnip[] = [];
  let t = d0;
  let px = px0;
  for (const g of merged) {
    const pxAt = px + (g.from - t) * pxPerMs;
    segs.push({ t0: t, t1: g.from, x0: px, x1: pxAt });
    snips.push({ x0: pxAt, fromMs: g.from, toMs: g.to });
    px = pxAt + SNIP_PX;
    t = g.to;
  }
  segs.push({ t0: t, t1: d1, x0: px, x1: px1 });

  const x = (ms: number): number => {
    const m = Math.min(Math.max(ms, d0), d1);
    for (const s of segs) {
      if (m >= s.t0 && m <= s.t1) {
        return s.t1 === s.t0
          ? s.x0
          : s.x0 + ((m - s.t0) / (s.t1 - s.t0)) * (s.x1 - s.x0);
      }
    }
    // Inside a snipped gap → proportional position within its 12px band.
    for (const s of snips) {
      if (m >= s.fromMs && m <= s.toMs) {
        return s.x0 + ((m - s.fromMs) / (s.toMs - s.fromMs)) * SNIP_PX;
      }
    }
    return px1;
  };

  const invert = (p: number): number => {
    const q = Math.min(Math.max(p, px0), px1);
    for (const s of segs) {
      if (q >= s.x0 && q <= s.x1) {
        return s.x1 === s.x0
          ? s.t0
          : s.t0 + ((q - s.x0) / (s.x1 - s.x0)) * (s.t1 - s.t0);
      }
    }
    for (const s of snips) {
      if (q >= s.x0 && q <= s.x0 + SNIP_PX) {
        return s.fromMs + ((q - s.x0) / SNIP_PX) * (s.toMs - s.fromMs);
      }
    }
    return d1;
  };

  return { d0, d1, x, invert, snips, realMs };
}

/* ── Axis ticks ── */

const TICK_STEPS_MS = [
  30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000,
  7_200_000, 10_800_000, 21_600_000, 43_200_000, 86_400_000,
];

function axisTicks(
  scale: TimeScale,
  innerW: number,
): { x: number; label: string }[] {
  const maxTicks = Math.max(3, Math.floor(innerW / 88));
  const step =
    TICK_STEPS_MS.find((s) => scale.realMs / s <= maxTicks) ??
    TICK_STEPS_MS[TICK_STEPS_MS.length - 1];
  const out: { x: number; label: string }[] = [];
  const inSnip = (t: number): boolean =>
    scale.snips.some((s) => t > s.fromMs && t < s.toMs);
  for (
    let t = Math.ceil(scale.d0 / step) * step;
    t <= scale.d1 && out.length < 60;
    t += step
  ) {
    if (inSnip(t)) continue;
    const label =
      step >= 86_400_000
        ? new Date(t).toLocaleDateString([], { day: "numeric", month: "short" })
        : fmtClock(t);
    out.push({ x: scale.x(t), label });
  }
  return out;
}

/* ── Lane ordering (DFS: root first, children under spawner) ── */

interface Lane {
  agent: SwimlaneAgent;
  depth: number;
}

function buildLanes(agents: SwimlaneAgent[]): Lane[] {
  const byParent = new Map<string | null, SwimlaneAgent[]>();
  const known = new Set(agents.map((a) => a.id));
  for (const a of agents) {
    // Orphans (parent id unknown — shouldn't happen) group under the root.
    const key =
      a.parentId !== null && !known.has(a.parentId) ? "root" : a.parentId;
    const list = byParent.get(key) ?? [];
    list.push(a);
    byParent.set(key, list);
  }
  // Siblings in spawn order: startedAt ASC, server (file-name) order tiebreak.
  for (const list of byParent.values()) {
    list.sort((a, b) => {
      const ta = parseMs(a.startedAt);
      const tb = parseMs(b.startedAt);
      if (ta !== null && tb !== null && ta !== tb) return ta - tb;
      return 0; // stable sort keeps server order
    });
  }
  const out: Lane[] = [];
  const seen = new Set<string>();
  const visit = (a: SwimlaneAgent, depth: number): void => {
    if (seen.has(a.id)) return;
    seen.add(a.id);
    out.push({ agent: a, depth });
    for (const c of byParent.get(a.id) ?? []) visit(c, depth + 1);
  };
  for (const r of byParent.get(null) ?? []) visit(r, 0);
  for (const a of agents) visit(a, 1); // any stragglers (cycles) — never dropped
  return out;
}

/* ── Client-side density binning (2px buckets) ── */

interface EventBucket {
  x: number;
  count: number;
  errors: number;
  cls: ToolCls;
  first: TimelineEvent;
  firstMs: number;
  lastMs: number;
  /** Set when the bucket is exactly one raw (un-binned) event. */
  single: TimelineEvent | null;
}

function bucketLaneEvents(
  events: TimelineEvent[],
  scale: TimeScale,
): EventBucket[] {
  interface Acc extends EventBucket {
    clsCounts: Record<ToolCls, number>;
    raw: number;
  }
  const map = new Map<number, Acc>();
  for (const ev of events) {
    const ms = parseMs(ev.ts);
    if (ms === null || ms < scale.d0 || ms > scale.d1) continue;
    const px = scale.x(ms);
    const key = Math.round(px / BUCKET_PX);
    const n = ev.bin ?? 1;
    const errs = ev.binErrors ?? (ev.isError ? 1 : 0);
    let b = map.get(key);
    if (!b) {
      b = {
        x: key * BUCKET_PX,
        count: 0,
        errors: 0,
        cls: "other",
        first: ev,
        firstMs: ms,
        lastMs: ms,
        single: null,
        clsCounts: { edit: 0, read: 0, bash: 0, other: 0 },
        raw: 0,
      };
      map.set(key, b);
    }
    b.count += n;
    b.errors += errs;
    b.raw += 1;
    b.lastMs = Math.max(b.lastMs, ms);
    b.clsCounts[toolClass(ev.name)] += n;
  }
  const out: EventBucket[] = [];
  for (const b of map.values()) {
    let top: ToolCls = "other";
    let topN = -1;
    for (const cls of ["edit", "read", "bash", "other"] as const) {
      if (b.clsCounts[cls] > topN) {
        top = cls;
        topN = b.clsCounts[cls];
      }
    }
    const { clsCounts: _c, raw, ...rest } = b;
    out.push({
      ...rest,
      cls: top,
      single: raw === 1 && (b.first.bin ?? 1) === 1 ? b.first : null,
    });
  }
  out.sort((a, b) => a.x - b.x);
  return out;
}

/* ── Fetch ── */

async function fetchTimeline(sessionId: string): Promise<SwimlaneData> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/timeline`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? "Session not found (or the backend predates the timeline API)."
        : `Timeline request failed (${res.status}).`,
    );
  }
  return (await res.json()) as SwimlaneData;
}

/* ── Tooltip model ── */

interface Tip {
  x: number;
  y: number;
  title: string;
  meta: string;
  error: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════ */

export default function SwimlaneTimeline({
  sessionId,
  onJumpToTurn,
  initialCenterTs,
}: SwimlaneTimelineProps): ReactElement {
  const [data, setData] = useState<SwimlaneData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [brushSel, setBrushSel] = useState<[number, number] | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [width, setWidth] = useState(800);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const lastFetchRef = useRef(0);
  const refetchTimerRef = useRef<number | null>(null);
  const centeredRef = useRef(false);
  const rawId = useId();
  const clipId = `swim-clip-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  /* ── Data loading + live-follow ── */

  const load = useCallback(async (): Promise<void> => {
    lastFetchRef.current = Date.now();
    try {
      const d = await fetchTimeline(sessionId);
      setData(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load timeline.");
    }
  }, [sessionId]);

  useEffect(() => {
    setData(null);
    setError(null);
    setZooms(null);
    centeredRef.current = false;
    void load();
    // Throttled refetch on the existing per-session SSE change stream.
    const unsub = subscribeToSession(sessionId, () => {
      if (refetchTimerRef.current !== null) return;
      const wait = Math.max(
        0,
        REFETCH_MIN_GAP_MS - (Date.now() - lastFetchRef.current),
      );
      refetchTimerRef.current = window.setTimeout(() => {
        refetchTimerRef.current = null;
        void load();
      }, wait);
    });
    return () => {
      unsub();
      if (refetchTimerRef.current !== null) {
        window.clearTimeout(refetchTimerRef.current);
        refetchTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, load]);

  /** Zoom setter that also clears any stale brush selection. */
  function setZooms(z: [number, number] | null): void {
    setZoom(z);
    setBrushSel(null);
  }

  const hasLive = useMemo(
    () => (data ? data.agents.some((a) => a.endedAt === null) : false),
    [data],
  );

  // Live bars run to "now" — advance it on a slow tick while anything is live.
  useEffect(() => {
    if (!hasLive) return;
    const t = window.setInterval(() => setNowMs(Date.now()), LIVE_TICK_MS);
    return () => window.clearInterval(t);
  }, [hasLive]);

  // Container width tracking.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.max(320, Math.floor(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Domain ── */

  const domain = useMemo<[number, number] | null>(() => {
    if (!data) return null;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const a of data.agents) {
      const s = parseMs(a.startedAt);
      if (s !== null) {
        min = Math.min(min, s);
        max = Math.max(max, s);
      }
      const e = parseMs(a.endedAt);
      max = Math.max(max, e ?? nowMs);
      if (a.events.length > 0) {
        const f = parseMs(a.events[0].ts);
        const l = parseMs(a.events[a.events.length - 1].ts);
        if (f !== null) min = Math.min(min, f);
        if (l !== null) max = Math.max(max, l);
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    if (max - min < MIN_DOMAIN_MS) max = min + MIN_DOMAIN_MS;
    return [min, max];
  }, [data, nowMs]);

  // ?t= cursor-sync: zoom to a window centred on the entry turn, once.
  useEffect(() => {
    if (!data || !domain || centeredRef.current) return;
    centeredRef.current = true;
    const c = parseMs(initialCenterTs ?? null);
    if (c === null || c < domain[0] || c > domain[1]) return;
    const span = domain[1] - domain[0];
    const w = Math.min(span, Math.max(5 * 60_000, span * 0.15));
    if (w >= span) return;
    let z0 = c - w / 2;
    let z1 = c + w / 2;
    if (z0 < domain[0]) {
      z1 += domain[0] - z0;
      z0 = domain[0];
    }
    if (z1 > domain[1]) {
      z0 -= z1 - domain[1];
      z1 = domain[1];
    }
    setZoom([Math.max(z0, domain[0]), Math.min(z1, domain[1])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, domain, initialCenterTs]);

  const centerMs = useMemo(
    () => parseMs(initialCenterTs ?? null),
    [initialCenterTs],
  );

  /* ── Derived render model ── */

  const lanes = useMemo(() => (data ? buildLanes(data.agents) : []), [data]);

  const view = useMemo(() => {
    if (!data || !domain || lanes.length === 0) return null;
    const [d0Full, d1Full] = domain;
    const z0 = zoom ? Math.max(zoom[0], d0Full) : d0Full;
    const z1 = zoom ? Math.min(zoom[1], d1Full) : d1Full;
    if (z1 - z0 < 1_000) return null;
    const plotX0 = LABEL_W;
    const plotX1 = width - PAD_R;
    if (plotX1 - plotX0 < 60) return null;
    const scale = buildScale(z0, z1, data.gaps, plotX0, plotX1);
    const brushScale = buildScale(d0Full, d1Full, data.gaps, plotX0, plotX1);
    const lanesTop = AXIS_H + 4;
    const lanesBottom = lanesTop + lanes.length * LANE_H;
    const brushTop = lanesBottom + BRUSH_GAP;
    const svgH = brushTop + BRUSH_H + 6;
    return {
      scale,
      brushScale,
      z0,
      z1,
      plotX0,
      plotX1,
      lanesTop,
      lanesBottom,
      brushTop,
      svgH,
      ticks: axisTicks(scale, plotX1 - plotX0),
    };
  }, [data, domain, lanes, zoom, width]);

  /* ── Interactions ── */

  const jump = useCallback(
    (agentId: string, turnUuid: string | null): void => {
      onJumpToTurn({ sessionId, agentId, turnUuid });
    },
    [onJumpToTurn, sessionId],
  );

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === "Escape" && zoom) {
      e.stopPropagation();
      setZooms(null);
    }
  };

  const svgPxOf = (e: ReactPointerEvent): number => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect ? e.clientX - rect.left : 0;
  };

  const onBrushDown = (e: ReactPointerEvent<SVGRectElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const x = svgPxOf(e);
    setBrushSel([x, x]);
  };
  const onBrushMove = (e: ReactPointerEvent<SVGRectElement>): void => {
    if (!brushSel) return;
    setBrushSel([brushSel[0], svgPxOf(e)]);
  };
  const onBrushUp = (): void => {
    if (!brushSel || !view) return;
    const [a, b] = [Math.min(...brushSel), Math.max(...brushSel)];
    setBrushSel(null);
    if (b - a < 8) return; // a click, not a drag
    const t0 = view.brushScale.invert(a);
    const t1 = view.brushScale.invert(b);
    if (t1 - t0 >= 5_000) {
      setZoom([t0, t1]);
      containerRef.current?.focus(); // so Esc works right away
    }
  };

  const showTip = (e: ReactMouseEvent, b: EventBucket): void => {
    // Tooltip coordinates are container-relative (the div is absolutely
    // positioned in .swim-root; the svg may sit below a note and can scroll).
    const rect = containerRef.current?.getBoundingClientRect();
    const x = rect ? e.clientX - rect.left : 0;
    const y = rect ? e.clientY - rect.top : 0;
    if (b.single) {
      const ev = b.single;
      setTip({
        x,
        y,
        title: ev.summary ? `${ev.name} · ${ev.summary}` : ev.name,
        meta:
          fmtClock(b.firstMs, true) +
          (ev.durMs !== undefined ? ` · ${fmtDur(ev.durMs)}` : ""),
        error: ev.isError,
      });
    } else {
      setTip({
        x,
        y,
        title: `${b.count} tool calls`,
        meta:
          b.firstMs === b.lastMs
            ? fmtClock(b.firstMs, true)
            : `${fmtClock(b.firstMs, true)} – ${fmtClock(b.lastMs, true)}`,
        error: b.errors > 0,
      });
    }
  };

  /* ── Render ── */

  if (error && !data) {
    return (
      <div className="swim-root" ref={containerRef}>
        <div className="swim-empty" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="swim-empty-retry"
            onClick={() => void load()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data || !domain || !view) {
    return (
      <div className="swim-root" ref={containerRef}>
        <div className="swim-empty">
          {data ? "No datable activity in this session." : "Loading timeline…"}
        </div>
      </div>
    );
  }

  const {
    scale,
    brushScale,
    z0,
    z1,
    plotX0,
    plotX1,
    lanesTop,
    brushTop,
    svgH,
  } = view;
  const onlyRoot = lanes.length === 1;
  const noEvents = data.agents.every((a) => a.events.length === 0);
  const laneIndexById = new Map(lanes.map((l, i) => [l.agent.id, i]));
  const laneCenter = (i: number): number => lanesTop + i * LANE_H + LANE_H / 2;
  const totalEvents = data.agents.reduce(
    (n, a) => n + a.events.reduce((m, e) => m + (e.bin ?? 1), 0),
    0,
  );

  return (
    <div
      className="swim-root"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      aria-label="Session timeline"
    >
      {onlyRoot && !noEvents && (
        <div className="swim-note">
          No subagents — the timeline shows the session's tool activity.
        </div>
      )}
      {zoom && (
        <div className="swim-zoom-chip">
          zoomed · <kbd>Esc</kbd> resets
        </div>
      )}

      {noEvents && onlyRoot ? (
        <div className="swim-empty">
          No tool activity recorded in this session yet.
        </div>
      ) : (
        <div className="swim-scroll">
          <svg
            ref={svgRef}
            className="swim-svg"
            width={width}
            height={svgH}
            role="img"
            aria-label={`Session timeline: ${lanes.length} lane${lanes.length === 1 ? "" : "s"}, ${totalEvents} tool events`}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={plotX0} y={0} width={width - plotX0} height={svgH} />
              </clipPath>
            </defs>

            {/* Axis + gridlines */}
            {view.ticks.map((t) => (
              <g key={`tick-${t.x}`}>
                <text
                  className="swim-axis-label"
                  x={t.x}
                  y={13}
                  textAnchor="middle"
                >
                  {t.label}
                </text>
                <line
                  className="swim-gridline"
                  x1={t.x}
                  x2={t.x}
                  y1={lanesTop}
                  y2={view.lanesBottom}
                />
              </g>
            ))}

            {/* Idle-gap snips (⌇) */}
            {scale.snips.map((s) => (
              <g key={`snip-${s.x0}`}>
                <rect
                  className="swim-snip-band"
                  x={s.x0}
                  y={lanesTop}
                  width={SNIP_PX}
                  height={view.lanesBottom - lanesTop}
                />
                <line
                  className="swim-snip-edge"
                  x1={s.x0}
                  x2={s.x0}
                  y1={lanesTop}
                  y2={view.lanesBottom}
                />
                <line
                  className="swim-snip-edge"
                  x1={s.x0 + SNIP_PX}
                  x2={s.x0 + SNIP_PX}
                  y1={lanesTop}
                  y2={view.lanesBottom}
                />
                <text
                  className="swim-snip-glyph"
                  x={s.x0 + SNIP_PX / 2}
                  y={lanesTop + 12}
                  textAnchor="middle"
                >
                  ⌇
                  <title>{`${fmtGapLen(s.toMs - s.fromMs)} idle — snipped`}</title>
                </text>
              </g>
            ))}

            {/* ?t= cursor-sync marker */}
            {centerMs !== null && centerMs >= z0 && centerMs <= z1 && (
              <line
                className="swim-cursor"
                x1={scale.x(centerMs)}
                x2={scale.x(centerMs)}
                y1={lanesTop}
                y2={view.lanesBottom}
              />
            )}

            {/* Lanes */}
            {lanes.map((lane, i) => {
              const a = lane.agent;
              const isRoot = a.id === "root";
              const hue = agentHueVar(a.agentType, isRoot);
              const laneStyle = { "--swim-hue": hue } as CSSProperties;
              const cy = laneCenter(i);
              const laneTop = lanesTop + i * LANE_H;
              const startMs = parseMs(a.startedAt);
              const endMs = parseMs(a.endedAt) ?? nowMs;
              const live = a.endedAt === null;
              const th = barThickness(a.outputTokens);
              const barVisible =
                startMs !== null && startMs <= z1 && endMs >= z0;
              const bx0 = barVisible ? scale.x(Math.max(startMs, z0)) : 0;
              const bx1 = barVisible ? scale.x(Math.min(endMs, z1)) : 0;
              const parentIdx =
                a.parentId !== null ? laneIndexById.get(a.parentId) : undefined;
              const label = isRoot ? "session" : a.agentType;
              const maxChars = Math.max(4, 15 - lane.depth * 2);
              const buckets = bucketLaneEvents(a.events, scale);

              return (
                <g key={a.id} style={laneStyle}>
                  {i > 0 && (
                    <line
                      className="swim-lane-sep"
                      x1={plotX0}
                      x2={plotX1}
                      y1={laneTop}
                      y2={laneTop}
                    />
                  )}

                  {/* Gutter label (indented under the spawner) */}
                  <text
                    className={`swim-lane-label${isRoot ? " swim-lane-label--root" : ""}`}
                    x={8 + lane.depth * 12}
                    y={cy + 3.5}
                  >
                    {label.length > maxChars
                      ? `${label.slice(0, maxChars - 1)}…`
                      : label}
                    <title>
                      {`${label} (${a.id})` +
                        ` · ${(a.outputTokens / 1000).toFixed(1)}k output tokens` +
                        (live ? " · live" : "")}
                    </title>
                  </text>

                  <g clipPath={`url(#${clipId})`}>
                    {/* Spawn connector elbow */}
                    {barVisible &&
                      parentIdx !== undefined &&
                      startMs !== null &&
                      startMs >= z0 && (
                        <path
                          className="swim-elbow"
                          d={`M ${bx0 - 5} ${laneCenter(parentIdx) + 5} V ${cy} H ${bx0}`}
                        />
                      )}

                    {/* Lane bar */}
                    {barVisible && (
                      <rect
                        className="swim-bar"
                        x={bx0}
                        y={cy - th / 2}
                        width={Math.max(2, bx1 - bx0)}
                        height={th}
                        rx={th / 2}
                        role="button"
                        tabIndex={0}
                        aria-label={`Open ${label} conversation`}
                        onClick={() => jump(a.id, null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            jump(a.id, null);
                          }
                        }}
                      >
                        <title>{`${label} · click to open conversation`}</title>
                      </rect>
                    )}

                    {/* Live right edge: pulse (motion) / arrow (reduced-motion) */}
                    {barVisible && live && endMs <= z1 && (
                      <>
                        <rect
                          className="swim-live-pulse"
                          x={bx1 - 1.5}
                          y={cy - (th + 6) / 2}
                          width={3}
                          height={th + 6}
                          rx={1.5}
                        />
                        <path
                          className="swim-live-arrow"
                          d={`M ${bx1} ${cy - 4} L ${bx1 + 6} ${cy} L ${bx1} ${cy + 4} Z`}
                        />
                      </>
                    )}

                    {/* Tool-event marks (density-binned) */}
                    {buckets.map((b) => {
                      const jy = b.single ? jitterOf(b.single.toolUseId, 5) : 0;
                      const my = cy + jy;
                      const isSingleError = b.single !== null && b.errors > 0;
                      const isBlock = b.single === null;
                      const blockH = Math.min(16, 5 + b.count * 0.5);
                      return (
                        <g
                          key={`b-${b.x}`}
                          className="swim-hit"
                          onClick={() => jump(a.id, b.first.turnUuid || null)}
                          onMouseEnter={(e) => showTip(e, b)}
                          onMouseLeave={() => setTip(null)}
                        >
                          <rect
                            className="swim-hit-rect"
                            x={b.x - 3}
                            y={laneTop}
                            width={6}
                            height={LANE_H}
                          />
                          {isBlock ? (
                            <rect
                              className={`swim-block--${b.cls}`}
                              x={b.x - 1.25}
                              y={cy - blockH / 2}
                              width={2.5}
                              height={blockH}
                              rx={1}
                            />
                          ) : !isSingleError ? (
                            <circle
                              className={`swim-tick--${b.cls}`}
                              cx={b.x}
                              cy={my}
                              r={2}
                            />
                          ) : null}
                          {/* Error ✕ — single error, or an error inside a block */}
                          {(isSingleError || (isBlock && b.errors > 0)) && (
                            <path
                              className="swim-tick-x"
                              d={(() => {
                                const ey = isBlock ? cy - blockH / 2 - 4 : my;
                                return `M ${b.x - 2.6} ${ey - 2.6} L ${b.x + 2.6} ${ey + 2.6} M ${b.x + 2.6} ${ey - 2.6} L ${b.x - 2.6} ${ey + 2.6}`;
                              })()}
                            />
                          )}
                        </g>
                      );
                    })}
                  </g>
                </g>
              );
            })}

            {/* Bottom brush (always full session range) */}
            <g>
              <rect
                className="swim-brush-track"
                x={plotX0}
                y={brushTop}
                width={plotX1 - plotX0}
                height={BRUSH_H}
                rx={4}
              />
              {lanes.map((lane, i) => {
                const a = lane.agent;
                const s = parseMs(a.startedAt);
                if (s === null) return null;
                const e = parseMs(a.endedAt) ?? nowMs;
                const step = Math.max(
                  2,
                  Math.floor((BRUSH_H - 8) / lanes.length),
                );
                const y = brushTop + 4 + Math.min(i * step, BRUSH_H - 8);
                const hue = agentHueVar(a.agentType, a.id === "root");
                return (
                  <rect
                    key={`mini-${a.id}`}
                    className="swim-brush-bar"
                    x={brushScale.x(s)}
                    y={y}
                    width={Math.max(1.5, brushScale.x(e) - brushScale.x(s))}
                    height={2}
                    rx={1}
                    style={{
                      fill: `color-mix(in oklch, ${hue} 70%, transparent)`,
                    }}
                  />
                );
              })}
              {zoom && (
                <rect
                  className="swim-brush-window"
                  x={brushScale.x(z0)}
                  y={brushTop}
                  width={Math.max(2, brushScale.x(z1) - brushScale.x(z0))}
                  height={BRUSH_H}
                  rx={4}
                />
              )}
              {brushSel && (
                <rect
                  className="swim-brush-sel"
                  x={Math.min(...brushSel)}
                  y={brushTop}
                  width={Math.max(1, Math.abs(brushSel[1] - brushSel[0]))}
                  height={BRUSH_H}
                />
              )}
              <rect
                className="swim-brush-overlay"
                x={plotX0}
                y={brushTop}
                width={plotX1 - plotX0}
                height={BRUSH_H}
                onPointerDown={onBrushDown}
                onPointerMove={onBrushMove}
                onPointerUp={onBrushUp}
                onDoubleClick={() => setZooms(null)}
              >
                <title>Drag to zoom · double-click or Esc to reset</title>
              </rect>
            </g>
          </svg>
        </div>
      )}

      {/* Hover tooltip */}
      {tip && (
        <div
          className="swim-tooltip"
          style={{
            left: Math.min(tip.x + 8, Math.max(0, width - 330)),
            top: Math.max(0, tip.y - 8),
            transform: "translateY(-100%)",
          }}
        >
          <div className="swim-tooltip-title">
            {tip.error && (
              <span className="swim-tooltip-error">✕ error · </span>
            )}
            {tip.title}
          </div>
          <div className="swim-tooltip-meta">{tip.meta}</div>
        </div>
      )}
    </div>
  );
}
