/**
 * writeback.ts — Pure, format-preserving TASKS.md mutation functions (TASK-010).
 *
 * These functions are purposely pure (no disk I/O) so they can be tested without
 * a filesystem. The route layer handles reading + atomic writing.
 *
 * Block boundary rule:
 *   A task block starts at the `#### [<ID>] …` heading line and extends to
 *   (but NOT including) the first subsequent line that is a STRUCTURAL boundary:
 *   - Next task heading:   ^####\s+\[(TASK|BUG)-
 *   - Next status heading: ^###\s
 *   - Next lane heading:   ^##\s
 *   A `####` or `###` line that does NOT match those patterns (e.g. body markdown
 *   containing a subheading) does NOT end the block.
 *   Trailing blank lines WITHIN a block are included (they belong to the
 *   block). Blank lines that are between two blocks (i.e. after the last
 *   non-blank line of one block and before the heading of the next) are
 *   treated as part of the PRECEDING block — this keeps the removed slot
 *   clean and prevents blank-line accumulation at re-insertion sites.
 *
 * contract:console-task-writeback
 */

import type { Lane } from "../types.js";

// ── Internal regex / constants ────────────────────────────────────────────────

/**
 * Matches a STRUCTURAL block boundary: the next task heading, the next status
 * heading (###), or the next lane heading (##). Body lines that happen to
 * start with ###/#### but are NOT one of these structural forms do NOT end
 * the block (e.g. `- e.g. #### Subtask` or `### Example` in a body list).
 *
 * Structural boundaries:
 *   #### [TASK-...] or #### [BUG-...]  — next task heading
 *   ### <anything>                      — status section heading
 *   ## <anything>                       — lane heading
 */
const STRUCTURAL_BOUNDARY_RE =
  /^####\s+\[?(TASK|BUG)-|^###\s|^##\s/;

/** Matches the ## lane headings. */
const FEATURE_LANE_RE = /^##\s+Feature\s+Lane/i;
const BUG_LANE_RE = /^##\s+Bug[\s-]+Fix\s+Lane/i;

/** Matches a ### status section (NOT #### task). */
const STATUS_HEADING_RE = /^###\s+(.+)/;

/**
 * Task heading. We accept BOTH the Console's canonical bracketed form
 * `#### [TASK-N] title` AND the framework's bare house style
 * `#### TASK-N — title` (CHANNEL [11] — the Console is the liberal reader).
 * Bracketed is tried first so a bracketed title that begins with a dash is never
 * mis-split; the bare form consumes an optional `— / – / - / :` separator.
 */
const TASK_HEADING_BRACKETED_RE = /^####\s+\[(TASK|BUG)-(\d+)\]\s+(.*)$/;
const TASK_HEADING_BARE_RE = /^####\s+(TASK|BUG)-(\d+)(?:\s*[—–:\-]+)?\s*(.*)$/;

export interface TaskHeadingMatch {
  prefix: "TASK" | "BUG";
  num: string;
  title: string;
  /** Whether the on-disk heading used brackets (so writes can preserve the form). */
  bracketed: boolean;
}

/** Parse a `####` task heading in either the bracketed or bare form. */
export function matchTaskHeading(line: string): TaskHeadingMatch | null {
  const b = TASK_HEADING_BRACKETED_RE.exec(line);
  if (b) return { prefix: b[1] as "TASK" | "BUG", num: b[2], title: b[3].trim(), bracketed: true };
  const r = TASK_HEADING_BARE_RE.exec(line);
  if (r) return { prefix: r[1] as "TASK" | "BUG", num: r[2], title: r[3].trim(), bracketed: false };
  return null;
}

/** True if the board uses bracketed IDs (so createBug matches the house style). */
function usesBracketedIds(content: string): boolean {
  return /^####\s+\[(TASK|BUG)-/m.test(content);
}

/** The canonical task-id pattern (same as contract:console-http-api). */
export const TASK_ID_RE = /^(TASK|BUG)-[0-9]+$/;

