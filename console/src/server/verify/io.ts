/**
 * io.ts — Read/write pass-files from .claude/console/verify/.
 *
 * The server is the SOLE WRITER of verify files (DEC-002, contract:console-state-sources).
 * All writes go through resolveVerifyPath() for path-safety.
 *
 * Exports:
 *   listVerifyRefs()   → VerifyRef[]   — all verify files as queue entries
 *   readVerifyFile(id) → VerifyFile    — parsed + validated single file
 *   writeVerifyFile(file) → void       — sole write path; validates before write
 */

import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { dotClaudePath } from "../project-root.js";
import { resolveVerifyPath } from "../security.js";
import { assertVerifyFile, validateVerifyFile, normalizeItem } from "./schema.js";
import { computeRollup, applyBugFixes } from "./reconcile.js";
import { parseTasksFile } from "../parsers/tasks-parser.js";
import type { VerifyRef } from "../types.js";
import type { VerifyFile, VerifyItem, Verdict, Severity } from "./schema.js";

/**
 * The set of BUG-ids currently in the Bug-Fix lane's Done column. Used by the
 * retest-loop reconcile: when a flagged bug reaches Done, its use case flips
 * back to pending. Reads TASKS.md fresh; degrades to empty (no resets) on error.
 */
function doneBugIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const board = parseTasksFile(dotClaudePath("TASKS.md"));
    for (const col of board.columns) {
      if (col.lane === "bug" && col.status.toLowerCase() === "done") {
        for (const item of col.items) ids.add(item.id);
      }
    }
  } catch {
    // TASKS.md unreadable — no done bugs → no resets. Graceful.
  }
  return ids;
}

/**
 * Map every task/bug id → its title from TASKS.md, so the verify queue can show
 * the real FEATURE name (e.g. "/names/[slug] public name pages (FEAT-01)")
 * instead of the bare id. The pass-file carries no title of its own, and on a
 * real consumer board (20+ seeds) a column of bare ids is unreadable. Uses the
 * parser's title verbatim (NOT the dashboard's lossy em-dash split, which would
 * truncate titles that legitimately contain " — "). Degrades to an empty map
 * (→ id fallback) if TASKS.md is unreadable.
 */
function taskTitleById(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const board = parseTasksFile(dotClaudePath("TASKS.md"));
    for (const col of board.columns) {
      for (const item of col.items) {
        const t = item.title.trim();
        if (t) map.set(item.id, t);
      }
    }
  } catch {
    // TASKS.md unreadable — fall back to ids. Graceful.
  }
  return map;
}

// Re-export for convenience.
export type { VerifyRef, VerifyFile };

// ── Directory helpers ─────────────────────────────────────────────────────────

/** Absolute path to .claude/console/verify/. */
function verifyDir(): string {
  return resolve(dotClaudePath("console", "verify"));
}

/**
 * Ensure the verify directory exists. Called lazily on first access.
 * Degrades gracefully: if it can't be created, an error surfaces at read time.
 */
function ensureVerifyDir(): void {
  const dir = verifyDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ── List ──────────────────────────────────────────────────────────────────────

/**
 * List all verify files as VerifyRef[] (counts by verdict).
 * Files that fail validation are skipped with a console.warn — the queue
 * should not break if one file is corrupt.
 */
export function listVerifyRefs(): VerifyRef[] {
  ensureVerifyDir();
  const dir = verifyDir();

  let entries: string[];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    // Directory unreadable — return empty queue rather than crashing.
    return [];
  }

  const refs: VerifyRef[] = [];
  const done = doneBugIds();
  const titles = taskTitleById();

  for (const filename of entries) {
    const filePath = resolve(dir, filename);
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed: unknown = JSON.parse(raw);

      const { valid, errors } = validateVerifyFile(parsed);
      if (!valid) {
        console.warn(`[console] Skipping invalid verify file ${filename}: ${errors.join("; ")}`);
        continue;
      }

      const file = parsed as import("./schema.js").VerifyFile;
      // Retest-loop reconcile: a use case whose flagged bug is now Done flips
      // back to pending (new round). Persist the change so the count is stable.
      const { file: reconciled, changed } = applyBugFixes(file, done);
      if (changed) writeVerifyFile(reconciled);
      const counts = computeRollup(reconciled.items);

      // Title: the real feature name from TASKS.md, falling back to the id when
      // the task isn't on the board (the pass-file carries no title itself).
      const title = titles.get(reconciled.task) ?? reconciled.task;

      refs.push({ task: reconciled.task, title, counts });
    } catch (err) {
      console.warn(`[console] Skipping unreadable verify file ${filename}: ${String(err)}`);
    }
  }

  return refs;
}

// ── Read single ────────────────────────────────────────────────────────────────

