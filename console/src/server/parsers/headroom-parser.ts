/**
 * headroom-parser.ts — Parse .claude/telemetry/headroom-metrics.jsonl (TASK-029)
 *
 * The framework's Headroom integration normalizes Headroom's real per-request
 * output into a stable schema `headroom-metrics/1`, one JSON object per line.
 * This parser aggregates those records for the Console's Headroom surface.
 *
 * Honesty (DEC-018): we only ever SUM/AVERAGE real numbers the file contains.
 * A null field is skipped, never zero-filled into an average; a malformed line
 * is dropped, not guessed. Empty state (file absent / no valid records) →
 * { available: false, ... } so the page degrades cleanly.
 *
 * contract:console-http-api, TASK-029
 */

import { readFileSync, existsSync } from "node:fs";
import type { HeadroomRecord, HeadroomSummary } from "../types.js";

const RECENT_LIMIT = 50;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Map one parsed JSON line (stable schema) to a HeadroomRecord. */
function toRecord(o: Record<string, unknown>): HeadroomRecord {
  return {
    eventId: str(o.event_id),
    ts: str(o.ts) ?? str(o.normalized_at),
    model: str(o.model),
    tokensIn: num(o.tokens_in),
    tokensOut: num(o.tokens_out),
    tokensSaved: num(o.tokens_saved),
    compressionRatio: num(o.compression_ratio),
    costUsd: num(o.cost_usd),
    latencyMs: num(o.latency_ms),
  };
}

const EMPTY: HeadroomSummary = {
  available: false,
  recordCount: 0,
  tokensIn: 0,
  tokensOut: 0,
  tokensSaved: 0,
  avgCompressionRatio: null,
  costUsd: 0,
  lastRun: null,
  recent: [],
};

/** Parse JSONL content into a HeadroomSummary. Exported for unit testing. */
export function parseHeadroomJsonl(content: string): HeadroomSummary {
  const records: HeadroomRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      records.push(toRecord(obj));
    } catch {
      // Drop malformed lines — never guess.
    }
  }

  if (records.length === 0) return { ...EMPTY };

  let tokensIn = 0;
  let tokensOut = 0;
  let tokensSaved = 0;
  let ratioSum = 0;
  let ratioCount = 0;
  let costSum = 0;
  let costCount = 0;
  let lastRun: string | null = null;

  for (const r of records) {
    if (r.tokensIn != null) tokensIn += r.tokensIn;
    if (r.tokensOut != null) tokensOut += r.tokensOut;
    if (r.tokensSaved != null) tokensSaved += r.tokensSaved;
    if (r.compressionRatio != null) {
      ratioSum += r.compressionRatio;
      ratioCount++;
    }
    if (r.costUsd != null) {
      costSum += r.costUsd;
      costCount++;
    }
    if (r.ts && (!lastRun || r.ts > lastRun)) lastRun = r.ts;
  }

  // Most-recent-first for the table (input is append-only / oldest-first).
  const recent = records.slice(-RECENT_LIMIT).reverse();

  return {
    available: true,
    recordCount: records.length,
    tokensIn,
    tokensOut,
    tokensSaved,
    avgCompressionRatio: ratioCount > 0 ? ratioSum / ratioCount : null,
    costUsd: costCount > 0 ? costSum : null,
    lastRun,
    recent,
  };
}

/** Read + parse the metrics file. Returns the empty summary when absent. */
export function readHeadroomMetrics(filePath: string): HeadroomSummary {
  if (!existsSync(filePath)) return { ...EMPTY };
  try {
    return parseHeadroomJsonl(readFileSync(filePath, "utf8"));
  } catch (err) {
    console.warn(`[console] failed to read ${filePath}: ${String(err)}`);
    return { ...EMPTY };
  }
}