/**
 * A task's archived flag is a self-contained HTML comment within its block
 * (invisible when the markdown renders, and skipped by the framework's own
 * parser). This matches a whole archived-marker line.
 */
export const ARCHIVED_MARKER_RE = /^\s*<!--\s*archived\b[^>]*-->\s*$/i;
/** The exact marker line the Console writes when archiving a task. */
export const ARCHIVED_MARKER_LINE = "<!-- archived -->";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TaskBlockFound = {
  found: true;
  lane: Lane;
  status: string;
  /** 0-based index of the `#### [ID] …` line. */
  headingLineIndex: number;
  /** Lines belonging to this block (heading + body, NOT the next heading). */
  blockLines: string[];
};

export type TaskBlockNotFound = { found: false };
export type TaskBlockResult = TaskBlockFound | TaskBlockNotFound;

export type MoveResult =
  | { ok: true; content: string }
  | { ok: false; code: "not_found" | "target_missing" | "ambiguous" };

export interface TaskDetail {
  id: string;
  title: string;
  lane: Lane;
  status: string;
  body: string[];
  archived: boolean;
}

// ── helpers ───────────────────────────────────────────────────────────────────

/** Normalise a status name: strip trailing parenthetical(s), trim whitespace. */
function normaliseStatus(raw: string): string {
  return raw.replace(/(\s*\([^)]*\))+\s*$/, "").trim();
}

/**
 * Walk the lines and determine, for each line, the current lane.
 * Returns an array of Lane values parallel to `lines`.
 */
function buildLaneIndex(lines: string[]): Lane[] {
  const index: Lane[] = [];
  let currentLane: Lane = "feature";
  for (const line of lines) {
    if (FEATURE_LANE_RE.test(line)) currentLane = "feature";
    else if (BUG_LANE_RE.test(line)) currentLane = "bug";
    index.push(currentLane);
  }
  return index;
}

/**
 * Infer the default lane for an ID from its prefix.
 * BUG-* → bug; TASK-* → feature.
 */
function laneFromId(id: string): Lane {
  return id.startsWith("BUG-") ? "bug" : "feature";
}

// ── extractTaskBlock ──────────────────────────────────────────────────────────

/**
 * Locate the block for `id` within the markdown content.
 *
 * The block runs from the `#### [<ID>]` heading to (but not including) the
 * next `##`, `###`, or `####` line. Trailing blank lines are included in the
 * block (they follow the task's bullet body).
 *
 * Returns `{ found: false }` if no matching heading is found.
 * Returns `{ found: true, … }` with the lane, normalised status, the 0-based
 * heading line index, and the block's raw lines.
 */
export function extractTaskBlock(content: string, id: string): TaskBlockResult {
  const lines = content.split(/\r?\n/);
  const laneIndex = buildLaneIndex(lines);

  let currentStatus: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track current status heading.
    const statusMatch = STATUS_HEADING_RE.exec(line);
    if (statusMatch) {
      currentStatus = normaliseStatus(statusMatch[1]);
      continue;
    }

    const taskMatch = matchTaskHeading(line);
    if (!taskMatch) continue;

    const prefix = taskMatch.prefix; // "TASK" or "BUG"
    const num = taskMatch.num;
    const taskId = `${prefix}-${num}`;

    if (taskId !== id) continue;

    // Found the heading.
    const headingLineIndex = i;
    const lane = laneIndex[i];
    const status = currentStatus ?? "Unknown";

    // Collect block lines (heading + everything up to the next heading).
    const blockLines: string[] = [line];
    let j = i + 1;
    while (j < lines.length && !STRUCTURAL_BOUNDARY_RE.test(lines[j])) {
      blockLines.push(lines[j]);
      j++;
    }

    // Trim trailing blank lines from the block so that re-insertion doesn't
    // add extra whitespace accumulation. Trimming from the END only.
    while (blockLines.length > 1 && blockLines[blockLines.length - 1].trim() === "") {
      blockLines.pop();
    }

    return {
      found: true,
      lane,
      status,
      headingLineIndex,
      blockLines,
    };
  }

  return { found: false };
}

