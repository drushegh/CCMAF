/**
 * dashboard.ts — Client fetch helper for GET /api/dashboard (TASK-007)
 *
 * Mirrors contract:console-http-api (DashboardSummary) in .claude/ECOSYSTEM.md.
 * The SPA imports ONLY from this file for dashboard data — never server code.
 *
 * Reuses the ApiError class and getJson helper pattern from api/state.ts. We
 * duplicate the minimal pieces rather than exporting them from state.ts to keep
 * each api module self-contained (avoids cross-file coupling for a small helper).
 */

import { ApiError } from "./state.js";
import type { Lane } from "./state.js";

export type { Lane, ApiError };

// ── Types (mirror contract:console-http-api DashboardSummary) ─────────────────

export interface VerifyRef {
  task: string;
  title: string;
  counts: Record<string, number>;
  /** Present (true) only for a verify file that failed validation/read (M5-minor). */
  invalid?: boolean;
  invalidReason?: string;
}

export interface DecisionEntry {
  id: string;
  date: string;
  status: string;
  title: string;
  body: string;
}

export interface DashboardSummary {
  handbackQueue: VerifyRef[];
  taskCounts: { lane: Lane; status: string; n: number }[];
  contractCounts: { status: "draft" | "stable"; n: number }[];
  latestDecisions: DecisionEntry[];
  currentSpec: string | null;
  sprintGoal: string | null;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

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

// ── Public API ────────────────────────────────────────────────────────────────

export function fetchDashboard(): Promise<DashboardSummary> {
  return getJson<DashboardSummary>("/api/dashboard");
}
