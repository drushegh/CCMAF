/**
 * transcript-insights.ts — S1: pure aggregators over parsed transcript JSONL
 * (CONSOLE-V2-DESIGN.md "Shared substrate S1"). Feeds #2 burn, #3 ledger,
 * #8 swimlane, #1 show-the-work.
 *
 * Three pure, per-agent-file collectors (each takes parsed lines, returns
 * plain data — no fs, no clock):
 *   collectUsage(lines)       → UsageRollup   (token burn, by model + series)
 *   collectFileTouches(lines) → FileTouch[]   (what files an agent touched)
 *   collectToolEvents(lines)  → ToolEvent[]   (every tool call, error-flagged)
 *
 * Plus the two session-level readers the routes consume:
 *   readSessionInsights(root, sessionId) → SessionInsights | null
 *   readSessionTimeline(root, sessionId) → SwimlaneData | null   (#8)
 *
 * Ground-truth notes (verified against live 2.1.x transcripts, 2026-07-07):
 *   - Assistant lines carry `message.usage` with input_tokens / output_tokens /
 *     cache_read_input_tokens / cache_creation_input_tokens and `message.model`.
 *   - ONE API message is split across SEVERAL transcript lines (one per content
 *     block), each repeating the SAME `message.id` and the SAME usage object —
 *     verified: 838 assistant lines → 300 unique message ids, zero differing
 *     usage within an id. collectUsage therefore dedupes by message.id (falling
 *     back to line uuid) or burn would over-count ~3x.
 *   - tool_use blocks live on assistant lines; the matching tool_result (with
 *     is_error) arrives on a later user line — durMs = result ts − use ts.
 *
 * READ-ONLY over the transcript store, defensive per-line handling (a
 * malformed / unexpected line is skipped, never thrown on).
 *
 * TODO(integration): switch to shared jsonlCache — transcript-parser.ts keys a
 * stat-based LRU over parsed JSONL but does not export it; until it does, this
 * module reads files directly (each insights/timeline request re-reads the
 * session's files). Do not edit transcript-parser.ts from this module's task.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readSessionTree,
  resolveProjectSessionsDir,
  type TranscriptOpts,
} from "./transcript-parser.js";
import type { AgentNode } from "../types.js";

// ── Tunables ──────────────────────────────────────────────────────────────────

/** Per-agent timeline payload cap: past this, events are binned server-side
 *  (spec §2.8 "Payload capped: events binned server-side past 2 000/agent"). */
export const EVENT_BIN_CAP = 2000;

/** An idle stretch at least this long (no line written anywhere in the
 *  session) is reported as a snip-able gap (§2.8 gap-snipping markers). */
export const IDLE_GAP_MS = 30 * 60_000;

/** Tooltip summary cap for timeline events (chars). */
const EVENT_SUMMARY_CAP = 160;

// ── Shapes (S1 contract — the doc's exact fields) ─────────────────────────────

/** Per-model token bucket of one agent file (or a whole-session merge). */
export interface ModelUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Deduped assistant messages (API turns), not transcript lines. */
  turns: number;
}

/** Sparkline-ready cumulative output point (ts = the message's line ts). */
export interface UsagePoint {
  ts: string;
  outputCum: number;
}

export interface UsageRollup {
  byModel: Record<string, ModelUsage>;
  series: UsagePoint[];
}

export type FileTouchTool = "Edit" | "Write" | "NotebookEdit" | "Read" | "Bash";

/** One file an agent touched, with per-tool counts. MultiEdit counts as Edit.
 *  Bash paths are matched heuristically (redirects, tee, rm/mv/cp/touch) — a
 *  file seen ONLY via Bash carries `maybe: true`. */
export interface FileTouch {
  /** Forward-slash-normalised path as the tool input recorded it. */
  path: string;
  tools: Partial<Record<FileTouchTool, number>>;
  firstTs: string | null;
  lastTs: string | null;
  /** tool_use id / turn uuid of the LAST touch (deep-link anchor, S2). */
  lastToolUseId: string;
  turnUuid: string;
  maybe?: boolean;
}