// ── getTaskDetail ─────────────────────────────────────────────────────────────

/**
 * Return full detail for `id`: id, title, lane, status, and body lines.
 * Body lines are everything after the heading line (without the heading itself).
 * Returns `null` if the task is not found.
 */
export function getTaskDetail(content: string, id: string): TaskDetail | null {
  const lines = content.split(/\r?\n/);
  const laneIndex = buildLaneIndex(lines);

  let currentStatus: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const statusMatch = STATUS_HEADING_RE.exec(line);
    if (statusMatch) {
      currentStatus = normaliseStatus(statusMatch[1]);
      continue;
    }

    const taskMatch = matchTaskHeading(line);
    if (!taskMatch) continue;

    const prefix = taskMatch.prefix;
    const num = taskMatch.num;
    const title = taskMatch.title;
    const taskId = `${prefix}-${num}`;

    if (taskId !== id) continue;

    const lane = laneIndex[i];
    const status = currentStatus ?? "Unknown";

    // Body lines: everything until the next heading. The archived marker is
    // detected here and NOT surfaced as a body line (it's metadata, not content).
    const body: string[] = [];
    let archived = false;
    let j = i + 1;
    while (j < lines.length && !STRUCTURAL_BOUNDARY_RE.test(lines[j])) {
      if (ARCHIVED_MARKER_RE.test(lines[j])) archived = true;
      else body.push(lines[j]);
      j++;
    }
    // Trim trailing blank lines from body.
    while (body.length > 0 && body[body.length - 1].trim() === "") {
      body.pop();
    }

    return { id, title, lane, status, body, archived };
  }

  return null;
}

// ── moveTaskStatus ────────────────────────────────────────────────────────────

/**
 * Surgically move the `#### [<id>]` block from its current `### <status>`
 * section to the `### <targetStatus>` section within the SAME lane.
 *
 * Rules:
 *   - The task's current lane is determined by the heading's position in the file
 *     (which ## heading precedes it).
 *   - If `lane` is supplied it must match the found task's lane (for robustness;
 *     callers can pass undefined to use the auto-detected lane).
 *   - The target `### <targetStatus>` section must already exist in the task's
 *     lane (no section creation in v1) — else returns `{ ok:false, code:'target_missing' }`.
 *   - If the task is already in `targetStatus` (idempotent), returns
 *     `{ ok:true, content }` with the content unchanged.
 *   - `'ambiguous'` is returned if the same id appears more than once.
 *
 * Every byte outside the moved block is preserved verbatim.
 */
