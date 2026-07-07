/**
 * types.ts — Shared TypeScript types matching contract:console-http-api.
 *
 * These are the response shapes all route handlers return.
 * TASK-003 and TASK-004 will fill the stubs with real data.
 */

export type Lane = "feature" | "bug";

export interface TaskItem {
  id: string;
  title: string;
  status: string;
  lane: Lane;
  /** Archived tasks are hidden by default in list/board views (filter toggle). */
  archived: boolean;
}

export interface TaskBoardColumn {
  status: string;
  lane: Lane;
  items: TaskItem[];
}

export interface TaskBoard {
  columns: TaskBoardColumn[];
}

export interface ContractSummary {
  id: string;
  status: "draft" | "stable";
  title: string;
}

export interface DecisionEntry {
  id: string;
  date: string;
  status: string;
  title: string;
  body: string;
}

export interface SpecRef {
  name: string;
}

export interface SpecDoc {
  name: string;
  markdown: string;
}

export interface ReadmeDoc {
  exists: boolean;
  markdown: string;
}

/**
 * A whitelisted `.claude/` markdown state file rendered as a doc (TASK-027).
 * `key` is one of a fixed set (status / review-findings / test-findings) — the
 * whitelist is what keeps `/api/statedoc/:key` free of path traversal.
 */
export interface StateDoc {
  key: string;
  exists: boolean;
  markdown: string;
  /** File mtime (ms epoch) for the DocPage "Last updated" meta row (TASK-106 §5.1). Absent when the file is. */
  mtimeMs?: number;
}

export interface VerifyRef {
  task: string;
  title: string;
  counts: Record<string, number>;
  /**
   * Present (true) only for a verify file that failed schema validation or
   * could not be read/parsed — the queue still lists it (by filename) instead
   * of silently dropping it (M5-minor). `invalidReason` carries the first
   * validation/read error for a human to act on.
   */
  invalid?: boolean;
  invalidReason?: string;
}

/** A node in the Docs browser tree (TASK-028). Paths are relative to docs/. */
export interface DocsNode {
  name: string;
  path: string; // forward-slash, relative to docs root; "" for the root dir
  type: "dir" | "file";
  ext?: string; // files only — lowercase, no dot
  children?: DocsNode[]; // dirs only
}

export interface DocsTree {
  exists: boolean;
  root: DocsNode | null;
}

export interface VerdictPatch {
  id: string;
  verdict: string;
  severity?: string | null;
  /** Updates the CURRENT retest round's note. */
  notes?: string;
  /**
   * Link/unlink a flagged bug. Set to a BUG-XXX when the author flags this use
   * case; the reset reconcile clears it (to null) once the bug is fixed. Omit to
   * leave unchanged.
   */
  bugId?: string | null;
}

export interface DashboardSummary {
  handbackQueue: VerifyRef[];
  taskCounts: { lane: Lane; status: string; n: number }[];
  contractCounts: { status: "draft" | "stable"; n: number }[];
  latestDecisions: DecisionEntry[];
  currentSpec: string | null;
  sprintGoal: string | null;
}

export interface HealthResponse {
  app: string;
  version: string;
  projectRoot: string;
  // TASK-037 / DEC-025 — fields the tray Hub reads to identity-check + label a
  // live console (added; existing consumers ignore them).
  project: string;
  port: number;
  pid: number;
}

// ── TASK-025: Analytics types ─────────────────────────────────────────────────

export interface GotchaEntry {
  title: string;
  category: string;
  confidence: string;
  count: number;
  firstSeen: string;
  /** The problem→fix prose under the entry (markdown). Optional — TASK-027. */
  body?: string;
}

export interface SuggestionEntry {
  id: string;
  title: string;
}

export interface FindingsSummary {
  review: {
    latestVerdict: string | null;
    openCriticals: number;
  };
  test: {
    lastRun: string | null;
    pass: number | null;
    fail: number | null;
  };
}

export interface FrameworkHealth {
  version: string | null;
  updateAvailable: boolean;
  healthcheckLastRun: string | null;
  doctorClean: boolean;
}

export interface LastSessionInfo {
  toolUses: number | null;
  transcriptLines: number | null;
  sessionId: string | null;
}

// ── Sessions agent-visualisation types (read-only transcript viewer) ──────────

/** One Claude Code session of the current project (a <uuid>.jsonl transcript). */
export interface SessionSummary {
  id: string;
  /** ISO timestamp of the first transcript line carrying one; null if none. */
  startedAt: string | null;
  /** ISO timestamp derived from the newest mtime across the main transcript
   *  and its subagent files. */
  lastActivity: string | null;
  /** user + assistant lines in the main transcript. */
  messageCount: number;
  /** Number of subagent transcripts under <id>/subagents/. */
  agentCount: number;
  gitBranch: string | null;
  /** Snippet of the first real user prompt (command/caveat XML skipped). */
  firstPrompt: string | null;
  /** Display label: a manual editor rename (`custom-title` line) when one
   *  exists, else Claude Code's own label (`ai-title`/`summary` line). */
  title: string | null;
  /** Which ladder rung the display label rides (§4.3): "rename" = manual
   *  editor rename; "summary" = ai-title/summary line; "prompt" = firstPrompt
   *  fallback; "id" = last resort. Optional for wire back-compat. */
  titleSource?: SessionTitleSource;
}

