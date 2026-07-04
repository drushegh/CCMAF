/**
 * analytics-routes.ts — Fastify plugin for TASK-025 analytics endpoints.
 *
 * Registers:
 *   GET /api/telemetry  → TelemetrySummary
 *   GET /api/gotchas    → GotchaEntry[]
 *   GET /api/findings   → FindingsSummary
 *   GET /api/framework  → FrameworkHealth
 *   GET /api/suggestions → SuggestionEntry[]
 *
 * All reads are fresh per request (no-state-projection, DEC-002).
 * All graceful-degrade: missing/malformed files return empty/default shapes.
 *
 * contract:console-http-api, TASK-025
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { existsSync, readFileSync } from "node:fs";

import { dotClaudePath } from "../project-root.js";
import { readTelemetry } from "../parsers/telemetry-parser.js";
import { parseGotchasFile } from "../parsers/gotchas-parser.js";
import { parseFindingsFiles } from "../parsers/findings-parser.js";
import { parseSuggestionsFile } from "../parsers/suggestions-parser.js";
import type {
  TelemetrySummary,
  GotchaEntry,
  FindingsSummary,
  FrameworkHealth,
  SuggestionEntry,
} from "../types.js";

/**
 * Parse `.framework-version` (a KEY=value shell-config file) into a compact
 * `branch@shortSHA` version string. Falls back to the first non-comment line
 * (truncated) so we never dump the whole file; null when nothing usable.
 */
export function parseFrameworkVersion(raw: string): string | null {
  const get = (key: string): string | null => {
    const m = raw.match(new RegExp(`^${key}=(.*)$`, "m"));
    return m ? m[1].trim() : null;
  };
  const sha = get("FRAMEWORK_PINNED_SHA");
  const branch = get("FRAMEWORK_UPSTREAM_BRANCH");
  if (sha) return `${branch ? `${branch}@` : ""}${sha.slice(0, 7)}`;
  const firstLine = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("#"));
  return firstLine ? firstLine.slice(0, 40) : null;
}

export const analyticsRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  // ── GET /api/telemetry ──────────────────────────────────────────────────────
  fastify.get<{ Reply: TelemetrySummary }>("/api/telemetry", async () => {
    const hookMetricsPath = dotClaudePath("telemetry", ".hook-metrics");
    const eventsJsonlPath = dotClaudePath("telemetry", "events.jsonl");
    return readTelemetry(hookMetricsPath, eventsJsonlPath);
  });

  // ── GET /api/gotchas ────────────────────────────────────────────────────────
  fastify.get<{ Reply: GotchaEntry[] }>("/api/gotchas", async () => {
    return parseGotchasFile(dotClaudePath("GOTCHAS.md"));
  });

  // ── GET /api/findings ───────────────────────────────────────────────────────
  fastify.get<{ Reply: FindingsSummary }>("/api/findings", async () => {
    const reviewPath = dotClaudePath("review-findings.md");
    const testPath = dotClaudePath("test-findings.md");
    return parseFindingsFiles(reviewPath, testPath);
  });

  // ── GET /api/framework ──────────────────────────────────────────────────────
  fastify.get<{ Reply: FrameworkHealth }>("/api/framework", async () => {
    // Framework version — `.framework-version` is a KEY=value shell-config file
    // (FRAMEWORK_UPSTREAM_BRANCH / FRAMEWORK_PINNED_SHA / …). Parse it into a
    // compact `branch@shortSHA`, NOT the whole file.
    let version: string | null = null;
    const versionPath = dotClaudePath(".framework-version");
    if (existsSync(versionPath)) {
      try {
        version = parseFrameworkVersion(readFileSync(versionPath, "utf8"));
      } catch {
        // Graceful-degrade
      }
    }

    // Update available flag
    const updateAvailable = existsSync(
      dotClaudePath(".framework-update-available.md")
    );

    // Healthcheck last run
    let healthcheckLastRun: string | null = null;
    const healthcheckPath = dotClaudePath("telemetry", ".last-healthcheck");
    if (existsSync(healthcheckPath)) {
      try {
        healthcheckLastRun = readFileSync(healthcheckPath, "utf8").trim() || null;
      } catch {
        // Graceful-degrade
      }
    }

    // Doctor clean
    const doctorClean = !existsSync(
      dotClaudePath(".framework-doctor-findings.md")
    );

    return { version, updateAvailable, healthcheckLastRun, doctorClean };
  });

  // ── GET /api/suggestions ────────────────────────────────────────────────────
  fastify.get<{ Reply: SuggestionEntry[] }>("/api/suggestions", async () => {
    return parseSuggestionsFile(dotClaudePath("FRAMEWORK-SUGGESTIONS.md"));
  });
};
