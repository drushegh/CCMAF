/**
 * decisions-parser.ts — Parse .claude/DECISIONS.md → DecisionEntry[] (TASK-003)
 *
 * Format expected (Console canonical):
 *   ## DEC-XXX — title
 *   **Date:** YYYY-MM-DD · **Status:** active|superseded|...
 *   **Decision:** body text (may span multiple lines until the next ## heading)
 *
 * ALSO accepted (the framework's house style — CHANNEL [11], be the liberal reader):
 *   ## YYYY-MM-DD — title          (no meta line; ID synthesized from the date,
 *                                   status defaults to "active")
 *
 * Empty state: missing file → []
 *
 * contract:console-state-sources, contract:console-http-api
 */

import { readFileSync, existsSync } from "node:fs";
import type { DecisionEntry } from "../types.js";

// ## DEC-001 — Some title
const DECISION_HEADING_RE = /^##\s+(DEC-\d+)\s+[—–-]\s+(.*)/;

// ## 2026-06-25 — Some title  (framework house style; no DEC-N, no meta line)
const DATE_HEADING_RE = /^##\s+(\d{4}-\d{2}-\d{2})\s+[—–-]\s+(.*)/;

// **Date:** 2026-01-01 · **Status:** active  (anchored at line start)
const DATE_STATUS_RE = /^\*\*Date:\*\*\s*([^\s·]+).*\*\*Status:\*\*\s*(\S+)/;

/**
 * Parse the content of DECISIONS.md into DecisionEntry[].
 * Exported for unit testing.
 */
export function parseDecisionsMd(content: string): DecisionEntry[] {
  const lines = content.split(/\r?\n/);
  const results: DecisionEntry[] = [];

  let currentId: string | null = null;
  let currentTitle = "";
  let currentDate = "";
  let currentStatus = "";
  let bodyLines: string[] = [];

  const flush = () => {
    if (currentId) {
      results.push({
        id: currentId,
        date: currentDate,
        status: currentStatus,
        title: currentTitle,
        body: bodyLines.join("\n").trim(),
      });
    }
    currentId = null;
    currentTitle = "";
    currentDate = "";
    currentStatus = "";
    bodyLines = [];
  };

  for (const line of lines) {
    const headingMatch = DECISION_HEADING_RE.exec(line);
    if (headingMatch) {
      flush();
      currentId = headingMatch[1];
      currentTitle = headingMatch[2].trim();
      continue;
    }

    // Framework house style: a date heading with no DEC-N / meta line. Synthesize
    // the ID from the date and default the status to "active" (CHANNEL [11]).
    const dateHeadingMatch = DATE_HEADING_RE.exec(line);
    if (dateHeadingMatch) {
      flush();
      currentId = dateHeadingMatch[1]; // the date doubles as the id
      currentTitle = dateHeadingMatch[2].trim();
      currentDate = dateHeadingMatch[1];
      currentStatus = "active";
      continue;
    }

    if (currentId === null) continue;

    const dateStatusMatch = DATE_STATUS_RE.exec(line);
    if (dateStatusMatch) {
      currentDate = dateStatusMatch[1];
      // Strip trailing punctuation from status (e.g. "active." → "active")
      currentStatus = dateStatusMatch[2].replace(/[.,;]$/, "");
      continue;
    }

    // Collect body — skip the metadata lines already captured
    bodyLines.push(line);
  }

  flush();
  return results;
}

/**
 * Read and parse .claude/DECISIONS.md from the given path.
 * Returns [] if the file does not exist.
 */
export function parseDecisionsFile(filePath: string): DecisionEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const content = readFileSync(filePath, "utf8");
    return parseDecisionsMd(content);
  } catch (err) {
    console.warn(`[console] failed to read ${filePath}: ${String(err)}`);
    return [];
  }
}
