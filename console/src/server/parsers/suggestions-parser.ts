/**
 * suggestions-parser.ts — Parse .claude/FRAMEWORK-SUGGESTIONS.md → SuggestionEntry[] (TASK-025)
 *
 * Format (tolerant of ## or ### and — or - separators):
 *   ### FS-001 — <title>
 *   ## FS-001 - <title>
 *
 * Empty state: missing file → []
 *
 * contract:console-http-api, TASK-025
 */

import { readFileSync, existsSync } from "node:fs";
import type { SuggestionEntry } from "../types.js";

// Tolerant: ##/###, FS-NNN, —/–/- separator
const ENTRY_RE = /^#{2,3}\s+(FS-\d+)\s*[—–\-]\s*(.*)/;

/**
 * Parse FRAMEWORK-SUGGESTIONS.md content into SuggestionEntry[].
 * Exported for unit testing.
 */
export function parseSuggestionsMd(content: string): SuggestionEntry[] {
  const lines = content.split(/\r?\n/);
  const results: SuggestionEntry[] = [];

  for (const line of lines) {
    const m = ENTRY_RE.exec(line);
    if (m) {
      results.push({
        id: m[1].trim(),
        title: m[2].trim(),
      });
    }
  }

  return results;
}

/**
 * Read and parse .claude/FRAMEWORK-SUGGESTIONS.md from the given path.
 * Returns [] if the file does not exist.
 */
export function parseSuggestionsFile(filePath: string): SuggestionEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const content = readFileSync(filePath, "utf8");
    return parseSuggestionsMd(content);
  } catch (err) {
    console.warn(`[console] failed to read ${filePath}: ${String(err)}`);
    return [];
  }
}