export function moveTaskStatus(
  content: string,
  id: string,
  targetStatus: string,
  lane?: "feature" | "bug"
): MoveResult {
  const lines = content.split(/\r?\n/);
  const laneIndex = buildLaneIndex(lines);

  // ── Step 1: Find the task heading (detect ambiguity) ─────────────────────
  // We only need the line index and lane here; status is re-derived below
  // (scoped to the task's lane) to avoid ambiguity with cross-lane headings.
  let foundIndex = -1;
  let taskLane: Lane | null = null;
  let ambiguous = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const taskMatch = matchTaskHeading(line);
    if (!taskMatch) continue;

    const prefix = taskMatch.prefix;
    const num = taskMatch.num;
    const taskId = `${prefix}-${num}`;

    if (taskId !== id) continue;

    if (foundIndex !== -1) {
      ambiguous = true;
      break;
    }

    foundIndex = i;
    taskLane = laneIndex[i];
  }

  if (ambiguous) return { ok: false, code: "ambiguous" };
  if (foundIndex === -1) return { ok: false, code: "not_found" };

  // Determine the effective lane.
  const effectiveLane: Lane = lane ?? taskLane ?? laneFromId(id);

  // Re-derive the status at the found heading by re-scanning up to foundIndex.
  let statusAtFound: string | null = null;
  for (let i = 0; i < foundIndex; i++) {
    const m = STATUS_HEADING_RE.exec(lines[i]);
    if (m) {
      // Only update when this status heading is in the same lane.
      if (laneIndex[i] === effectiveLane) {
        statusAtFound = normaliseStatus(m[1]);
      }
    }
  }

  const currentStatusOfTask = statusAtFound ?? "Unknown";

  // ── Step 2: Idempotent check ──────────────────────────────────────────────
  if (currentStatusOfTask === targetStatus) {
    return { ok: true, content };
  }

  // ── Step 3: Identify the task block ───────────────────────────────────────
  // Block = heading + body lines, trailing blanks stripped.
  const blockLines: string[] = [lines[foundIndex]];
  let blockEnd = foundIndex + 1; // exclusive
  while (blockEnd < lines.length && !STRUCTURAL_BOUNDARY_RE.test(lines[blockEnd])) {
    blockLines.push(lines[blockEnd]);
    blockEnd++;
  }
  // Trim trailing blank lines from block.
  while (blockLines.length > 1 && blockLines[blockLines.length - 1].trim() === "") {
    blockLines.pop();
  }
  const trimmedBlockEnd = foundIndex + blockLines.length; // exclusive, after trimming

  // ── Step 4: Find the target `### <targetStatus>` section in the task's lane ─
  // We look for a status heading whose normalised text matches targetStatus AND
  // whose position is within the task's lane.
  let targetSectionIndex = -1;
  {
    let scanningLane: Lane = "feature";
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (FEATURE_LANE_RE.test(line)) { scanningLane = "feature"; continue; }
      if (BUG_LANE_RE.test(line)) { scanningLane = "bug"; continue; }
      if (scanningLane !== effectiveLane) continue;

      const m = STATUS_HEADING_RE.exec(line);
      if (!m) continue;
      if (normaliseStatus(m[1]) === targetStatus) {
        targetSectionIndex = i;
        break;
      }
    }
  }

  if (targetSectionIndex === -1) return { ok: false, code: "target_missing" };

  // ── Step 5: Find the insertion point (end of the target section) ───────────
  // Insertion point = just before the next `##`, `###`, or `####` heading
  // AFTER the target section heading, or end-of-file.
  let insertAt = targetSectionIndex + 1;
  while (insertAt < lines.length && !STRUCTURAL_BOUNDARY_RE.test(lines[insertAt])) {
    insertAt++;
  }
  // insertAt now points to the first line of the next section (or EOF).
  // We want to insert the block BEFORE that line, after trimming trailing blanks
  // from the section so we add a consistent single blank line separator.

  // ── Step 6: Build the new content ─────────────────────────────────────────
  //
  // Strategy:
  //   a) Remove the block from its current position (foundIndex..trimmedBlockEnd-1).
  //      Also remove ONE blank line that immediately precedes the block (the
  //      "separator blank" between the previous item / section text and this block).
  //   b) Insert the block (with a leading blank line) at the end of the target
  //      section, adjusting the insertAt index for the lines already removed.
  //
  // This keeps blank-line separators consistent without reformatting anything else.

  // Calculate the removal range [removeStart, removeEnd) (exclusive).
  let removeStart = foundIndex;
  // Include one preceding blank line in the removal (inter-block separator).
  if (removeStart > 0 && lines[removeStart - 1].trim() === "") {
    removeStart--;
  }
  const removeEnd = trimmedBlockEnd;

  // Remove the block from the line array.
  const afterRemoval = [
    ...lines.slice(0, removeStart),
    ...lines.slice(removeEnd),
  ];

  // Adjust insertAt for the removal (if the removal was before insertAt).
  const removedCount = removeEnd - removeStart;
  const adjustedInsertAt = insertAt > removeStart
    ? insertAt - removedCount
    : insertAt;

  // Find where the target section ends in afterRemoval (may have shifted).
  // Walk from adjustedInsertAt back 1 to find the actual end of the section
  // content (i.e. the last non-blank line before the next heading, or the
  // target heading itself if the section is empty).
  let sectionContentEnd = adjustedInsertAt;
  // Trim trailing blanks from section to avoid double-blank insertion.
  while (
    sectionContentEnd > 0 &&
    afterRemoval[sectionContentEnd - 1]?.trim() === ""
  ) {
    sectionContentEnd--;
  }

  // Splice in: <existing lines up to sectionContentEnd>, blank line, block lines, rest.
  const result = [
    ...afterRemoval.slice(0, sectionContentEnd),
    "",
    ...blockLines,
    ...afterRemoval.slice(sectionContentEnd),
  ];

  // Re-join preserving the original line endings.
  // The input was split on /\r?\n/; we normalise to \n (no CRLF in these files).
  return { ok: true, content: result.join("\n") };
}

