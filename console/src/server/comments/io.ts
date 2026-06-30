/**
 * io.ts — Read/write comment sidecar files from .claude/console/comments/.
 *
 * The server is the SOLE WRITER of comment files (DEC-002, DEC-012,
 * contract:console-comments-file). All path resolution goes through
 * resolveCommentsPath() for path-safety.
 *
 * Design decisions:
 *   - readComments: returns an empty thread (no throw) when the file is absent.
 *     Throws only on genuinely corrupt JSON (caller maps to 500). Absent = empty
 *     thread is the right UX; corrupt = unexpected error that should surface.
 *   - appendComment: generates a UUID comment id (via crypto.randomUUID) and a
 *     server-generated ISO timestamp. Writes atomically (temp + rename via
 *     writeFileSync + renameSync).
 *   - statusAtComment is optional; if undefined it is omitted from the stored
 *     comment to keep the file clean (no undefined-valued keys).
 *
 * Exports:
 *   readComments(id)          → CommentThread (empty if file absent)
 *   appendComment(id, input)  → CommentThread (updated after append)
 *   resolveCommentsPath(id)   → absolute path (for testing + internal use)
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve, join, dirname, sep } from "node:path";
import { dotClaudePath } from "../project-root.js";

// ── Types (local — not exported from types.ts per task scope) ─────────────────

export interface Comment {
  id: string;
  author: string;
  ts: string;          // ISO timestamp, server-generated
  body: string;
  statusAtComment?: string;
}

export interface CommentThread {
  schemaVersion: 1;
  taskId: string;
  comments: Comment[];
}

export interface AppendInput {
  body: string;
  author?: string;
  statusAtComment?: string;
}

// ── Task id validation ────────────────────────────────────────────────────────

const TASK_ID_RE = /^(TASK|BUG)-[0-9]+$/;

/**
 * Validate a task id and resolve it to the safe comments-file path.
 *
 * Returns the absolute path to `.claude/console/comments/<taskId>.json` only if:
 *   1. taskId matches ^(TASK|BUG)-[0-9]+$
 *   2. The resolved path is strictly inside .claude/console/comments/
 *
 * Throws an Error with a human-readable message if either check fails.
 */
export function resolveCommentsPath(taskId: string): string {
  if (!TASK_ID_RE.test(taskId)) {
    throw new Error(
      `Invalid task id '${taskId}'. Must match (TASK|BUG)-[0-9]+.`
    );
  }

  const commentsDir = resolve(dotClaudePath("console", "comments"));
  const target = join(commentsDir, `${taskId}.json`);
  const resolved = resolve(target);

  // Confirm the resolved path stays inside commentsDir (no traversal).
  const safeBase = commentsDir.endsWith(sep) ? commentsDir : commentsDir + sep;
  if (!resolved.startsWith(safeBase) && resolved !== commentsDir) {
    throw new Error(`Path traversal detected for task id '${taskId}'.`);
  }

  return resolved;
}

// ── Directory helper ──────────────────────────────────────────────────────────

function ensureCommentsDir(): void {
  const dir = resolve(dotClaudePath("console", "comments"));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Read the comment thread for a task.
 *
 * - If the file is absent: returns an empty thread (graceful degradation).
 * - If the file exists but is corrupt JSON: throws (caller should map to 500).
 * - Validates the task id (throws on bad format).
 */
export function readComments(taskId: string): CommentThread {
  const filePath = resolveCommentsPath(taskId);

  if (!existsSync(filePath)) {
    // Absent = empty thread (no file yet)
    return { schemaVersion: 1, taskId, comments: [] };
  }

  const raw = readFileSync(filePath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Comments file for ${taskId} is not valid JSON: ${String(err)}`
    );
  }

  // Trust the on-disk shape (we wrote it; validate just the top-level contract).
  const obj = parsed as Record<string, unknown>;
  if (
    obj.schemaVersion !== 1 ||
    obj.taskId !== taskId ||
    !Array.isArray(obj.comments)
  ) {
    throw new Error(
      `Comments file for ${taskId} has an unexpected shape (schemaVersion/taskId/comments).`
    );
  }

  return parsed as CommentThread;
}

// ── Append ────────────────────────────────────────────────────────────────────

/**
 * Append a comment to the thread for a task.
 *
 * - Validates the task id (throws on bad format).
 * - Validates body is non-empty (throws with a descriptive message + code EMPTY_BODY).
 * - Generates a sequential id ("c-1", "c-2", ...) and ISO timestamp.
 * - Ensures the comments directory exists.
 * - Writes atomically: write to a temp file, then rename to the final path.
 * - Returns the updated thread.
 */
export function appendComment(taskId: string, input: AppendInput): CommentThread {
  // Validate input first (before any disk I/O).
  if (!input.body || input.body.trim().length === 0) {
    throw Object.assign(
      new Error("Comment body must not be empty."),
      { code: "EMPTY_BODY" }
    );
  }

  // resolveCommentsPath validates the task id.
  const filePath = resolveCommentsPath(taskId);

  ensureCommentsDir();

  // Read existing thread (or start fresh).
  const thread = readComments(taskId);

  // Generate a collision-proof id using randomUUID (sequential c-N ids collide
  // under concurrent appends or on a repaired file).
  const commentId = randomUUID();

  // Build the new comment object.
  const newComment: Comment = {
    id: commentId,
    author: input.author ?? "human",
    ts: new Date().toISOString(),
    body: input.body,
  };

  // Only include statusAtComment if provided.
  if (input.statusAtComment !== undefined) {
    newComment.statusAtComment = input.statusAtComment;
  }

  const updatedThread: CommentThread = {
    ...thread,
    comments: [...thread.comments, newComment],
  };

  // Atomic write: write to a temp file then rename to the final path.
  const dir = dirname(filePath);
  const tempPath = join(dir, `${taskId}.tmp.${process.pid}.json`);
  try {
    writeFileSync(tempPath, JSON.stringify(updatedThread, null, 2) + "\n", "utf8");
    renameSync(tempPath, filePath);
  } catch (err) {
    // Clean up temp file on failure (best-effort; ignore cleanup errors).
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup failure.
    }
    throw err;
  }

  return updatedThread;
}
