/**
 * io.ts — Read/write pass-files from .claude/console/verify/.
 *
 * The server is the sole Console-side writer of verify files (DEC-002,
 * contract:console-state-sources) — the agent and Tester also write these
 * files directly (agent_docs/verify-handback.md) and are uncoordinated,
 * coordinate writers (M4). All writes go through resolveVerifyPath() for
 * path-safety, and writeVerifyFile() accepts an optional expected write token
 * (mtime + content hash, see its doc comment) as a lightweight
 * optimistic-concurrency guard.
 *
 * Exports:
 *   listVerifyRefs()         → VerifyRef[]                    — all verify files as queue entries (read-only, M5)
 *   readVerifyFile(id)       → VerifyFile                      — parsed + validated single file (read-only, M5)
 *   readVerifyFileWithMeta() → {file, mtimeMs, contentHash}    — same, + the token callers need for a later conflict-checked write
 *   writeVerifyFile(file, expected?) → result                 — sole write path; validates before write
 */

import { readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { dotClaudePath } from "../project-root.js";
import { resolveVerifyPath } from "../security.js";
import { assertVerifyFile, validateVerifyFile, normalizeItem, normalizeLegacyVerdicts } from "./schema.js";
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
 * The set of task/bug ids (either lane) currently in a "Done" column of
 * TASKS.md. Used to filter the Verify queue: once the board says a task is
 * Done, it's no longer "awaiting human verification" — listVerifyRefs drops
 * it. Reads TASKS.md fresh; degrades to empty (no filtering) on error, so a
 * missing/unreadable board never hides the queue.
 */
function doneTaskIds(): Set<string> {
  const ids = new Set<string>();
  try {
    const board = parseTasksFile(dotClaudePath("TASKS.md"));
    for (const col of board.columns) {
      if (col.status.toLowerCase() === "done") {
        for (const item of col.items) ids.add(item.id);
      }
    }
  } catch {
    // TASKS.md unreadable — no filtering. Graceful.
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
 *
 * Side-effect-free (M5): this is a GET-reachable read path, so it must never
 * write to disk (previously the retest-loop reconcile below persisted here on
 * every list — a GET silently mutating state). The reconciled view is
 * computed and returned for display; it is durably persisted the next time
 * that task's verify file is written via the write-guarded PUT endpoint
 * (verify-routes.ts), which already round-trips through readVerifyFile.
 *
 * A file that fails validation or can't be read is NOT silently dropped
 * (M5-minor) — it is surfaced as an `invalid` entry (by filename) so it
 * doesn't vanish from the human's queue without a visible trace.
 *
 * Queue filter: the Verify tab means "awaiting human verification" — a
 * task/bug whose board status in TASKS.md is already Done is filtered out
 * entirely (not even as an `invalid` entry), regardless of what its pass-file
 * says. This runs BEFORE the per-file try/read so a Done task costs nothing
 * beyond the id check.
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
  const doneOnBoard = doneTaskIds();
  const titles = taskTitleById();

  for (const filename of entries) {
    const filePath = resolve(dir, filename);
    const taskFromFilename = filename.replace(/\.json$/i, "");

    // Already Done on the board → not part of the "awaiting verification" queue.
    if (doneOnBoard.has(taskFromFilename)) continue;

    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed: unknown = normalizeLegacyVerdicts(JSON.parse(raw));

      const { valid, errors } = validateVerifyFile(parsed);
      if (!valid) {
        console.warn(`[console] Invalid verify file ${filename}: ${errors.join("; ")}`);
        refs.push({
          task: taskFromFilename,
          title: titles.get(taskFromFilename) ?? taskFromFilename,
          counts: {},
          invalid: true,
          invalidReason: errors[0] ?? "schema validation failed",
        });
        continue;
      }

      const file = parsed as import("./schema.js").VerifyFile;
      // Retest-loop reconcile view (NOT persisted here — see doc comment above).
      const { file: reconciled } = applyBugFixes(file, done);
      const counts = computeRollup(reconciled.items);

      // Title: the real feature name from TASKS.md, falling back to the id when
      // the task isn't on the board (the pass-file carries no title itself).
      const title = titles.get(reconciled.task) ?? reconciled.task;

      refs.push({ task: reconciled.task, title, counts });
    } catch (err) {
      console.warn(`[console] Unreadable verify file ${filename}: ${String(err)}`);
      refs.push({
        task: taskFromFilename,
        title: titles.get(taskFromFilename) ?? taskFromFilename,
        counts: {},
        invalid: true,
        invalidReason: `unreadable: ${String(err)}`,
      });
    }
  }

  return refs;
}

// ── Read single ────────────────────────────────────────────────────────────────

/** SHA-256 of the raw file content — the authoritative half of the M4 write token. */
function contentHashOf(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** The optimistic-concurrency token captured at read time (M4). */
export interface VerifyWriteToken {
  mtimeMs: number;
  contentHash: string;
}

/** A VerifyFile plus the write token at read time (M4 optimistic-concurrency baseline). */
export interface VerifyFileWithMeta extends VerifyWriteToken {
  file: VerifyFile;
}

/**
 * Read and validate a single verify file, returning the reconciled view PLUS
 * the write token (on-disk mtime + raw content hash) captured at read time.
 * Use this (not readVerifyFile) when the caller intends to write back later —
 * pass the token to writeVerifyFile's `expected` to get the M4 conflict check.
 *
 * Throws if the task id is invalid, the file doesn't exist, or it fails validation.
 *
 * Side-effect-free (M5): does NOT persist the retest-loop reconcile — this is
 * a GET-reachable read path (verify-routes.ts). The reconciled shape returned
 * here is durably written the next time the PUT endpoint saves this task
 * (which reads via this function, then calls writeVerifyFile with the patch
 * applied on top) — see verify-routes.ts.
 */
export function readVerifyFileWithMeta(taskId: string): VerifyFileWithMeta {
  // Path-safety: resolveVerifyPath validates the id and resolves inside the allowed dir.
  const filePath = resolveVerifyPath(taskId);

  if (!existsSync(filePath)) {
    throw Object.assign(new Error(`Verify file not found for task ${taskId}`), {
      code: "ENOENT",
    });
  }

  const mtimeMs = statSync(filePath).mtimeMs;
  const raw = readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Verify file for ${taskId} is not valid JSON: ${String(err)}`);
  }
  // Legacy wire-format alias: existing on-disk files may still carry the
  // retired verdict name `warn` — normalize to `cr` before validating.
  parsed = normalizeLegacyVerdicts(parsed);

  // assertVerifyFile throws with a descriptive error if validation fails.
  const file = assertVerifyFile(parsed);

  // Retest-loop reconcile (+ normalise to the current shape) for THIS caller's
  // view only — NOT persisted here (see doc comment above): a use case whose
  // flagged bug is now Done in TASKS.md flips back to pending with a new notes
  // round. applyBugFixes normalises every item, so the returned file always
  // carries round/noteRounds.
  const { file: reconciled } = applyBugFixes(file, doneBugIds());
  return { file: reconciled, mtimeMs, contentHash: contentHashOf(raw) };
}

/**
 * Read and validate a single verify file (reconciled view only, no mtime).
 * Throws if the task id is invalid, the file doesn't exist, or it fails validation.
 * Side-effect-free (M5) — see readVerifyFileWithMeta.
 */
export function readVerifyFile(taskId: string): VerifyFile {
  return readVerifyFileWithMeta(taskId).file;
}

// ── Write ─────────────────────────────────────────────────────────────────────

export type WriteVerifyResult = { ok: true } | { ok: false; code: "conflict" };

/**
 * Write a VerifyFile to disk atomically (temp file + renameSync).
 *
 * The server is the sole Console-side writer; the agent and Tester also write
 * verify files directly and are uncoordinated, coordinate writers (M4). When
 * `expected` (mtime + content hash from readVerifyFileWithMeta) is supplied,
 * this re-checks the target immediately before the rename and returns
 * `{ok:false, code:'conflict'}` instead of overwriting if the file changed
 * since that read — a lightweight guard, not a lock (heavy file locking was
 * explicitly rejected as over-engineering for a single-user tool — FIX-PLAN
 * M4). The check is two-stage: a differing mtime is a cheap reject without
 * reading the file, but an EQUAL mtime is not proof of no interleaved write —
 * NTFS mtime resolution is coarse enough that ~2% of back-to-back writes land
 * on an identical mtimeMs (measured on this class of host) — so the content
 * hash is the authoritative check for that sub-tick window. Callers that
 * don't care about concurrency (e.g. first-write bootstrap, tests) may omit
 * `expected` and the check is skipped.
 *
 * Validates the file before writing — rejects invalid data at the write gate
 * (thrown, not returned — a schema violation is a programming error, not a
 * recoverable conflict).
 * Uses resolveVerifyPath for path-safety (validates task id, resolves inside dir).
 *
 * Atomic strategy: write to a temp file in the same directory, then rename.
 * On POSIX this is a kernel-atomic rename; on Windows, renameSync replaces
 * atomically when src and dst are on the same volume (which they always are here).
 */
export function writeVerifyFile(file: VerifyFile, expected?: VerifyWriteToken): WriteVerifyResult {
  // Validate before touching disk.
  const { valid, errors } = validateVerifyFile(file);
  if (!valid) {
    throw new Error(`Refusing to write invalid verify file:\n  ${errors.join("\n  ")}`);
  }

  const filePath = resolveVerifyPath(file.task);
  const dir = dirname(filePath);

  if (expected !== undefined) {
    try {
      if (statSync(filePath).mtimeMs !== expected.mtimeMs) {
        return { ok: false, code: "conflict" };
      }
      if (contentHashOf(readFileSync(filePath, "utf8")) !== expected.contentHash) {
        // Sub-tick interleaved write: mtime unchanged but content moved.
        return { ok: false, code: "conflict" };
      }
    } catch {
      // Vanished since our read — also a conflict (nothing safe to overwrite).
      return { ok: false, code: "conflict" };
    }
  }

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
  return { ok: true };
}

// ── Apply VerdictPatch[] ──────────────────────────────────────────────────────

import type { VerdictPatch } from "../types.js";
import { validateVerdictPatch, aliasLegacyVerdictPatch } from "./schema.js";

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
  // Legacy wire-format alias: defends against a stale cached client (or an
  // external caller) still sending the retired verdict name `warn`. Applied
  // BEFORE validation so the same (aliased) object is what gets applied below.
  const aliasedPatches = patches.map((p) => aliasLegacyVerdictPatch(p));

  // Validate all patches before applying any — fail fast.
  for (let i = 0; i < aliasedPatches.length; i++) {
    const err = validateVerdictPatch(aliasedPatches[i], i);
    if (err !== null) {
      throw new Error(`Invalid patch: ${err}`);
    }
  }

  // Build patch lookup by id.
  const patchById = new Map<string, VerdictPatch>();
  for (const p of aliasedPatches) {
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
        : // On verdict change away from fail/cr, clear severity.
          (verdict === "fail" || verdict === "cr" ? item.severity ?? null : null);

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