// ── setTaskArchived ─────────────────────────────────────────────────────────────

/**
 * Add or remove the archived marker for `id` by inserting/removing an
 * `<!-- archived -->` line immediately after the task's heading. Every other
 * byte is preserved. Idempotent: archiving an already-archived task (or
 * unarchiving a non-archived one) returns the content unchanged.
 *
 * Returns `{ ok:false, code:'not_found' }` / `'ambiguous'` like moveTaskStatus.
 * (No 'target_missing' — there is no target section.)
 */
export function setTaskArchived(
  content: string,
  id: string,
  archived: boolean
): MoveResult {
  const lines = content.split(/\r?\n/);

  // Find the (unique) heading.
  let foundIndex = -1;
  let ambiguous = false;
  for (let i = 0; i < lines.length; i++) {
    const m = matchTaskHeading(lines[i]);
    if (!m) continue;
    if (`${m.prefix}-${m.num}` !== id) continue;
    if (foundIndex !== -1) {
      ambiguous = true;
      break;
    }
    foundIndex = i;
  }

  if (ambiguous) return { ok: false, code: "ambiguous" };
  if (foundIndex === -1) return { ok: false, code: "not_found" };

  // Find the block extent and any existing marker within it.
  let blockEnd = foundIndex + 1; // exclusive
  let markerIndex = -1;
  while (blockEnd < lines.length && !STRUCTURAL_BOUNDARY_RE.test(lines[blockEnd])) {
    if (markerIndex === -1 && ARCHIVED_MARKER_RE.test(lines[blockEnd])) {
      markerIndex = blockEnd;
    }
    blockEnd++;
  }
  const hasMarker = markerIndex !== -1;

  if (archived) {
    if (hasMarker) return { ok: true, content }; // idempotent
    const next = [
      ...lines.slice(0, foundIndex + 1),
      ARCHIVED_MARKER_LINE,
      ...lines.slice(foundIndex + 1),
    ];
    return { ok: true, content: next.join("\n") };
  }

  // archived === false → remove the marker if present.
  if (!hasMarker) return { ok: true, content }; // idempotent
  const next = [...lines.slice(0, markerIndex), ...lines.slice(markerIndex + 1)];
  return { ok: true, content: next.join("\n") };
}

// ── createBug ─────────────────────────────────────────────────────────────────

const NONE_PLACEHOLDER_RE = /^_\(none\)_$/;

export interface CreateBugInput {
  /** Short bug title (e.g. the use-case title that failed). */
  title: string;
  /** P0–P3; defaults to P2. */
  severity?: "P0" | "P1" | "P2" | "P3";
  /** The story this bug was flagged from (TASK-XXX), if any. */
  sourceTask?: string;
  /** The use-case (verify item) id that failed, if any. */
  sourceItem?: string;
  /** The retest round at the time of flagging. */
  round?: number;
  /** The author's note / symptom. */
  note?: string;
  /** ISO date (YYYY-MM-DD). The caller supplies it (server uses new Date()). */
  date: string;
}