/** One tool call. Events without a line timestamp are skipped (they cannot be
 *  placed on a timeline; real transcripts always stamp lines). */
export interface ToolEvent {
  ts: string;
  toolUseId: string;
  name: string;
  isError: boolean;
  turnUuid: string;
  /** result-line ts − use-line ts, when both present and sane. */
  durMs?: number;
}

/** Timeline-enriched event (#8): adds a tooltip summary and server-side bin
 *  fields. `bin > 1` → this entry stands for `bin` collapsed events (its
 *  ts/turnUuid anchor the bin's FIRST event; isError = binErrors > 0). */
export interface TimelineEvent extends ToolEvent {
  summary?: string;
  bin?: number;
  binErrors?: number;
}

export interface AgentInsights {
  usage: UsageRollup;
  files: FileTouch[];
}

/** GET /api/sessions/:id/insights response. */
export interface SessionInsights {
  sessionId: string;
  /** Whole session incl. subagents (merged rollup). */
  usage: UsageRollup;
  /** Keyed by "root" | agentId. */
  agents: Record<string, AgentInsights>;
}

/** One swimlane (§2.8): the root session or one subagent. */
export interface SwimlaneAgent {
  id: string;
  agentType: string;
  parentId: string | null;
  /** uuid of the spawning turn in the SPAWNER's transcript (elbow/click anchor). */
  spawnTurnUuid: string | null;
  startedAt: string | null;
  /** null = still live (bar runs to "now" client-side). */
  endedAt: string | null;
  outputTokens: number;
  events: TimelineEvent[];
}

export interface TimeGap {
  fromTs: string;
  toTs: string;
}

/** GET /api/sessions/:id/timeline response. */
export interface SwimlaneData {
  sessionId: string;
  /** Root first, then subagents in spawn (file-name) order. */
  agents: SwimlaneAgent[];
  /** Session-wide idle stretches ≥ IDLE_GAP_MS (x-axis snip candidates). */
  gaps: TimeGap[];
}

// ── Line helpers (self-contained; see the TODO(integration) note above) ───────

type Line = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function messageOf(line: Line): Line {
  const m = line.message;
  return m !== null && typeof m === "object" && !Array.isArray(m)
    ? (m as Line)
    : {};
}

function blocksOf(line: Line): Line[] {
  const c = messageOf(line).content;
  if (!Array.isArray(c)) return [];
  return c.filter(
    (b): b is Line => b !== null && typeof b === "object" && !Array.isArray(b),
  );
}

/** Tolerant whole-file JSONL read: malformed lines skipped, [] when unreadable. */
function readJsonlLines(filePath: string): Line[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }
  const out: Line[] = [];
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as unknown;
      if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
        out.push(obj as Line);
      }
    } catch {
      // torn tail line during a live session is normal — skip
    }
  }
  return out;
}

// ── collectUsage ──────────────────────────────────────────────────────────────

/**
 * Token burn of one agent file. Dedupes by `message.id` (one API message spans
 * several transcript lines, each repeating the same usage — see module doc);
 * lines without a message id fall back to their line uuid, so synthetic /
 * older transcripts still count each line once.
 */
