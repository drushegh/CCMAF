/**
 * analytics.ts — Client fetch helpers for TASK-025 analytics endpoints.
 *
 * Mirrors contract:console-http-api (TelemetrySummary, GotchaEntry, etc.)
 * The SPA imports ONLY from this file for analytics data — never server code.
 *
 * Reuses the ApiError class and getJson pattern from api/state.ts.
 */

import { ApiError } from "./state.js";

export type { ApiError };

// ── Types (mirror contract:console-http-api TASK-025 additions) ───────────────

export interface LastSessionInfo {
  toolUses: number | null;
  transcriptLines: number | null;
  sessionId: string | null;
}

export interface TelemetrySummary {
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
  lastSession: LastSessionInfo | null;
}

export interface GotchaEntry {
  title: string;
  category: string;
  confidence: string;
  count: number;
  firstSeen: string;
  /** The problem→fix prose under the entry (markdown). Optional — TASK-027. */
  body?: string;
}

/** A whitelisted `.claude/` markdown state file rendered as a doc (TASK-027). */
export interface StateDoc {
  key: string;
  exists: boolean;
  markdown: string;
  /** File mtime (ms epoch) for the DocPage "Last updated" meta row (TASK-106 §5.1). Absent when the file is. */
  mtimeMs?: number;
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

export interface SuggestionEntry {
  id: string;
  title: string;
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

export function fetchTelemetry(): Promise<TelemetrySummary> {
  return getJson<TelemetrySummary>("/api/telemetry");
}

export function fetchGotchas(): Promise<GotchaEntry[]> {
  return getJson<GotchaEntry[]>("/api/gotchas");
}

export function fetchFindings(): Promise<FindingsSummary> {
  return getJson<FindingsSummary>("/api/findings");
}

export function fetchFrameworkHealth(): Promise<FrameworkHealth> {
  return getJson<FrameworkHealth>("/api/framework");
}

export function fetchSuggestions(): Promise<SuggestionEntry[]> {
  return getJson<SuggestionEntry[]>("/api/suggestions");
}

/** Fetch a whitelisted `.claude/` state doc (status / review-findings / test-findings). */
export function fetchStateDoc(key: string): Promise<StateDoc> {
  return getJson<StateDoc>(`/api/statedoc/${encodeURIComponent(key)}`);
}