export type CreateBugResult =
  | { ok: true; content: string; bugId: string }
  | { ok: false; code: "no_reported_section" };

/** The next BUG-NNN id: (max existing BUG number + 1), zero-padded to 3. */
export function nextBugId(content: string): string {
  const lines = content.split(/\r?\n/);
  let max = 0;
  for (const line of lines) {
    const m = matchTaskHeading(line);
    if (m && m.prefix === "BUG") {
      const n = parseInt(m.num, 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return `BUG-${String(max + 1).padStart(3, "0")}`;
}

/**
 * Append a new bug to the Bug-Fix lane's `### Reported` section. Pure (no I/O).
 * Returns the new content + the assigned id. A lone `_(none)_` placeholder in
 * the Reported section is replaced; otherwise the bug is appended after the
 * existing entries. Every byte outside the Reported section is preserved.
 */
export function createBug(content: string, input: CreateBugInput): CreateBugResult {
  const bugId = nextBugId(content);
  const severity = input.severity ?? "P2";
  const title = input.title.trim() || "Bug flagged in verification";

  const sourceLine = input.sourceTask
    ? `- **Source:** ${input.sourceTask} verification${input.sourceItem ? ` · use-case \`${input.sourceItem}\`` : ""}${input.round ? ` (round ${input.round})` : ""}`
    : `- **Source:** flagged in the Console (Verify)`;

  // Preserve the board's on-disk ID style (CHANNEL [11]): bracketed if the board
  // uses brackets anywhere, else the framework's bare house style.
  const heading = usesBracketedIds(content)
    ? `#### [${bugId}] ${title} — Reported ${input.date}`
    : `#### ${bugId} ${title} — Reported ${input.date}`;

  const block: string[] = [
    heading,
    `- **Severity:** ${severity}`,
    sourceLine,
    `- **Reported:** ${input.date} by the author (flagged in Verify)`,
  ];
  if (input.note && input.note.trim()) {
    block.push(`- **Symptom:** ${input.note.trim()}`);
  }

  // Locate the bug lane's "### Reported" section.
  const lines = content.split(/\r?\n/);
  let scanningLane: Lane = "feature";
  let reportedIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (FEATURE_LANE_RE.test(line)) { scanningLane = "feature"; continue; }
    if (BUG_LANE_RE.test(line)) { scanningLane = "bug"; continue; }
    if (scanningLane !== "bug") continue;
    const m = STATUS_HEADING_RE.exec(line);
    if (m && normaliseStatus(m[1]) === "Reported") { reportedIndex = i; break; }
  }
  if (reportedIndex === -1) return { ok: false, code: "no_reported_section" };

  // Section extent up to the next structural boundary.
  let sectionEnd = reportedIndex + 1;
  while (sectionEnd < lines.length && !STRUCTURAL_BOUNDARY_RE.test(lines[sectionEnd])) {
    sectionEnd++;
  }

  const sectionBody = lines.slice(reportedIndex + 1, sectionEnd);
  const onlyPlaceholder = sectionBody.every(
    (l) => l.trim() === "" || NONE_PLACEHOLDER_RE.test(l.trim())
  );

  let result: string[];
  if (onlyPlaceholder) {
    // Replace the placeholder body with the bug block.
    result = [
      ...lines.slice(0, reportedIndex + 1),
      "",
      ...block,
      "",
      ...lines.slice(sectionEnd),
    ];
  } else {
    // Append after the existing entries (trim trailing blanks first).
    let contentEnd = sectionEnd;
    while (contentEnd > reportedIndex + 1 && lines[contentEnd - 1].trim() === "") {
      contentEnd--;
    }
    result = [
      ...lines.slice(0, contentEnd),
      "",
      ...block,
      ...lines.slice(contentEnd),
    ];
  }

  return { ok: true, content: result.join("\n"), bugId };
}
