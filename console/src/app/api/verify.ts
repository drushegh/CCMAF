/*
 * verify.ts — fetch helpers + shared types for the verify slice.
 *
 * Mirrors contract:console-verify-file and contract:console-http-api
 * (.claude/ECOSYSTEM.md). The Console server is the sole writer; the SPA
 * reads VerifyRef[] / VerifyFile and sends VerdictPatch[] back via PUT.
 *
 * Write requests carry the per-launch token (X-Console-Token), which the
 * server injects into index.html as <meta name="x-console-token">.
 */

// ── Domain types (contract:console-verify-file) ────────────────────────────

export type Verdict = "pending" | "pass" | "fail" | "cr" | "blocked";
export type Severity = "P0" | "P1" | "P2" | "P3";

export const VERDICTS: readonly Verdict[] = [
  "pending",
  "pass",
  "fail",
  "cr",
  "blocked",
] as const;

export const SEVERITIES: readonly Severity[] = ["P0", "P1", "P2", "P3"] as const;

/** Severity is meaningful (and required by the contract) only for these verdicts. */
export function severityApplies(verdict: Verdict): boolean {
  return verdict === "fail" || verdict === "cr";
}

/**
 * True for a "terminal-good" verdict — one that counts as complete for the
 * purposes of auto-move-to-Done and the Accept & Done gate: `pass` (matches
 * as specified) or `cr` (matches, but the owner wants a change — the change
 * itself is tracked as a separate follow-up task, not a blocker on this story).
 */
export function isComplete(verdict: Verdict): boolean {
  return verdict === "pass" || verdict === "cr";
}

/**
 * One round of notes for a use case (the iterative verify loop). When a flagged
 * bug is fixed, the use case returns as `pending` with a NEW round appended, so
 * prior rounds' notes are preserved. The current (editable) note is the last entry.
 */
export interface NoteRound {
  round: number;
  note: string;
}

export interface VerifyItem {
  id: string;
  kind: string;
  group?: string;
  title: string;
  subject?: string;
  expected?: string;
  verdict: Verdict;
  severity?: Severity | null;
  /** Current round's note (mirrors the last `noteRounds` entry). */
  notes?: string;
  /** Per-round notes (current = last). Server seeds this for every item. */
  noteRounds?: NoteRound[];
  /** Current retest round (1 = first test; +1 each bug→fix→retest cycle). */
  round?: number;
  /** The BUG-XXX raised for this use case while it's failing; null once retested. */
  bugId?: string | null;
  /**
   * The TASK-XXX follow-up spawned the first time this item's verdict was set
   * to `cr`. Set once and left in place even if the verdict later changes.
   */
  crTaskId?: string | null;
  changed?: boolean;
  provenance?: Record<string, unknown>;
}

export type VerifyStatus = "in-review" | "processing-fixes" | "done";

export interface VerifyFile {
  schemaVersion: 1;
  task: string;
  branch?: string;
  build?: string;
  status: VerifyStatus;
  items: VerifyItem[];
}

// ── Contract:console-http-api shapes ───────────────────────────────────────

/** Ready-for-Test queue entry. `counts` is by verdict. */
export interface VerifyRef {
  task: string;
  title: string;
  counts: Record<string, number>;
  /**
   * Present (true) only for a verify file that failed schema validation or
   * could not be read/parsed — it still appears in the queue (by filename)
   * instead of silently vanishing. `invalidReason` is the first error, shown
   * to the human so they know it needs attention.
   */
  invalid?: boolean;
  invalidReason?: string;
}

/** The write payload. severity/notes/bugId optional; verdict required. */
export interface VerdictPatch {
  id: string;
  verdict: Verdict;
  severity?: Severity | null;
  notes?: string;
  /** Link/clear the BUG raised for this use case. A `pass` verdict clears it. */
  bugId?: string | null;
}

// ── Token plumbing ─────────────────────────────────────────────────────────

const TOKEN_META_NAME = "x-console-token";

/**
 * Read the per-launch write token from the injected meta tag. Returns "" when
 * the tag is absent (e.g. Vite dev mode before injection, or tests) — callers
 * still send the header so the server's intent is explicit; an empty token is
 * rejected by the write guard, which is the correct fail-closed behaviour.
 */
export function getConsoleToken(): string {
  const el = document.querySelector(`meta[name="${TOKEN_META_NAME}"]`);
  return el?.getAttribute("content") ?? "";
}

// ── HTTP helpers ───────────────────────────────────────────────────────────

async function parseJsonOrThrow<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      detail = body?.error ? ` — ${body.error}` : "";
    } catch {
      /* non-JSON error body; status alone is the signal */
    }
    throw new Error(`${what} failed (${res.status})${detail}`);
  }
  return (await res.json()) as T;
}

/** GET /api/verify -> VerifyRef[] (the Ready-for-Test queue). */
export async function fetchVerifyQueue(
  signal?: AbortSignal
): Promise<VerifyRef[]> {
  const res = await fetch("/api/verify", { signal });
  return parseJsonOrThrow<VerifyRef[]>(res, "Loading the verify queue");
}

/** GET /api/verify/:task -> VerifyFile. */
export async function fetchVerifyFile(
  task: string,
  signal?: AbortSignal
): Promise<VerifyFile> {
  const res = await fetch(`/api/verify/${encodeURIComponent(task)}`, { signal });
  return parseJsonOrThrow<VerifyFile>(res, `Loading ${task}`);
}

/**
 * PUT /api/verify/:task with a VerdictPatch[] body and the X-Console-Token
 * header. The server writes the file and returns the reconciled VerifyFile.
 */
export async function saveVerdicts(
  task: string,
  patches: VerdictPatch[]
): Promise<VerifyFile> {
  const res = await fetch(`/api/verify/${encodeURIComponent(task)}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Console-Token": getConsoleToken(),
    },
    body: JSON.stringify(patches),
  });
  return parseJsonOrThrow<VerifyFile>(res, `Saving ${task}`);
}
