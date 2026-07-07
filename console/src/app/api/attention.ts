/**
 * attention.ts — Client fetch for GET /api/attention (TASK-109, S3).
 *
 * Mirrors the server's AttentionItem shape (contract:console-http-api /
 * CONSOLE-V2-DESIGN.md S3). The SPA imports ONLY from this file for the
 * needs-you feed — never server code.
 *
 * Reuses the ApiError class and getJson pattern from api/state.ts.
 */

import { ApiError } from "./state.js";

export type { ApiError };

// ── Types (mirror the server's types.ts S3 additions) ─────────────────────────

/** Source kind of an AttentionItem (S3). */
export type AttentionKind =
  "verify" | "decision" | "doctor" | "bug" | "update" | "review";

/** One ranked "needs a human" item from GET /api/attention. */
export interface AttentionItem {
  kind: AttentionKind;
  /**
   * Computed: P0 bug=0, doctor CRITICAL=1, verify=2, P1 bug=3,
   * flagged decision=4, review criticals=5, update=6 (+age tiebreak).
   */
  rank: number;
  title: string;
  detail: string;
  /** In-project SPA route (contract:console-deep-links). */
  link: string;
  /** e.g. pending items in a verify seed / open review criticals. */
  count?: number;
  /** ISO — drives "waiting 2d" chips. Null when the source has no timestamp. */
  since: string | null;
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError(
      `Could not reach the Console server (${path}). Is it running?`,
    );
  }
  if (!res.ok) {
    throw new ApiError(
      `Request to ${path} failed with ${res.status} ${res.statusText}`,
      res.status,
    );
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(`Malformed JSON from ${path}`, res.status);
  }
}

/** The project's ranked needs-you feed (server-sorted; render in order). */
export function fetchAttention(): Promise<AttentionItem[]> {
  return getJson<AttentionItem[]>("/api/attention");
}
