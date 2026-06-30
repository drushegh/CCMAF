/**
 * readme-parser.ts — Read <projectRoot>/README.md → ReadmeDoc (TASK-003)
 *
 * Empty state: missing README → { exists: false, markdown: "" }
 *
 * contract:console-state-sources, contract:console-http-api
 */

import { readFileSync, existsSync } from "node:fs";
import type { ReadmeDoc } from "../types.js";

/**
 * Read README.md from the given path.
 * Returns { exists: false, markdown: "" } if the file is absent.
 */
export function parseReadmeFile(filePath: string): ReadmeDoc {
  if (!existsSync(filePath)) {
    return { exists: false, markdown: "" };
  }
  try {
    const markdown = readFileSync(filePath, "utf8");
    return { exists: true, markdown };
  } catch (err) {
    console.warn(`[console] failed to read ${filePath}: ${String(err)}`);
    return { exists: false, markdown: "" };
  }
}
