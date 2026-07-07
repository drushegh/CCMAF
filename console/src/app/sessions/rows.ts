/**
 * rows.ts — pure derivation of the Sessions conversation ROW MODEL.
 *
 * Input: a window of ConversationTurns (transcript order). Output: the
 * narrative row list the center pane renders, plus the chronological tool
 * LEDGER the right rail renders, plus the lookup maps that make the two-way
 * chip⇄rail sync O(1).
 *
 * The compression rules (what turns a 197-turn agent into ~35 readable rows):
 *  - Consecutive tool_use/tool_result activity collapses into ONE toolGroup
 *    row ("⚙ 14 tool calls · Read×6 Edit×4 · ⚠1 error"). tool_result-only
 *    user turns are absorbed into the group (they are plumbing, not prose).
 *  - Thinking inside a tool-using (or group-continuing) assistant turn folds
 *    INTO the open group; thinking alongside assistant TEXT stays a visible
 *    collapsed row (that's the "final reflection" people actually read).
 *  - Injected noise prompts (`<system-reminder>`, `<task-notification>`,
 *    "Caveat:" …) render as dim one-line notices and do NOT break a group —
 *    only real prose (a typed prompt / assistant text) closes it.
 *
 * Pure functions only — unit-tested in tests/sessions-rows.test.ts.
 */

import type { ConversationTurn, TurnBlock } from "../api/sessions";

/* ── Ledger ─────────────────────────────────────────────────────────── */

export interface LedgerResult {
  text: string;
  isError: boolean;
  truncated: boolean;
}

/** One tool call in the chronological rail ledger. */
export interface LedgerEntry {
  toolUseId: string;
  name: string;
  summary: string;
  /** uuid of the assistant turn that issued the call (conversation anchor). */
  turnUuid: string;
  timestamp: string | null;
  /** Row key of the owning toolGroup row (chip⇄rail sync). */
  groupKey: string;
  /** Position in the ledger (chronological, 0-based). */
  index: number;
  /** null while the call is still in flight (no tool_result seen yet). */
  result: LedgerResult | null;
}

/* ── Rows ───────────────────────────────────────────────────────────── */

export interface ThinkingFold {
  /** Row-model key of the thinking snippet inside a group. */
  key: string;
  text: string;
  truncated: boolean;
  /** Ledger index the snippet precedes (ordering inside the expanded group). */
  beforeLedgerIndex: number;
}

export type ConvoRow =
  | { kind: "loadEarlier"; key: "load-earlier" }
  | {
      kind: "prompt";
      key: string;
      uuid: string;
      timestamp: string | null;
      text: string;
      truncated: boolean;
      /** Injected XML / caveat chatter — rendered dim + single-line. */
      noise: boolean;
      /** Long prompts clamp to ~6 lines with an expander. */
      long: boolean;
    }
  | {
      kind: "assistant";
      key: string;
      uuid: string;
      timestamp: string | null;
      model: string | null;
      text: string;
      truncated: boolean;
    }
  | {
      kind: "thinking";
      key: string;
      uuid: string;
      text: string;
      truncated: boolean;
    }
  | {
      kind: "toolGroup";
      key: string;
      /** First (anchor) turn uuid — deep-link target for the group. */
      firstTurnUuid: string;
      timestamp: string | null;
      /** Ledger index range [start, end) owned by this group. */
      ledgerStart: number;
      ledgerEnd: number;
      /** name → count, insertion-ordered by first appearance. */
      counts: [string, number][];
      errorCount: number;
      thinking: ThinkingFold[];
    };

export interface RowModel {
  rows: ConvoRow[];
  ledger: LedgerEntry[];
  /** turn uuid → key of the row that renders it (groups: the chip row). */
  rowKeyByTurnUuid: Map<string, string>;
  /** toolUseId → owning group row key. */
  rowKeyByToolUseId: Map<string, string>;
  /** toolUseId → ledger index. */
  ledgerIndexByToolUseId: Map<string, number>;
  /** Tool-name → call count across the window (rail filter pills). */
  toolCounts: [string, number][];
  errorCount: number;
}

