/**
 * tasks-write-routes.ts — Fastify plugin for task write-back + card detail (TASK-010).
 *
 * Registers:
 *   GET /api/tasks/:id          → TaskDetail + comments count (read; no guard)
 *   PUT /api/tasks/:id/status   → surgical block move in TASKS.md (write-guarded)
 *
 * Plugin design mirrors verify-routes.ts:
 *   - writeGuard is injected from server.ts so security config stays in one place.
 *   - TASKS.md is read fresh on every request (no-state-projection, DEC-002).
 *   - Writes are atomic: temp-file + rename pattern (writeFileSync on the same FS
 *     is atomic on POSIX; on Windows we write to a temp path then rename).
 *
 * contract:console-task-writeback
 */

import type { FastifyInstance, FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { dotClaudePath } from "../project-root.js";
import { parseTasksMd } from "../parsers/tasks-parser.js";
import { getTaskDetail, moveTaskStatus, setTaskArchived, createBug, TASK_ID_RE } from "../tasks/writeback.js";
import type { TaskBoard } from "../types.js";
import type { Lane } from "../types.js";

// ── Local types (not in types.ts per task brief) ─────────────────────────────

interface TaskDetailReply {
  id: string;
  title: string;
  lane: Lane;
  status: string;
  body: string[];
  comments: number;
  archived: boolean;
}

interface TaskArchivedBody {
  archived: boolean;
}

interface TaskStatusBody {
  status: string;
  lane?: "feature" | "bug";
}

interface TaskStatusReply {
  ok: true;
  board: TaskBoard;
}

interface CreateBugBody {
  title: string;
  severity?: "P0" | "P1" | "P2" | "P3";
  sourceTask?: string;
  sourceItem?: string;
  round?: number;
  note?: string;
}

// ── Options ───────────────────────────────────────────────────────────────────

export interface TasksWriteRoutesOptions {
  /** The write-guard preHandler from server.ts (token + origin check). */
  writeGuard: preHandlerHookHandler;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Absolute path to the canonical TASKS.md. */
function tasksFilePath(): string {
  return dotClaudePath("TASKS.md");
}

/**
 * Read TASKS.md content. Returns null if the file does not exist (graceful
 * empty-state per the project-specific note in CLAUDE.md).
 */
function readTasksContent(): string | null {
  const p = tasksFilePath();
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

/**
 * Atomic write: write to a temp file in the same directory, then rename.
 * On Windows, renameSync replaces atomically when src and dst are on the
 * same volume (which they always are here).
 */
function atomicWriteTasksMd(content: string): void {
  const target = tasksFilePath();
  const tmp = target + ".tmp-" + process.pid;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, target);
}

/**
 * Read the comments count for a task from its sidecar file.
 * Tolerant: returns 0 on any error (missing file, parse error, etc.).
 * Does NOT hard-depend on the comments module (built by a sibling agent).
 */
function readCommentsCount(taskId: string): number {
  try {
    const commentsPath = dotClaudePath("console", "comments", `${taskId}.json`);
    if (!existsSync(commentsPath)) return 0;
    const raw = readFileSync(commentsPath, "utf8");
    const parsed = JSON.parse(raw) as { comments?: unknown[] };
    if (Array.isArray(parsed.comments)) return parsed.comments.length;
    return 0;
  } catch {
    return 0;
  }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

/**
 * Fastify plugin that registers task write-back endpoints.
 *
 * Wire into server.ts:
 *   import { tasksWriteRoutes } from "./routes/tasks-write-routes.js";
 *   await fastify.register(tasksWriteRoutes, { writeGuard });
 */
export const tasksWriteRoutes: FastifyPluginAsync<TasksWriteRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: TasksWriteRoutesOptions
) => {
  const { writeGuard } = opts;

  // ── GET /api/tasks/:id — card detail ────────────────────────────────────────
  fastify.get<{
    Params: { id: string };
    Reply: TaskDetailReply | { error: string };
  }>("/api/tasks/:id", async (req, reply) => {
    const { id } = req.params;

    if (!TASK_ID_RE.test(id)) {
      void reply.code(400).send({ error: `Invalid task id '${id}'. Must match (TASK|BUG)-[0-9]+.` });
      return;
    }

    const content = readTasksContent();
    if (content === null) {
      void reply.code(404).send({ error: `TASKS.md not found` });
      return;
    }

    const detail = getTaskDetail(content, id);
    if (detail === null) {
      void reply.code(404).send({ error: `Task '${id}' not found` });
      return;
    }

    const comments = readCommentsCount(id);

    return {
      id: detail.id,
      title: detail.title,
      lane: detail.lane,
      status: detail.status,
      body: detail.body,
      comments,
      archived: detail.archived,
    };
  });

  // ── PUT /api/tasks/:id/status — surgical block move ──────────────────────────
  fastify.put<{
    Params: { id: string };
    Body: TaskStatusBody;
    Reply: TaskStatusReply | { error: string };
  }>(
    "/api/tasks/:id/status",
    { preHandler: [writeGuard] },
    async (req, reply) => {
      const { id } = req.params;

      // Validate id.
      if (!TASK_ID_RE.test(id)) {
        void reply.code(400).send({ error: `Invalid task id '${id}'. Must match (TASK|BUG)-[0-9]+.` });
        return;
      }

      // Validate body.
      const body = req.body;
      if (
        typeof body !== "object" ||
        body === null ||
        typeof body.status !== "string" ||
        body.status.trim() === ""
      ) {
        void reply.code(400).send({ error: "Request body must include { status: string, lane?: 'feature' | 'bug' }" });
        return;
      }
      if (
        body.lane !== undefined &&
        body.lane !== "feature" &&
        body.lane !== "bug"
      ) {
        void reply.code(400).send({ error: "lane must be 'feature' or 'bug' (or omitted)" });
        return;
      }

      // Normalise the caller-supplied status the same way section headings are
      // normalised in writeback.ts (strip trailing parenthetical group(s), trim)
      // so a display-label like "Todo (Priority Order)" matches a normalised heading.
      const targetStatus = body.status.trim().replace(/(\s*\([^)]*\))+\s*$/, "").trim();
      const requestedLane = body.lane;

      // Read TASKS.md.
      const content = readTasksContent();
      if (content === null) {
        void reply.code(404).send({ error: `TASKS.md not found` });
        return;
      }

      // Perform the surgical move.
      const result = moveTaskStatus(content, id, targetStatus, requestedLane);

      if (!result.ok) {
        // Map error codes → HTTP status.
        switch (result.code) {
          case "not_found":
            void reply.code(404).send({ error: `Task '${id}' not found in TASKS.md` });
            return;
          case "target_missing":
            void reply.code(409).send({
              error: `Target status '${targetStatus}' does not exist as a ### section in the task's lane. No write performed.`,
            });
            return;
          case "ambiguous":
            void reply.code(409).send({
              error: `Task '${id}' appears more than once in TASKS.md — shape is ambiguous. No write performed.`,
            });
            return;
        }
      }

      // Atomic write (idempotent no-op also lands here with unchanged content).
      atomicWriteTasksMd(result.content);

      // Re-parse and return the updated board.
      const board = parseTasksMd(result.content);
      return { ok: true, board };
    }
  );

  // ── PUT /api/tasks/:id/archived — set/clear the archived marker ──────────────
  fastify.put<{
    Params: { id: string };
    Body: TaskArchivedBody;
    Reply: TaskStatusReply | { error: string };
  }>(
    "/api/tasks/:id/archived",
    { preHandler: [writeGuard] },
    async (req, reply) => {
      const { id } = req.params;

      if (!TASK_ID_RE.test(id)) {
        void reply.code(400).send({ error: `Invalid task id '${id}'. Must match (TASK|BUG)-[0-9]+.` });
        return;
      }

      const body = req.body;
      if (typeof body !== "object" || body === null || typeof body.archived !== "boolean") {
        void reply.code(400).send({ error: "Request body must include { archived: boolean }" });
        return;
      }

      const content = readTasksContent();
      if (content === null) {
        void reply.code(404).send({ error: `TASKS.md not found` });
        return;
      }

      const result = setTaskArchived(content, id, body.archived);
      if (!result.ok) {
        switch (result.code) {
          case "not_found":
            void reply.code(404).send({ error: `Task '${id}' not found in TASKS.md` });
            return;
          case "ambiguous":
            void reply.code(409).send({
              error: `Task '${id}' appears more than once in TASKS.md — shape is ambiguous. No write performed.`,
            });
            return;
          default:
            void reply.code(409).send({ error: `Could not archive '${id}'. No write performed.` });
            return;
        }
      }

      atomicWriteTasksMd(result.content);
      const board = parseTasksMd(result.content);
      return { ok: true, board };
    }
  );

  // ── POST /api/bugs — create a bug in the Bug-Fix lane's Reported column ──────
  fastify.post<{
    Body: CreateBugBody;
    Reply: { ok: true; bugId: string; board: TaskBoard } | { error: string };
  }>(
    "/api/bugs",
    { preHandler: [writeGuard] },
    async (req, reply) => {
      const body = req.body;
      if (
        typeof body !== "object" ||
        body === null ||
        typeof body.title !== "string" ||
        body.title.trim() === ""
      ) {
        void reply.code(400).send({
          error:
            "Request body must include { title: string, severity?, sourceTask?, sourceItem?, round?, note? }",
        });
        return;
      }
      if (
        body.severity !== undefined &&
        !["P0", "P1", "P2", "P3"].includes(body.severity)
      ) {
        void reply.code(400).send({ error: "severity must be P0|P1|P2|P3 (or omitted)" });
        return;
      }
      if (body.sourceTask !== undefined && !TASK_ID_RE.test(body.sourceTask)) {
        void reply.code(400).send({ error: "sourceTask must match (TASK|BUG)-[0-9]+" });
        return;
      }

      const content = readTasksContent();
      if (content === null) {
        void reply.code(404).send({ error: `TASKS.md not found` });
        return;
      }

      const date = new Date().toISOString().slice(0, 10);
      const result = createBug(content, {
        title: body.title,
        severity: body.severity,
        sourceTask: body.sourceTask,
        sourceItem: body.sourceItem,
        round: body.round,
        note: body.note,
        date,
      });

      if (!result.ok) {
        void reply.code(409).send({
          error: "Bug-Fix lane has no '### Reported' section. No write performed.",
        });
        return;
      }

      atomicWriteTasksMd(result.content);
      const board = parseTasksMd(result.content);
      return { ok: true, bugId: result.bugId, board };
    }
  );
};