/**
 * Read and validate a single verify file.
 * Throws if the task id is invalid, the file doesn't exist, or it fails validation.
 */
export function readVerifyFile(taskId: string): VerifyFile {
  // Path-safety: resolveVerifyPath validates the id and resolves inside the allowed dir.
  const filePath = resolveVerifyPath(taskId);

  if (!existsSync(filePath)) {
    throw Object.assign(new Error(`Verify file not found for task ${taskId}`), {
      code: "ENOENT",
    });
  }

  const raw = readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Verify file for ${taskId} is not valid JSON: ${String(err)}`);
  }

  // assertVerifyFile throws with a descriptive error if validation fails.
  const file = assertVerifyFile(parsed);

  // Retest-loop reconcile (+ normalise to the current shape): a use case whose
  // flagged bug is now Done in TASKS.md flips back to pending with a new notes
  // round. Persist the change so the round bump survives. applyBugFixes
  // normalises every item, so the returned file always carries round/noteRounds.
  const { file: reconciled, changed } = applyBugFixes(file, doneBugIds());
  if (changed) writeVerifyFile(reconciled);
  return reconciled;
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Write a VerifyFile to disk atomically (temp file + renameSync).
 * The server is the sole writer; no optimistic locking needed for v1.
 *
 * Validates the file before writing — rejects invalid data at the write gate.
 * Uses resolveVerifyPath for path-safety (validates task id, resolves inside dir).
 *
 * Atomic strategy: write to a temp file in the same directory, then rename.
 * On POSIX this is a kernel-atomic rename; on Windows, renameSync replaces
 * atomically when src and dst are on the same volume (which they always are here).
 */
export function writeVerifyFile(file: VerifyFile): void {
  // Validate before touching disk.
  const { valid, errors } = validateVerifyFile(file);
  if (!valid) {
    throw new Error(`Refusing to write invalid verify file:\n  ${errors.join("\n  ")}`);
  }

  const filePath = resolveVerifyPath(file.task);
  const dir = dirname(filePath);

  // Ensure the directory exists (handles first-write bootstrap).
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tempPath = join(dir, `${file.task}.tmp-${process.pid}.json`);
  try {
    writeFileSync(tempPath, JSON.stringify(file, null, 2) + "\n", "utf8");
    renameSync(tempPath, filePath);
  } catch (err) {
    // Best-effort cleanup of temp file on failure; ignore cleanup errors.
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup failure.
    }
    throw err;
  }
}

// ── Apply VerdictPatch[] ──────────────────────────────────────────────────────

import type { VerdictPatch } from "../types.js";
import { validateVerdictPatch } from "./schema.js";

/**
 * Apply a list of VerdictPatch entries to an existing VerifyFile.
 * Patches are applied by id. Items not mentioned in the patch list are
 * left unchanged. Unknown ids (not in the file) are ignored (no error —
 * the client may hold a stale item list).
 *
 * Returns the updated file (pure — does NOT write to disk).
 * Throws if any patch entry fails validation.
 */
export function applyPatches(file: VerifyFile, patches: VerdictPatch[]): VerifyFile {
  // Validate all patches before applying any — fail fast.
  for (let i = 0; i < patches.length; i++) {
    const err = validateVerdictPatch(patches[i], i);
    if (err !== null) {
      throw new Error(`Invalid patch: ${err}`);
    }
  }

  // Build patch lookup by id.
  const patchById = new Map<string, VerdictPatch>();
  for (const p of patches) {
    patchById.set(p.id, p);
  }

  const updatedItems = file.items.map((raw: VerifyItem) => {
    const patch = patchById.get(raw.id);
    // Normalise every item (touched or not) so the saved file is uniform —
    // legacy items gain round/noteRounds/bugId on first save.
    const item = normalizeItem(raw);
    if (patch === undefined) {
      return item;
    }

    const verdict = patch.verdict as Verdict;
    const severity =
      patch.severity !== undefined
        ? (patch.severity as Severity)
        : // On verdict change away from fail/warn, clear severity.
          (verdict === "fail" || verdict === "warn" ? item.severity ?? null : null);

    // bugId: an explicit value in the patch wins; a pass clears the link.
    let bugId = patch.bugId !== undefined ? patch.bugId : item.bugId ?? null;
    if (verdict === "pass") bugId = null;

    // The patch note updates the CURRENT round's note (prior rounds preserved).
    const noteRounds = (item.noteRounds ?? []).map((nr) =>
      nr.round === item.round && patch.notes !== undefined
        ? { ...nr, note: patch.notes }
        : nr
    );
    const currentNote = noteRounds[noteRounds.length - 1]?.note ?? "";

    return { ...item, verdict, severity, bugId, noteRounds, notes: currentNote };
  });

  return { ...file, items: updatedItems };
}