/** Threshold beyond which a prompt row clamps to ~6 lines with an expander. */
const LONG_PROMPT_CHARS = 600;
const LONG_PROMPT_LINES = 7;

/** True for injected command/notification XML or caveat lines — not typed prose. */
export function isNoisePrompt(text: string): boolean {
  const t = text.trimStart();
  return t.startsWith("<") || t.startsWith("Caveat:");
}

/** Human labels for the known injected wrappers (fallback: humanised tag). */
const NOISE_LABELS: Record<string, string> = {
  "system-reminder": "system reminder",
  "task-notification": "task notification",
  ide_opened_file: "IDE opened a file",
  ide_selection: "IDE selection",
  ide_diagnostics: "IDE diagnostics",
  "command-name": "slash command",
  "command-message": "slash command",
  "command-args": "slash command args",
  "local-command-stdout": "command output",
  "local-command-stderr": "command output",
};

export interface NoiseInfo {
  /** Short human label for the chip ("system reminder", "slash command"…). */
  label: string;
  /** One-line, tag-stripped content preview ("" when the wrapper is empty). */
  snippet: string;
}

/**
 * Describe an injected noise prompt for chip rendering: identify the wrapper
 * (`<system-reminder>`, `<task-notification>`, "Caveat:"…) and produce a
 * tag-free one-line snippet, so the prose pane never shows raw markup.
 */
