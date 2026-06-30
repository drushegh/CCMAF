/**
 * telemetry-parser.ts — Read .claude/telemetry/events.jsonl + .hook-metrics (TASK-025, FS-003)
 *
 * Reads:
 *   .claude/telemetry/events.jsonl (NDJSON) — the PRIMARY source. The hooks
 *     append a line per event here every session; it is always present once any
 *     hook has run, and it is the live source of truth.
 *   .claude/telemetry/.hook-metrics (JSON) — a pre-aggregated summary generated
 *     by a throttled framework script. Used only as a FALLBACK: on a fresh
 *     consumer it may be absent (or stale) even when events.jsonl is full — that
 *     was FS-003 ("dashboard shows 0 hook events" while the log held 1,581).
 *
 * Returns a TelemetrySummary. Graceful-degrade: returns zeroed defaults when
 * files are absent or malformed. Aggregation is across ALL sessions in the log
 * (not scoped to the current session_id) and is tolerant per-line: each line is
 * JSON.parse'd independently, so the two emitter serialisations (compact
 * `{"ts":"…"}` and spaced `{"ts": "…"}`) and any malformed line are handled
 * without a regex (contract:telemetry-schema).
 *
 * contract:console-http-api, TASK-025
 */

import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import type { TelemetrySummary, HookMetrics, LastSessionInfo } from "../types.js";

const EMPTY_METRICS: HookMetrics = {
  generated_at: null,
  total_events: 0,
  by_hook: {},
  drift_triggers: {},
  sessions: 0,
  by_session: {},
};

/**
 * Parse the .hook-metrics JSON file.
 * Returns EMPTY_METRICS on any error.
 */
export function parseHookMetrics(filePath: string): HookMetrics {
  if (!existsSync(filePath)) {
    return { ...EMPTY_METRICS };
  }
  try {
    const content = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content) as Partial<HookMetrics>;
    return {
      generated_at: parsed.generated_at ?? null,
      total_events: parsed.total_events ?? 0,
      by_hook: parsed.by_hook ?? {},
      drift_triggers: parsed.drift_triggers ?? {},
      sessions: parsed.sessions ?? 0,
      by_session: parsed.by_session ?? {},
    };
  } catch (err) {
    console.warn(`[console] failed to read ${filePath}: ${String(err)}`);
    return { ...EMPTY_METRICS };
  }
}

/**
 * Read the last cost-tracker entry from events.jsonl by reverse-scanning.
 * The file can be large — we read it in 64KB chunks from the end.
 *
 * Returns null if the file is absent or no cost-tracker line is found.
 */
export function readLastCostTrackerEntry(filePath: string): LastSessionInfo | null {
  if (!existsSync(filePath)) {
    return null;
  }

  let fileSize: number;
  try {
    fileSize = statSync(filePath).size;
  } catch {
    return null;
  }

  if (fileSize === 0) return null;

  const CHUNK = 65536; // 64KB
  const fd = openSync(filePath, "r");
  try {
    let pos = fileSize;
    // Accumulate partial line from previous chunk
    let remainder = "";

    while (pos > 0) {
      const readSize = Math.min(CHUNK, pos);
      pos -= readSize;
      const buf = Buffer.alloc(readSize);
      readSync(fd, buf, 0, readSize, pos);

      // The chunk is read forward; we prepend to the remainder and split by lines
      const chunk = buf.toString("utf8") + remainder;
      const lines = chunk.split(/\n/);

      // The first element may be a partial line (from the previous chunk boundary)
      // Save it for the next iteration; process all complete lines in reverse
      remainder = lines[0];

      // Scan lines in reverse (last line first within this chunk)
      for (let i = lines.length - 1; i >= 1; i--) {
        const line = lines[i].trim();
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          if (obj.hook === "cost-tracker") {
            return {
              toolUses: typeof obj.tool_uses === "number" ? obj.tool_uses : null,
              transcriptLines: typeof obj.transcript_lines === "number" ? obj.transcript_lines : null,
              sessionId: typeof obj.session_id === "string" ? obj.session_id : null,
            };
          }
        } catch {
          // Malformed line — skip
        }
      }
    }

    // Check the final remainder (the very start of the file)
    if (remainder.trim()) {
      try {
        const obj = JSON.parse(remainder.trim()) as Record<string, unknown>;
        if (obj.hook === "cost-tracker") {
          return {
            toolUses: typeof obj.tool_uses === "number" ? obj.tool_uses : null,
            transcriptLines: typeof obj.transcript_lines === "number" ? obj.transcript_lines : null,
            sessionId: typeof obj.session_id === "string" ? obj.session_id : null,
          };
        }
      } catch {
        // Ignore
      }
    }
  } finally {
    closeSync(fd);
  }

  return null;
}

