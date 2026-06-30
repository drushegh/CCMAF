/**
 * tasks-parser.ts — Parse .claude/TASKS.md → TaskBoard (TASK-003)
 *
 * Format expected:
 *   ## Feature Lane        — opens the feature lane section
 *   ## Bug-Fix Lane        — opens the bug-fix lane section
 *   ### <Status>           — opens a column (e.g. "### In Progress")
 *   #### [TASK-XXX] title  — a task item (feature lane)
 *   #### [BUG-XXX] title   — a task item (bug-fix lane)
 *
 * Empty state: missing file → TaskBoard { columns: [] }
 *
 * HTML-comment handling:
 *   Lines between <!-- and --> are skipped for COLUMN_RE and TASK_ITEM_RE
 *   matching. We track an `inComment` boolean across lines. A single line
 *   containing both <!-- and --> (e.g. <!-- foo -->) is treated as a self-
 *   contained comment (net result: not in a comment after the line). A -->
 *   that appears with no preceding <!-- resets to not-in-comment (safe
 *   no-op). This handles the real TASKS.md format; we don't attempt to
 *   handle nested or malformed HTML comments.
 *
 * contract:console-state-sources, contract:console-http-api
 */

import { readFileSync, existsSync } from "node:fs";
import type { TaskBoard, TaskBoardColumn, TaskItem, Lane } from "../types.js";
import { ARCHIVED_MARKER_RE, matchTaskHeading } from "../tasks/writeback.js";

// Headings that denote lane changes
const FEATURE_LANE_RE = /^##\s+Feature\s+Lane/i;
const BUG_LANE_RE = /^##\s+Bug[\s-]+Fix\s+Lane/i;

// A column heading (### Status) — but NOT #### task items or higher-level sections
const COLUMN_RE = /^###\s+(.+)/;

// Task items are matched via `matchTaskHeading` (writeback.ts), which accepts
// BOTH `#### [TASK-N] title` (Console canonical) and bare `#### TASK-N — title`
// (the framework's house style) — CHANNEL [11]; the Console is the liberal reader.

/**
 * Parse the content of a TASKS.md file into a TaskBoard.
 * Exported for unit testing.
 */
export function parseTasksMd(content: string): TaskBoard {
  const lines = content.split(/\r?\n/);

  let currentLane: Lane = "feature";
  let currentStatus: string | null = null;
  // HTML-comment state: true while we are between <!-- and --> across lines.
  let inComment = false;
  // The most-recently-seen task item, so an archived marker on a following line
  // attaches to it. Reset on any lane/column heading so a stray marker can't
  // attach across sections.
  let lastItem: TaskItem | null = null;

  // Map of "lane:status" → TaskBoardColumn (preserve insertion order)
  const columnMap = new Map<string, TaskBoardColumn>();

  const getColumn = (lane: Lane, status: string): TaskBoardColumn => {
    const key = `${lane}:${status}`;
    if (!columnMap.has(key)) {
      columnMap.set(key, { status, lane, items: [] });
    }
    return columnMap.get(key)!;
  };

  for (const line of lines) {
    // ── HTML-comment tracking ─────────────────────────────────────────────────
    // Count opens and closes on this line to determine net comment state.
    // A line like "<!-- foo -->" opens and closes; net: same state as before.
    // We count occurrences naively (good enough for TASKS.md format).
    const opens = (line.match(/<!--/g) ?? []).length;
    const closes = (line.match(/-->/g) ?? []).length;
    const wasInComment = inComment;

    if (!inComment) {
      // Not in a comment before this line: any opens start a comment.
      // If opens > closes the line ends inside a comment.
      // If opens === closes (e.g. single-line <!-- ... -->) we stay out.
      if (opens > closes) {
        inComment = true;
      }
      // If opens === closes and opens > 0, the line contains a self-contained
      // comment but may also have content outside it. We still process the
      // line for lane/column/item matches (the outer text matters), but we
      // don't want to match content that is INSIDE the comment. For the real
      // TASKS.md format, comment-only lines with self-contained <!-- --> do
      // not contain headings that would otherwise match, so processing the
      // line as normal is safe and correct here.
    } else {
      // Currently inside a comment: close(s) exit it.
      if (closes > 0) {
        inComment = false;
      }
    }

    // If this line is inside a comment (before or after the markers), skip
    // structure matching entirely. We skip if we WERE in a comment before
    // processing this line OR if we entered a comment on this line and the
    // line opened (but didn't close) the comment — i.e. inComment is still
    // true after processing.
    if (wasInComment || (opens > 0 && inComment)) {
      continue;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Archived marker — a self-contained <!-- archived --> comment attaches to
    // the task whose block it sits in. (Self-contained comments are NOT skipped
    // by the block above, so this is reachable.)
    if (ARCHIVED_MARKER_RE.test(line)) {
      if (lastItem) lastItem.archived = true;
      continue;
    }

    if (FEATURE_LANE_RE.test(line)) {
      currentLane = "feature";
      currentStatus = null;
      lastItem = null;
      continue;
    }
    if (BUG_LANE_RE.test(line)) {
      currentLane = "bug";
      currentStatus = null;
      lastItem = null;
      continue;
    }

    const columnMatch = COLUMN_RE.exec(line);
    if (columnMatch) {
      // Strip trailing parenthetical group(s) from the status label.
      // e.g. "Todo (Priority Order)" → "Todo"
      //      "Foo (a) (b)"          → "Foo"
      const raw = columnMatch[1].trim();
      const status = raw.replace(/(\s*\([^)]*\))+\s*$/, "").trim();
      currentStatus = status;
      // Eagerly create the column so empty statuses appear in the board
      getColumn(currentLane, currentStatus);
      continue;
    }

    if (currentStatus === null) continue;

    const itemMatch = matchTaskHeading(line);
    if (itemMatch) {
      const prefix = itemMatch.prefix; // "TASK" or "BUG"
      const num = itemMatch.num;
      const title = itemMatch.title;
      const id = `${prefix}-${num}`;
      // Lane override from prefix: BUG always goes in bug lane regardless of section.
      // In practice the document sections align, but the prefix is authoritative.
      const itemLane: Lane = prefix === "BUG" ? "bug" : "feature";

      const item: TaskItem = {
        id,
        title,
        status: currentStatus,
        lane: itemLane,
        archived: false,
      };
      getColumn(itemLane, currentStatus).items.push(item);
      lastItem = item;
    }
  }

  return { columns: Array.from(columnMap.values()) };
}

/**
 * Read and parse .claude/TASKS.md from the given path.
 * Returns an empty TaskBoard if the file does not exist.
 */
export function parseTasksFile(filePath: string): TaskBoard {
  if (!existsSync(filePath)) {
    return { columns: [] };
  }
  try {
    const content = readFileSync(filePath, "utf8");
    return parseTasksMd(content);
  } catch (err) {
    console.warn(`[console] failed to read ${filePath}: ${String(err)}`);
    return { columns: [] };
  }
}