export function collectUsage(lines: Iterable<Line>): UsageRollup {
  const byModel: Record<string, ModelUsage> = {};
  const series: UsagePoint[] = [];
  const seen = new Set<string>();
  let outputCum = 0;
  let i = 0;

  for (const line of lines) {
    i++;
    if (line.type !== "assistant") continue;
    const msg = messageOf(line);
    const usage = msg.usage;
    if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
      continue;
    }
    const key = str(msg.id) ?? str(line.uuid) ?? `line-${i}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const u = usage as Line;
    const model = str(msg.model) ?? "unknown";
    const bucket = (byModel[model] ??= {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      turns: 0,
    });
    const output = num(u.output_tokens);
    bucket.input += num(u.input_tokens);
    bucket.output += output;
    bucket.cacheRead += num(u.cache_read_input_tokens);
    bucket.cacheWrite += num(u.cache_creation_input_tokens);
    bucket.turns += 1;

    outputCum += output;
    const ts = str(line.timestamp);
    if (ts) series.push({ ts, outputCum });
  }

  return { byModel, series };
}

/** Sum of output tokens across a rollup's models (swimlane bar thickness). */
export function totalOutputTokens(usage: UsageRollup): number {
  let total = 0;
  for (const m of Object.values(usage.byModel)) total += m.output;
  return total;
}

/** Merge per-agent rollups into a whole-session rollup. Series points are
 *  re-accumulated across agents in timestamp order. */
export function mergeUsage(rollups: UsageRollup[]): UsageRollup {
  const byModel: Record<string, ModelUsage> = {};
  const deltas: { ms: number; ts: string; delta: number }[] = [];

  for (const r of rollups) {
    for (const [model, m] of Object.entries(r.byModel)) {
      const bucket = (byModel[model] ??= {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        turns: 0,
      });
      bucket.input += m.input;
      bucket.output += m.output;
      bucket.cacheRead += m.cacheRead;
      bucket.cacheWrite += m.cacheWrite;
      bucket.turns += m.turns;
    }
    let prev = 0;
    for (const p of r.series) {
      const ms = Date.parse(p.ts);
      if (!Number.isFinite(ms)) continue;
      deltas.push({ ms, ts: p.ts, delta: p.outputCum - prev });
      prev = p.outputCum;
    }
  }

  deltas.sort((a, b) => a.ms - b.ms);
  const series: UsagePoint[] = [];
  let cum = 0;
  for (const d of deltas) {
    cum += d.delta;
    series.push({ ts: d.ts, outputCum: cum });
  }
  return { byModel, series };
}

// ── collectFileTouches ────────────────────────────────────────────────────────

/** Forward-slash path identity (Windows transcripts mix separators). */
function normPath(p: string): string {
  return p.replace(/\\/g, "/").trim();
}

/** Strip one layer of shell quoting; null when the token can't be a path. */
function pathToken(tok: string): string | null {
  const t = tok.replace(/^["']|["']$/g, "").trim();
  if (!t || t.startsWith("-") || t.startsWith("$") || t.startsWith("&")) {
    return null;
  }
  if (t === "/dev/null" || t.toUpperCase() === "NUL") return null;
  // Must look path-ish: a separator or a dotted extension.
  if (!/[\\/]/.test(t) && !/\.\w+$/.test(t)) return null;
  return t;
}

const BASH_FILE_CMDS = new Set(["rm", "mv", "cp", "touch"]);

/**
 * Heuristic file targets of a Bash command: output redirects (`>`/`>>`),
 * `tee`, and rm/mv/cp/touch (incl. `git mv`/`git rm`) arguments. Deliberately
 * conservative — callers flag these touches as "maybe".
 */
export function bashTouchCandidates(command: string): string[] {
  const out = new Set<string>();

  // Output redirects: `> f`, `>> f`, `2> f` — fd-dups (`2>&1`) rejected by pathToken.
  for (const m of command.matchAll(
    /(?:^|[\s;|&])\d?>{1,2}\s*("[^"]+"|'[^']+'|[^\s;|&<>]+)/g,
  )) {
    const t = pathToken(m[1]);
    if (t) out.add(t);
  }
  // tee [-a] f
  for (const m of command.matchAll(
    /\btee\s+(?:-a\s+)?("[^"]+"|'[^']+'|[^\s;|&<>]+)/g,
  )) {
    const t = pathToken(m[1]);
    if (t) out.add(t);
  }
  // rm/mv/cp/touch (+ git variants): non-flag args of each pipeline segment.
  for (const segment of command.split(/[;|&]+/)) {
    const toks = segment.trim().split(/\s+/);
    let idx = 0;
    if (toks[idx] === "git") idx++;
    if (!BASH_FILE_CMDS.has(toks[idx] ?? "")) continue;
    for (const tok of toks.slice(idx + 1)) {
      const t = pathToken(tok);
      if (t) out.add(t);
    }
  }
  return [...out];
}

/**
 * Files one agent touched, most-recent last-touch first. Edit-family tools are
 * matched by input path (exact); Bash commands are matched heuristically and
 * files seen ONLY that way carry `maybe: true`.
 */
export function collectFileTouches(lines: Iterable<Line>): FileTouch[] {
  interface Entry extends FileTouch {
    sure: boolean;
  }
  const entries = new Map<string, Entry>();

  const touch = (
    rawPath: string,
    tool: FileTouchTool,
    sure: boolean,
    ts: string | null,
    toolUseId: string,
    turnUuid: string,
  ): void => {
    const path = normPath(rawPath);
    if (!path) return;
    let e = entries.get(path);
    if (!e) {
      e = {
        path,
        tools: {},
        firstTs: ts,
        lastTs: ts,
        lastToolUseId: toolUseId,
        turnUuid,
        sure: false,
      };
      entries.set(path, e);
    }
    e.tools[tool] = (e.tools[tool] ?? 0) + 1;
    if (ts) {
      if (e.firstTs === null) e.firstTs = ts;
      e.lastTs = ts;
    }
    e.lastToolUseId = toolUseId;
    e.turnUuid = turnUuid;
    if (sure) e.sure = true;
  };

  for (const line of lines) {
    if (line.type !== "assistant") continue;
    const ts = str(line.timestamp);
    const turnUuid = str(line.uuid) ?? "";
    for (const b of blocksOf(line)) {
      if (b.type !== "tool_use") continue;
      const name = str(b.name);
      const id = str(b.id) ?? "";
      const input =
        b.input !== null &&
        typeof b.input === "object" &&
        !Array.isArray(b.input)
          ? (b.input as Line)
          : {};
      if (name === "Edit" || name === "MultiEdit") {
        const p = str(input.file_path);
        if (p) touch(p, "Edit", true, ts, id, turnUuid);
      } else if (name === "Write") {
        const p = str(input.file_path);
        if (p) touch(p, "Write", true, ts, id, turnUuid);
      } else if (name === "NotebookEdit") {
        const p = str(input.notebook_path) ?? str(input.file_path);
        if (p) touch(p, "NotebookEdit", true, ts, id, turnUuid);
      } else if (name === "Read") {
        const p = str(input.file_path);
        if (p) touch(p, "Read", true, ts, id, turnUuid);
      } else if (name === "Bash") {
        const cmd = str(input.command);
        if (cmd) {
          for (const p of bashTouchCandidates(cmd)) {
            touch(p, "Bash", false, ts, id, turnUuid);
          }
        }
      }
    }
  }

  const out: FileTouch[] = [];
  for (const e of entries.values()) {
    const { sure, ...ft } = e;
    out.push(sure ? ft : { ...ft, maybe: true });
  }
  out.sort((a, b) => (b.lastTs ?? "").localeCompare(a.lastTs ?? ""));
  return out;
}

// ── collectToolEvents ─────────────────────────────────────────────────────────

/** Compact one-line tool-input summary for tooltips (mirrors the display
 *  discipline of transcript-parser's toolInputSummary, capped shorter). */
function inputSummary(input: unknown): string | undefined {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const o = input as Line;
  const lead =
    str(o.description) ??
    str(o.command) ??
    str(o.file_path) ??
    str(o.pattern) ??
    str(o.url) ??
    str(o.prompt);
  if (!lead) return undefined;
  const flat = lead.replace(/\s+/g, " ").trim();
  if (!flat) return undefined;
  return flat.length > EVENT_SUMMARY_CAP
    ? `${flat.slice(0, EVENT_SUMMARY_CAP)}…`
    : flat;
}

/**
 * Timeline-enriched tool events of one agent file, in transcript order.
 * tool_use blocks (assistant lines) anchor the event; the matching tool_result
 * (a later user line) back-fills isError and durMs.
 */
export function collectTimelineEvents(lines: Iterable<Line>): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  const byId = new Map<string, { ev: TimelineEvent; useMs: number }>();

  for (const line of lines) {
    const ts = str(line.timestamp);
    if (line.type === "assistant") {
      if (!ts) continue; // un-timestamped events can't be placed — skip
      const turnUuid = str(line.uuid) ?? "";
      for (const b of blocksOf(line)) {
        if (b.type !== "tool_use") continue;
        const id = str(b.id);
        if (!id) continue;
        const ev: TimelineEvent = {
          ts,
          toolUseId: id,
          name: str(b.name) ?? "tool",
          isError: false,
          turnUuid,
        };
        const summary = inputSummary(b.input);
        if (summary) ev.summary = summary;
        events.push(ev);
        const useMs = Date.parse(ts);
        if (Number.isFinite(useMs)) byId.set(id, { ev, useMs });
      }
    } else if (line.type === "user") {
      for (const b of blocksOf(line)) {
        if (b.type !== "tool_result") continue;
        const id = str(b.tool_use_id);
        const rec = id ? byId.get(id) : undefined;
        if (!rec) continue;
        if (b.is_error === true) rec.ev.isError = true;
        const rMs = ts ? Date.parse(ts) : NaN;
        if (Number.isFinite(rMs) && rMs >= rec.useMs) {
          rec.ev.durMs = rMs - rec.useMs;
        }
      }
    }
  }
  return events;
}

/** S1 shape exactly as specced: `{ ts, toolUseId, name, isError, turnUuid, durMs? }`. */
export function collectToolEvents(lines: Iterable<Line>): ToolEvent[] {
  return collectTimelineEvents(lines).map((e) => {
    const out: ToolEvent = {
      ts: e.ts,
      toolUseId: e.toolUseId,
      name: e.name,
      isError: e.isError,
      turnUuid: e.turnUuid,
    };
    if (e.durMs !== undefined) out.durMs = e.durMs;
    return out;
  });
}

// ── Server-side event binning (payload cap) ──────────────────────────────────

/**
 * Cap an event list at `cap` entries by collapsing contiguous runs (events are
 * already chronological). A bin's representative keeps the FIRST event's
 * ts/toolUseId/turnUuid (an honest "jump to the start of this burst" anchor),
 * takes the run's most common tool name, sets `bin`/`binErrors`, and drops the
 * per-event summary/durMs.
 */
export function binEvents(
  events: TimelineEvent[],
  cap: number = EVENT_BIN_CAP,
): TimelineEvent[] {
  if (events.length <= cap) return events;
  const chunk = Math.ceil(events.length / cap);
  const out: TimelineEvent[] = [];
  for (let i = 0; i < events.length; i += chunk) {
    const run = events.slice(i, i + chunk);
    const first = run[0];
    const names = new Map<string, number>();
    let errors = 0;
    for (const e of run) {
      names.set(e.name, (names.get(e.name) ?? 0) + (e.bin ?? 1));
      errors += e.binErrors ?? (e.isError ? 1 : 0);
    }
    let topName = first.name;
    let topCount = 0;
    for (const [name, n] of names) {
      if (n > topCount) {
        topName = name;
        topCount = n;
      }
    }
    out.push({
      ts: first.ts,
      toolUseId: first.toolUseId,
      name: topName,
      isError: errors > 0,
      turnUuid: first.turnUuid,
      bin: run.reduce((n, e) => n + (e.bin ?? 1), 0),
      binErrors: errors,
    });
  }
  return out;
}

// ── Session-level readers (routes consume these) ─────────────────────────────

/** Lines of one agent file; root excludes isSidechain lines (old-format
 *  interleaving), matching every other root read in this console. */
function readAgentLines(
  sessionsDir: string,
  sessionId: string,
  agentId: string,
): Line[] {
  if (agentId === "root") {
    const lines = readJsonlLines(join(sessionsDir, `${sessionId}.jsonl`));
    return lines.filter((l) => l.isSidechain !== true);
  }
  return readJsonlLines(
    join(sessionsDir, sessionId, "subagents", `agent-${agentId}.jsonl`),
  );
}

/**
 * Whole-session insights: merged usage + per-agent usage/files.
 * Null for an unknown session (readSessionTree validates the id charset, so
 * no client-supplied path reaches the filesystem unchecked; agent ids come
 * from the tree's own disk listing).
 */
export function readSessionInsights(
  projectRoot: string,
  sessionId: string,
  opts?: TranscriptOpts,
): SessionInsights | null {
  const tree = readSessionTree(projectRoot, sessionId, opts);
  if (!tree) return null;
  const sessionsDir = resolveProjectSessionsDir(projectRoot, opts);
  if (!sessionsDir) return null;

  const agents: Record<string, AgentInsights> = {};
  const rollups: UsageRollup[] = [];
  for (const node of [tree.root, ...tree.agents]) {
    const lines = readAgentLines(sessionsDir, sessionId, node.id);
    const usage = collectUsage(lines);
    agents[node.id] = { usage, files: collectFileTouches(lines) };
    rollups.push(usage);
  }
  return { sessionId, usage: mergeUsage(rollups), agents };
}

/** Idle stretches ≥ IDLE_GAP_MS across a set of sorted line timestamps (ms). */
function findGaps(sortedMs: number[]): TimeGap[] {
  const gaps: TimeGap[] = [];
  for (let i = 1; i < sortedMs.length; i++) {
    const from = sortedMs[i - 1];
    const to = sortedMs[i];
    if (to - from >= IDLE_GAP_MS) {
      gaps.push({
        fromTs: new Date(from).toISOString(),
        toTs: new Date(to).toISOString(),
      });
    }
  }
  return gaps;
}

/**
 * Swimlane data for one session (#8): root lane first, then subagents in
 * spawn (file-name) order, each with binned tool events; plus session-wide
 * idle gaps for x-axis snipping. Null for an unknown session.
 */
export function readSessionTimeline(
  projectRoot: string,
  sessionId: string,
  opts?: TranscriptOpts,
): SwimlaneData | null {
  const tree = readSessionTree(projectRoot, sessionId, opts);
  if (!tree) return null;
  const sessionsDir = resolveProjectSessionsDir(projectRoot, opts);
  if (!sessionsDir) return null;

  const nodes: AgentNode[] = [tree.root, ...tree.agents];
  const linesOf = new Map<string, Line[]>();
  for (const node of nodes) {
    linesOf.set(node.id, readAgentLines(sessionsDir, sessionId, node.id));
  }

  // Spawn linkage: Task/Agent tool_use id → the spawning turn's uuid, scanned
  // across every transcript (a nested agent's spawner is another agent).
  const spawnTurnOf = new Map<string, string>();
  for (const lines of linesOf.values()) {
    for (const line of lines) {
      if (line.type !== "assistant") continue;
      const turnUuid = str(line.uuid);
      if (!turnUuid) continue;
      for (const b of blocksOf(line)) {
        if (b.type !== "tool_use") continue;
        const name = str(b.name);
        if (name !== "Task" && name !== "Agent") continue;
        const id = str(b.id);
        if (id && !spawnTurnOf.has(id)) spawnTurnOf.set(id, turnUuid);
      }
    }
  }

  const agents: SwimlaneAgent[] = [];
  const activityMs: number[] = [];
  for (const node of nodes) {
    const lines = linesOf.get(node.id) ?? [];
    for (const line of lines) {
      const ms = Date.parse(str(line.timestamp) ?? "");
      if (Number.isFinite(ms)) activityMs.push(ms);
    }
    agents.push({
      id: node.id,
      agentType: node.agentType,
      parentId: node.parentId,
      spawnTurnUuid:
        (node.toolUseId && spawnTurnOf.get(node.toolUseId)) || null,
      startedAt: node.startedAt,
      endedAt: node.status === "running" ? null : node.lastActivity,
      outputTokens: totalOutputTokens(collectUsage(lines)),
      events: binEvents(collectTimelineEvents(lines)),
    });
  }

  activityMs.sort((a, b) => a - b);
  return { sessionId, agents, gaps: findGaps(activityMs) };
}