/**
 * Aggregate the full events.jsonl log into a HookMetrics summary + the last
 * cost-tracker entry, in a single forward pass.
 *
 * This is the FS-003 fix: rather than depend on the pre-aggregated .hook-metrics
 * (which a consumer may never have generated), compute the totals straight from
 * the raw event log — the always-present source of truth. Aggregation spans every
 * session in the file. Each line is parsed independently and a malformed/non-hook
 * line is skipped, so the compact + spaced emitter serialisations both work.
 *
 * Returns zeroed defaults + null when the file is absent, empty, or unreadable.
 */
export function aggregateEventsFile(filePath: string): {
  metrics: HookMetrics;
  lastSession: LastSessionInfo | null;
} {
  if (!existsSync(filePath)) {
    return { metrics: { ...EMPTY_METRICS }, lastSession: null };
  }
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return { metrics: { ...EMPTY_METRICS }, lastSession: null };
  }

  const by_hook: HookMetrics["by_hook"] = {};
  const drift_triggers: Record<string, number> = {};
  const by_session: HookMetrics["by_session"] = {};
  let total_events = 0;
  let lastTs: string | null = null;
  let lastSession: LastSessionInfo | null = null;

  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue; // tolerant: skip a malformed line (no regex — both emitters parse)
    }
    const hook = typeof ev.hook === "string" ? ev.hook : null;
    if (!hook) continue; // not a hook event line

    total_events++;
    const outcome = typeof ev.outcome === "string" ? ev.outcome : "unknown";
    const outcomeClass =
      typeof ev.outcome_class === "string" ? ev.outcome_class : "";
    const sessionId =
      typeof ev.session_id === "string" ? ev.session_id : "unknown";
    // ISO-8601 timestamps sort lexicographically == chronologically.
    const ts = typeof ev.ts === "string" ? ev.ts : null;
    if (ts && (lastTs === null || ts >= lastTs)) lastTs = ts;

    const hb = (by_hook[hook] ??= { total: 0, outcomes: {} });
    hb.total++;
    hb.outcomes[outcome] = (hb.outcomes[outcome] ?? 0) + 1;

    if (hook === "drift-guard" && typeof ev.trigger === "string") {
      drift_triggers[ev.trigger] = (drift_triggers[ev.trigger] ?? 0) + 1;
    }

    const sb = (by_session[sessionId] ??= {
      total: 0,
      blocked: 0,
      flagged: 0,
      drift_fires: 0,
      stop_blocked: 0,
    });
    sb.total++;
    if (outcomeClass === "blocked") sb.blocked++;
    if (outcomeClass === "flagged") sb.flagged++;
    if (hook === "drift-guard" && outcomeClass === "flagged") sb.drift_fires++;
    if (hook === "stop" && outcomeClass === "blocked") {
      sb.stop_blocked = (sb.stop_blocked ?? 0) + 1;
    }

    // The log is append-ordered, so the final cost-tracker line wins.
    if (hook === "cost-tracker") {
      lastSession = {
        toolUses: typeof ev.tool_uses === "number" ? ev.tool_uses : null,
        transcriptLines:
          typeof ev.transcript_lines === "number" ? ev.transcript_lines : null,
        sessionId: typeof ev.session_id === "string" ? ev.session_id : null,
      };
    }
  }

  const metrics: HookMetrics = {
    generated_at: lastTs,
    total_events,
    by_hook,
    drift_triggers,
    sessions: Object.keys(by_session).length,
    by_session,
  };
  return { metrics, lastSession };
}

/**
 * Read telemetry summary from the telemetry directory.
 *
 * PRIMARY path: aggregate events.jsonl directly (live, all sessions). FALLBACK
 * (events.jsonl absent or yields nothing usable): the pre-aggregated
 * .hook-metrics, if one was shipped. This ordering is the FS-003 fix — a fresh
 * consumer with a full event log but no generated aggregate now reports real
 * numbers instead of 0.
 */
export function readTelemetry(
  hookMetricsPath: string,
  eventsJsonlPath: string
): TelemetrySummary {
  const { metrics, lastSession } = aggregateEventsFile(eventsJsonlPath);
  if (metrics.total_events > 0) {
    return { ...metrics, lastSession };
  }

  // No usable raw log — fall back to the pre-aggregated summary if present.
  const fallback = parseHookMetrics(hookMetricsPath);
  return {
    ...fallback,
    lastSession: lastSession ?? readLastCostTrackerEntry(eventsJsonlPath),
  };
}