export function describeNoisePrompt(text: string): NoiseInfo {
  const t = text.trimStart();
  let label: string;
  if (t.startsWith("Caveat:")) {
    label = "caveat";
  } else {
    const m = /^<([a-zA-Z][\w-]*)/.exec(t);
    label = m
      ? (NOISE_LABELS[m[1]] ?? m[1].replace(/[-_]+/g, " ").toLowerCase())
      : "injected";
  }
  const snippet = t
    .replace(/^Caveat:/, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return { label, snippet };
}

/* ── Tool-summary humanisation ──────────────────────────────────────── */

const countMatches = (s: string, re: RegExp): number => {
  let n = 0;
  re.lastIndex = 0;
  while (re.exec(s) !== null) n++;
  return n;
};

const unescapeJson = (s: string): string =>
  s.replace(/\\n/g, " ").replace(/\\(["\\/])/g, "$1");

/**
 * Turn raw-JSON tool summaries into human ones. The server one-lines a
 * structured input as `JSON.stringify(input)` capped at ~300 chars, so
 * TodoWrite/AskUserQuestion arrive as `{"todos":[{"content":…` — unreadable
 * and often TRUNCATED (JSON.parse fails). Exact counts when the JSON parses;
 * lenient regex counts (marked `+`) when it doesn't. Every other tool's
 * summary passes through untouched.
 */
export function humanToolSummary(name: string, summary: string): string {
  if (name === "TodoWrite") {
    let total = 0;
    let done = 0;
    let active = 0;
    let approx = false;
    try {
      const o = JSON.parse(summary) as { todos?: { status?: string }[] };
      if (!o || !Array.isArray(o.todos)) return summary;
      total = o.todos.length;
      for (const t of o.todos) {
        if (t?.status === "completed") done++;
        else if (t?.status === "in_progress") active++;
      }
    } catch {
      total = countMatches(summary, /"content"\s*:/g);
      if (total === 0) return summary;
      done = countMatches(summary, /"status"\s*:\s*"completed"/g);
      active = countMatches(summary, /"status"\s*:\s*"in_progress"/g);
      approx = summary.endsWith("…");
    }
    const parts = [
      `${total}${approx ? "+" : ""} todo${total === 1 && !approx ? "" : "s"}`,
    ];
    if (done > 0) parts.push(`${done} done`);
    if (active > 0) parts.push(`${active} in progress`);
    return parts.join(" · ");
  }
  if (name === "AskUserQuestion") {
    const m = /"question"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(summary);
    if (m && m[1]) return `asked: ${unescapeJson(m[1])}`;
    return summary;
  }
  return summary;
}

function isLongPrompt(text: string): boolean {
  if (text.length > LONG_PROMPT_CHARS) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 && ++lines >= LONG_PROMPT_LINES) return true;
  }
  return false;
}

/**
 * Build the row model for one loaded window.
 * `hasEarlier` prepends the "↑ load earlier" row.
 */
export function buildRowModel(
  turns: ConversationTurn[],
  opts?: { hasEarlier?: boolean },
): RowModel {
  const rows: ConvoRow[] = [];
  const ledger: LedgerEntry[] = [];
  const rowKeyByTurnUuid = new Map<string, string>();
  const rowKeyByToolUseId = new Map<string, string>();
  const ledgerIndexByToolUseId = new Map<string, number>();
  const countsByName = new Map<string, number>();
  let errorCount = 0;

  if (opts?.hasEarlier) rows.push({ kind: "loadEarlier", key: "load-earlier" });

  // Pass 1 — collect every tool_result by toolUseId (results arrive in LATER
  // user turns than their tool_use; a window-boundary orphan is simply absent).
  const resultById = new Map<string, LedgerResult>();
  for (const turn of turns) {
    for (const b of turn.blocks) {
      if (b.kind === "tool_result") {
        resultById.set(b.toolUseId, {
          text: b.text,
          isError: b.isError,
          truncated: b.truncated,
        });
      }
    }
  }

  // Pass 2 — walk turns, building rows + ledger.
  // The currently-open tool group row lives in a holder object so closure
  // assignments don't defeat TS flow narrowing.
  type ToolGroupRow = Extract<ConvoRow, { kind: "toolGroup" }>;
  const cur: { open: ToolGroupRow | null } = { open: null };

  const closeGroup = (): void => {
    cur.open = null;
  };

  const ensureGroup = (turn: ConversationTurn): ToolGroupRow => {
    if (!cur.open) {
      // Keyed by the anchor turn's uuid ONLY (unique per group — a turn can
      // open at most one group). A sequence prefix would renumber every
      // group on "load earlier", snapping expanded groups shut and
      // orphaning the j/k cursor.
      const key = `g:${turn.uuid}`;
      cur.open = {
        kind: "toolGroup",
        key,
        firstTurnUuid: turn.uuid,
        timestamp: turn.timestamp,
        ledgerStart: ledger.length,
        ledgerEnd: ledger.length,
        counts: [],
        errorCount: 0,
        thinking: [],
      };
      rows.push(cur.open);
    }
    return cur.open;
  };

  const noteTurnRow = (uuid: string, key: string): void => {
    if (uuid && !rowKeyByTurnUuid.has(uuid)) rowKeyByTurnUuid.set(uuid, key);
  };

  for (const turn of turns) {
    if (turn.role === "user") {
      // tool_result blocks were consumed in pass 1; only text is narrative.
      for (let i = 0; i < turn.blocks.length; i++) {
        const b = turn.blocks[i];
        if (b.kind !== "text" || !b.text.trim()) continue;
        const noise = isNoisePrompt(b.text);
        if (!noise) closeGroup(); // a real typed prompt breaks the run
        const key = `${turn.uuid}:u${i}`;
        rows.push({
          kind: "prompt",
          key,
          uuid: turn.uuid,
          timestamp: turn.timestamp,
          text: b.text,
          truncated: b.truncated,
          noise,
          long: !noise && isLongPrompt(b.text),
        });
        noteTurnRow(turn.uuid, key);
      }
      // A user turn that was ONLY tool_results maps to the open group row.
      if (cur.open && !rowKeyByTurnUuid.has(turn.uuid)) {
        noteTurnRow(turn.uuid, cur.open.key);
      }
      continue;
    }

    // Assistant turn — classify its blocks first.
    const textBlocks: { i: number; b: Extract<TurnBlock, { kind: "text" }> }[] =
      [];
    const thinkingBlocks: {
      i: number;
      b: Extract<TurnBlock, { kind: "thinking" }>;
    }[] = [];
    const toolBlocks: {
      i: number;
      b: Extract<TurnBlock, { kind: "tool_use" }>;
    }[] = [];
    for (let i = 0; i < turn.blocks.length; i++) {
      const b = turn.blocks[i];
      if (b.kind === "text" && b.text.trim()) textBlocks.push({ i, b });
      else if (b.kind === "thinking") thinkingBlocks.push({ i, b });
      else if (b.kind === "tool_use") toolBlocks.push({ i, b });
    }
    const hasText = textBlocks.length > 0;

    if (hasText) {
      // Prose turn: close the run; thinking surfaces as its own collapsed row.
      closeGroup();
      for (const { i, b } of thinkingBlocks) {
        const key = `${turn.uuid}:th${i}`;
        rows.push({
          kind: "thinking",
          key,
          uuid: turn.uuid,
          text: b.text,
          truncated: b.truncated,
        });
        noteTurnRow(turn.uuid, key);
      }
      for (const { i, b } of textBlocks) {
        const key = `${turn.uuid}:t${i}`;
        rows.push({
          kind: "assistant",
          key,
          uuid: turn.uuid,
          timestamp: turn.timestamp,
          model: turn.model,
          text: b.text,
          truncated: b.truncated,
        });
        noteTurnRow(turn.uuid, key);
      }
    } else if (
      thinkingBlocks.length > 0 &&
      toolBlocks.length === 0 &&
      !cur.open
    ) {
      // Thinking-only turn with no run in progress — a visible collapsed row.
      for (const { i, b } of thinkingBlocks) {
        const key = `${turn.uuid}:th${i}`;
        rows.push({
          kind: "thinking",
          key,
          uuid: turn.uuid,
          text: b.text,
          truncated: b.truncated,
        });
        noteTurnRow(turn.uuid, key);
      }
    } else if (thinkingBlocks.length > 0) {
      // Thinking inside/continuing a tool run — fold into the group.
      const g = ensureGroup(turn);
      for (const { i, b } of thinkingBlocks) {
        g.thinking.push({
          key: `${turn.uuid}:th${i}`,
          text: b.text,
          truncated: b.truncated,
          beforeLedgerIndex: ledger.length,
        });
      }
      noteTurnRow(turn.uuid, g.key);
    }

    if (toolBlocks.length > 0) {
      const g = ensureGroup(turn);
      for (const { b } of toolBlocks) {
        const result = resultById.get(b.toolUseId) ?? null;
        const entry: LedgerEntry = {
          toolUseId: b.toolUseId,
          name: b.name,
          summary: humanToolSummary(b.name, b.summary),
          turnUuid: turn.uuid,
          timestamp: turn.timestamp,
          groupKey: g.key,
          index: ledger.length,
          result,
        };
        ledger.push(entry);
        g.ledgerEnd = ledger.length;
        rowKeyByToolUseId.set(b.toolUseId, g.key);
        ledgerIndexByToolUseId.set(b.toolUseId, entry.index);
        countsByName.set(b.name, (countsByName.get(b.name) ?? 0) + 1);
        if (result?.isError) {
          g.errorCount++;
          errorCount++;
        }
      }
      noteTurnRow(turn.uuid, g.key);
    }
  }

  // Per-group name counts (insertion-ordered by first appearance in group).
  for (const row of rows) {
    if (row.kind !== "toolGroup") continue;
    const c = new Map<string, number>();
    for (let i = row.ledgerStart; i < row.ledgerEnd; i++) {
      const e = ledger[i];
      c.set(e.name, (c.get(e.name) ?? 0) + 1);
    }
    row.counts = [...c.entries()];
  }

  const toolCounts = [...countsByName.entries()].sort((a, b) => b[1] - a[1]);
  return {
    rows,
    ledger,
    rowKeyByTurnUuid,
    rowKeyByToolUseId,
    ledgerIndexByToolUseId,
    toolCounts,
    errorCount,
  };
}

/* ── Chip label helper ──────────────────────────────────────────────── */

/** "14 tool calls · Read×6 Edit×4 Bash×3 +1 more" segments for a group chip. */
export function groupChipSegments(
  row: Extract<ConvoRow, { kind: "toolGroup" }>,
): {
  total: number;
  top: [string, number][];
  moreNames: number;
} {
  const total = row.ledgerEnd - row.ledgerStart;
  const sorted = [...row.counts].sort((a, b) => b[1] - a[1]);
  return {
    total,
    top: sorted.slice(0, 3),
    moreNames: Math.max(0, sorted.length - 3),
  };
}

/* ── Rail filtering + timeline ──────────────────────────────────────── */

export type RailFilter = "all" | "errors" | { tool: string };

/** One entry's visibility under a rail filter (chip⇄rail sync decisions). */
export function matchesRailFilter(e: LedgerEntry, filter: RailFilter): boolean {
  if (filter === "all") return true;
  if (filter === "errors") return e.result?.isError === true;
  return e.name === filter.tool;
}

export function filterLedger(
  ledger: LedgerEntry[],
  filter: RailFilter,
): LedgerEntry[] {
  if (filter === "all") return ledger;
  return ledger.filter((e) => matchesRailFilter(e, filter));
}

export interface TimelineBucket {
  /** Ledger index the bucket starts at (click-to-scroll anchor). */
  start: number;
  count: number;
  errors: number;
}

/** Bucket the ledger into ≤`buckets` chronological density bars. */
export function buildTimeline(
  ledger: LedgerEntry[],
  buckets = 48,
): TimelineBucket[] {
  if (ledger.length === 0) return [];
  const n = Math.min(buckets, ledger.length);
  const per = ledger.length / n;
  const out: TimelineBucket[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * per);
    const end = Math.floor((i + 1) * per);
    let errors = 0;
    for (let j = start; j < end; j++) {
      if (ledger[j].result?.isError) errors++;
    }
    out.push({ start, count: Math.max(0, end - start), errors });
  }
  return out;
}

/* ── Local search fallback (pre-pagination backend) ─────────────────── */

export interface LocalMatch {
  turnUuid: string;
  role: "user" | "assistant";
  blockType: "text" | "thinking" | "tool_use" | "tool_result";
  snippet: string;
}

/** Case-insensitive substring search across the LOADED window only. */
export function searchLoadedTurns(
  turns: ConversationTurn[],
  q: string,
  cap = 50,
): LocalMatch[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const out: LocalMatch[] = [];
  const push = (
    turn: ConversationTurn,
    blockType: LocalMatch["blockType"],
    text: string,
  ): boolean => {
    const idx = text.toLowerCase().indexOf(needle);
    if (idx === -1) return false;
    const from = Math.max(0, idx - 40);
    const to = Math.min(text.length, idx + needle.length + 80);
    out.push({
      turnUuid: turn.uuid,
      role: turn.role,
      blockType,
      snippet:
        (from > 0 ? "…" : "") +
        text.slice(from, to).replace(/\s+/g, " ") +
        (to < text.length ? "…" : ""),
    });
    return out.length >= cap;
  };
  for (const turn of turns) {
    for (const b of turn.blocks) {
      const full = b.kind === "tool_use" ? `${b.name} ${b.summary}` : b.text;
      if (push(turn, b.kind, full)) return out;
    }
  }
  return out;
}
