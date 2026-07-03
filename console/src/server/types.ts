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

// ── TASK-029: Headroom (context-compression) metrics ──────────────────────────
// Parsed from .claude/telemetry/headroom-metrics.jsonl (stable schema
// headroom-metrics/1 produced by the framework's normalizer). DEC-018: every
// numeric is a real Headroom value or null — never invented.
export interface HeadroomRecord {
  eventId: string | null;
  ts: string | null;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokensSaved: number | null;
  compressionRatio: number | null;
  costUsd: number | null;
  latencyMs: number | null;
}

export interface HeadroomSummary {
  available: boolean; // file present with ≥1 valid record
  recordCount: number;
  tokensIn: number; // sum of real values
  tokensOut: number; // sum of real values
  tokensSaved: number; // sum of real values
  avgCompressionRatio: number | null; // mean of non-null ratios
  costUsd: number | null; // sum of non-null costs (null if none reported)
  lastRun: string | null; // latest normalized_at / ts
  recent: HeadroomRecord[]; // most-recent-first, bounded
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

export interface HookMetrics {
  generated_at: string | null;
  total_events: number;
  by_hook: Record<string, { total: number; outcomes: Record<string, number> }>;
  drift_triggers: Record<string, number>;
  sessions: number;
  by_session: Record<
    string,
    { total: number; blocked: number; flagged: number; drift_fires: number; stop_blocked?: number }
  >;
}

export interface TelemetrySummary extends HookMetrics {
  lastSession: LastSessionInfo | null;
}
