/**
 * contracts-parser.ts — Parse .claude/ECOSYSTEM.md → ContractSummary[] (TASK-003)
 *
 * Looks for HTML comment anchors of the form:
 *   <!-- contract:ID status:draft|stable -->
 *
 * The title is the text of the nearest preceding ### heading (or the
 * nearest preceding ## heading if no ### was seen since the last anchor).
 *
 * Empty state: missing file → []
 *
 * contract:console-state-sources, contract:console-http-api
 */

import { readFileSync, existsSync } from "node:fs";
import type { ContractSummary } from "../types.js";

// Matches: <!-- contract:some-id status:stable --> or <!-- contract:id status:draft -->
const ANCHOR_RE = /<!--\s*contract:(\S+)\s+status:(draft|stable)\s*-->/;

// Any markdown heading
const H3_RE = /^###\s+(.+)/;
const H2_RE = /^##\s+(.+)/;

/**
 * Parse the content of ECOSYSTEM.md into ContractSummary[].
 * Exported for unit testing.
 */
export function parseEcosystemMd(content: string): ContractSummary[] {
  const lines = content.split(/\r?\n/);
  const results: ContractSummary[] = [];

  let lastH2 = "";
  let lastH3 = "";

  for (const line of lines) {
    const h3Match = H3_RE.exec(line);
    if (h3Match) {
      lastH3 = h3Match[1].trim();
      continue;
    }

    const h2Match = H2_RE.exec(line);
    if (h2Match) {
      lastH2 = h2Match[1].trim();
      lastH3 = ""; // reset sub-heading when a new section starts
      continue;
    }

    const anchorMatch = ANCHOR_RE.exec(line);
    if (anchorMatch) {
      const id = anchorMatch[1];
      const status = anchorMatch[2] as "draft" | "stable";
      // Prefer the most-recent ### heading; fall back to ##
      const title = lastH3 || lastH2 || id;
      results.push({ id, status, title });
    }
  }

  return results;
}

/**
 * Read and parse .claude/ECOSYSTEM.md from the given path.
 * Returns [] if the file does not exist.
 */
export function parseContractsFile(filePath: string): ContractSummary[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const content = readFileSync(filePath, "utf8");
    return parseEcosystemMd(content);
  } catch (err) {
    console.warn(`[console] failed to read ${filePath}: ${String(err)}`);
    return [];
  }
}