/** Source of a SessionSummary's display label — see the title-source ladder
 *  in transcript-parser.listSessions (§4.3 rename-aware titles). */
export type SessionTitleSource = "rename" | "summary" | "prompt" | "id";

export type AgentStatus = "running" | "done";

/** A node in a session's agent tree — the root session or one subagent. */
export interface AgentNode {
  /** "root" for the main session, else the subagent id (meta/agentId). */
  id: string;
  /** null for root; "root" or another agent id for nested spawns. */
  parentId: string | null;
  /** meta.agentType (e.g. developer / reviewer); "session" for the root. */
  agentType: string;
  /** meta.description — the Task/Agent tool call's description. */
  description: string | null;
  /** The Task/Agent tool_use id that spawned this agent; null for root. */
  toolUseId: string | null;
  /** meta.spawnDepth (0 for root; defaults to 1 when the sidecar omits it). */
  spawnDepth: number;
  status: AgentStatus;
  startedAt: string | null;
  lastActivity: string | null;
  messageCount: number;
  /** Last assistant `message.model` seen in this agent's transcript. */
  model: string | null;
}

export interface SessionTree {
  sessionId: string;
  root: AgentNode;
  /** Subagent nodes (root excluded), in spawn (file-name) order. */
  agents: AgentNode[];
}

/** One display block within a conversation turn. */
export type TurnBlock =
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "thinking"; text: string; truncated: boolean }
  | { kind: "tool_use"; toolUseId: string; name: string; summary: string }
  | {
      kind: "tool_result";
      toolUseId: string;
      text: string;
      isError: boolean;
      truncated: boolean;
    };

/** One transcript line of type user/assistant, display-ready. */
export interface ConversationTurn {
  uuid: string;
  role: "user" | "assistant";
  timestamp: string | null;
  /** Assistant turns only — message.model. */
  model: string | null;
  blocks: TurnBlock[];
}

export interface AgentConversation {
  sessionId: string;
  /** "root" for the main transcript, else the subagent id. */
  agentId: string;
  agentType: string;
  description: string | null;
  /** Last assistant `message.model` in the FULL conversation (not just the window). */
  model: string | null;
  /**
   * A WINDOW of the agent's conversation, in chronological order. Default (no
   * `before`) is the TAIL of `limit` turns; `before=<uuid>` returns the `limit`
   * turns immediately BEFORE that turn. `all` returns every turn.
   */
  turns: ConversationTurn[];
  /** Full turn count for the agent (not just the returned window). */
  total: number;
  /** True when older turns exist before the returned window. */
  hasMore: boolean;
  /** uuid of the first returned turn — the cursor for the next "load earlier". */
  oldestUuid: string | null;
}

/**
 * Full, UNTRUNCATED tool_result for one tool call (the conversation view
 * truncates results; the tool rail's "open full" fetches this). `truncated` is
 * always false — this is the complete text.
 */
export interface ToolResultDetail {
  toolUseId: string;
  name: string;
  /** The raw tool_use input object (untruncated); null if the call wasn't found. */
  input: unknown;
  result: { text: string; isError: boolean; truncated: false };
}

/** One in-session search hit (case-insensitive substring across all agents). */
export interface SearchMatch {
  /** "root" or the subagent id owning the matched turn. */
  agentId: string;
  /** Display label for the owning agent ("session" for root, else agentType). */
  agentLabel: string;
  turnUuid: string;
  role: "user" | "assistant";
  blockType: "text" | "thinking" | "tool_use" | "tool_result";
  /** ~120 chars of context around the first hit in the block. */
  snippet: string;
}

export interface SessionSearchResult {
  q: string;
  matches: SearchMatch[];
  /** True when the match cap was reached and results were truncated. */
  capped: boolean;
}

export interface HookMetrics {
  generated_at: string | null;
  total_events: number;
  by_hook: Record<string, { total: number; outcomes: Record<string, number> }>;
  drift_triggers: Record<string, number>;
  sessions: number;
  by_session: Record<
    string,
    {
      total: number;
      blocked: number;
      flagged: number;
      drift_fires: number;
      stop_blocked?: number;
    }
  >;
}

export interface TelemetrySummary extends HookMetrics {
  lastSession: LastSessionInfo | null;
}

// ── TASK-109: Needs-you attention aggregator (CONSOLE-V2-DESIGN.md S3) ────────

/** Source kind of an AttentionItem (S3). */
export type AttentionKind =
  "verify" | "decision" | "doctor" | "bug" | "update" | "review";

/**
 * One ranked "needs a human" item — GET /api/attention (S3; feature #9 inbox,
 * #6 ticker zone B, Hub toasts per plan §4c).
 */
export interface AttentionItem {
  kind: AttentionKind;
  /**
   * Computed: P0 bug=0, doctor CRITICAL=1, verify=2, P1 bug=3,
   * flagged decision=4, review criticals=5, update=6 (+age tiebreak —
   * within a rank, older `since` first).
   */
  rank: number;
  title: string;
  detail: string;
  /** In-project SPA route (contract:console-deep-links grammar). */
  link: string;
  /** e.g. pending items in a verify seed / open review criticals. */
  count?: number;
  /** ISO — drives "waiting 2d" chips. Null when the source has no timestamp. */
  since: string | null;
}
