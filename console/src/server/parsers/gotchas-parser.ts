/**
 * gotchas-parser.ts — Parse .claude/GOTCHAS.md → GotchaEntry[] (TASK-025)
 *
 * Format expected:
 *   ## <Category>
 *   ### <title>
 *   **Confidence:** <text>
 *   Count: <n> · First seen: <date>
 *
 * Skips the HTML-comment template block at the top.
 * Empty state: missing file → []
 *
 * contract:console-http-api, TASK-025
 */

import { readFileSync, existsSync } from "node:fs";
import type { GotchaEntry } from "../types.js";

const CATEGORY_RE = /^##\s+(.+)/;
const ENTRY_RE = /^###\s+(.+)/;
const CONFIDENCE_RE = /^\*\*Confidence:\*\*\s*(.*)/;
const COUNT_FIRSTSEEN_RE = /^Count:\s*(\d+)\s*·\s*First seen:\s*(.+)/;

/**
 * Parse GOTCHAS.md content into GotchaEntry[].
 * Exported for unit testing.
 */
export function parseGotchasMd(content: string): GotchaEntry[] {
  const lines = content.split(/\r?\n/);
  const results: GotchaEntry[] = [];

  let inComment = false;
  let currentCategory = "";
  let currentTitle: string | null = null;
  let currentConfidence = "";
  let currentCount = 0;
  let currentFirstSeen = "";
  let currentBody: string[] = [];

  const flush = () => {
    if (currentTitle !== null) {
      results.push({
        title: currentTitle,
        category: currentCategory,
        confidence: currentConfidence,
        count: currentCount,
        firstSeen: currentFirstSeen,
        body: currentBody.join("\n").trim(),
      });
    }
    currentTitle = null;
    currentConfidence = "";
    currentCount = 0;
    currentFirstSeen = "";
    currentBody = [];
  };

  for (const line of lines) {
    // Track multi-line HTML comments
    const opens = (line.match(/<!--/g) ?? []).length;
    const closes = (line.match(/-->/g) ?? []).length;
    const wasInComment = inComment;

    if (!inComment) {
      if (opens > closes) inComment = true;
    } else {
      if (closes > 0) inComment = false;
    }

    if (wasInComment || (opens > 0 && inComment)) continue;

    const categoryMatch = CATEGORY_RE.exec(line);
    if (categoryMatch) {
      flush();
      currentCategory = categoryMatch[1].trim();
      continue;
    }

    const entryMatch = ENTRY_RE.exec(line);
    if (entryMatch) {
      flush();
      currentTitle = entryMatch[1].trim();
      continue;
    }

    if (currentTitle === null) continue;

    const confidenceMatch = CONFIDENCE_RE.exec(line);
    if (confidenceMatch) {
      currentConfidence = confidenceMatch[1].trim();
      continue;
    }

    const countMatch = COUNT_FIRSTSEEN_RE.exec(line);
    if (countMatch) {
      currentCount = parseInt(countMatch[1], 10) || 0;
      currentFirstSeen = countMatch[2].trim();
      continue;
    }

    // Any remaining line inside an entry is body prose (the problem→fix text).
    currentBody.push(line);
  }

  flush();
  return results;
}

/**
 * Read and parse .claude/GOTCHAS.md from the given path.
 * Returns [] if the file does not exist.
 */
export function parseGotchasFile(filePath: string): GotchaEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const content = readFileSync(filePath, "utf8");
    return parseGotchasMd(content);
  } catch (err) {
    console.warn(`[console] failed to read ${filePath}: ${String(err)}`);
    return [];
  }
}
