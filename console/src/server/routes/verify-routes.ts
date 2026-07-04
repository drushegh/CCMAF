/**
 * verify-routes.ts — Fastify plugin for contract:console-http-api verify endpoints.
 *
 * Registers:
 *   GET  /api/verify         → VerifyRef[]    (Ready-for-Test queue)
 *   GET  /api/verify/:task   → VerifyFile
 *   PUT  /api/verify/:task   → VerifyFile     (body: VerdictPatch[]; write-guarded)
 *
 * Plugin design:
 *   - Self-contained (no edits to server.ts required — TASK-003 runs in parallel).
 *   - The write-guard preHandler is passed in from the caller (defined in server.ts)
 *     so security config stays in one place.
 *   - Path-safety is enforced inside the io layer (resolveVerifyPath).
 *
 * IMPORTANT: Do NOT register this plugin from server.ts yet — the main session
 * wires it after TASK-003 and TASK-004 are both merged, then removes the stub
 * verify routes. See task brief for the exact lines to add/remove.
 */

import type { FastifyInstance, FastifyPluginAsync, preHandlerHookHandler } from "fastify";
import type { VerifyRef, VerdictPatch } from "../types.js";
import type { VerifyFile, VerifyItem } from "../verify/schema.js";
import { listVerifyRefs, readVerifyFile, readVerifyFileWithMeta, writeVerifyFile, applyPatches } from "../verify/io.js";
import { moveTaskStatus, createTask } from "../tasks/writeback.js";
import { readTasksContentWithMeta, atomicWriteTasksMd } from "./tasks-write-routes.js";

// ── Auto-move to Done + CR follow-up spawn (changes 1 & 3) ──────────────────
//
// Both helpers are best-effort against TASKS.md: the verify file write is the
// durable, validated action; a board hiccup (missing TASKS.md, missing
// section, or a concurrent-write conflict) must never fail the verify save
// that already succeeded. A missed board update self-heals on the NEXT save
// (the file's crTaskId stays null / the task stays off Done until a save
// finds the board writable), so silently skipping here is safe, not lossy.

/** True when the file has at least one item and every item is pass or cr. */
function allItemsComplete(items: VerifyItem[]): boolean {
  return items.length > 0 && items.every((it) => it.verdict === "pass" || it.verdict === "cr");
}

/**
 * Change 1 (auto-move to Done): once every item in the file is pass/cr, move
 * the corresponding task/bug to Done in TASKS.md via the same surgical
 * moveTaskStatus used by PUT /api/tasks/:id/status. Idempotent — an
 * already-Done task is a no-op (moveTaskStatus returns ok with unchanged
 * content); fail/blocked/pending items hold the task where it is (the
 * all-complete gate above never fires).
 */
function autoMoveToDoneIfComplete(taskId: string, items: VerifyItem[]): void {
  if (!allItemsComplete(items)) return;
  try {
    const read = readTasksContentWithMeta();
    if (read === null) return; // no TASKS.md — nothing to move
    const lane: "feature" | "bug" = taskId.startsWith("BUG-") ? "bug" : "feature";
    const moved = moveTaskStatus(read.content, taskId, "Done", lane);
    if (!moved.ok) return; // not_found / target_missing / ambiguous — leave the board as-is
    atomicWriteTasksMd(moved.content, read); // ignore conflict — best-effort, see header note
  } catch (err) {
    // Best-effort — never fail the verify save over a board-write hiccup.
    console.warn(`verify: auto-move to Done failed for ${taskId}:`, err);
  }
}

/**
 * Change 3 (CR spawns a linked follow-up task): for every item whose verdict
 * is `cr` and that doesn't yet carry a crTaskId, create a follow-up task in
 * the Feature Lane's Todo column (createTask, the task-equivalent of
 * createBug) and record its id on the item. Idempotent: an item that already
 * has crTaskId is left untouched, so re-saving (or toggling cr→cr again)
 * never spawns a duplicate; a verdict that later moves away from `cr` keeps
 * its crTaskId (the follow-up is real work now — the owner manages it on the
 * board, per the brief). Sequential (not parallel) so each spawn sees the
 * previous one's id when computing the next TASK-NNN.
 */
function spawnCrFollowUps(taskId: string, items: VerifyItem[]): VerifyItem[] {
  let result = items;
  for (let i = 0; i < result.length; i++) {
    const item = result[i];
    if (item.verdict !== "cr" || item.crTaskId) continue;
    try {
      const read = readTasksContentWithMeta();
      if (read === null) continue; // no TASKS.md — nothing to spawn into; retried next save
      const date = new Date().toISOString().slice(0, 10);
      const created = createTask(read.content, {
        title: `CR: ${item.title}`,
        sourceTask: taskId,
        sourceItem: item.id,
        note: item.notes,
        date,
      });
      if (!created.ok) continue; // no Todo section — degrade gracefully; retried next save
      const writeResult = atomicWriteTasksMd(created.content, read);
      if (!writeResult.ok) continue; // board changed concurrently — retried next save
      result = result.map((it, idx) => (idx === i ? { ...it, crTaskId: created.taskId } : it));
    } catch (err) {
      // Best-effort — never fail the verify save over a board-write hiccup.
      console.warn(`verify: CR follow-up spawn failed for ${taskId}/${result[i].id}:`, err);
    }
  }
  return result;
}

export interface VerifyRoutesOptions {
  /** The write-guard preHandler from server.ts (token + origin check). */
  writeGuard: preHandlerHookHandler;
}

/**
 * Fastify plugin that registers the verify endpoints.
 *
 * Usage in server.ts (after both TASK-003 and TASK-004 are merged):
 *
 *   import verifyRoutes from "./routes/verify-routes.js";
 *   await fastify.register(verifyRoutes, { writeGuard });
 *
 * Then remove the three stub routes:
 *   - GET  /api/verify          (stub: returns [])
 *   - GET  /api/verify/:task    (stub: returns 501)
 *   - PUT  /api/verify/:task    (stub: returns 501)
 */
const verifyRoutesPlugin: FastifyPluginAsync<VerifyRoutesOptions> = async (
  fastify: FastifyInstance,
  opts: VerifyRoutesOptions
) => {
  const { writeGuard } = opts;

  // ── GET /api/verify — list all verify files as queue entries ────────────────
  fastify.get<{ Reply: VerifyRef[] }>("/api/verify", async (_req, _reply) => {
    return listVerifyRefs();
  });

  // ── GET /api/verify/:task — read and return a single verify file ────────────
  fastify.get<{
    Params: { task: string };
    Reply: VerifyFile | { error: string };
  }>("/api/verify/:task", async (req, reply) => {
    try {
      const file = readVerifyFile(req.params.task);
      return file;
    } catch (err) {
      const e = err as { code?: string; message: string };
      if (e.code === "ENOENT") {
        void reply.code(404).send({ error: `No verify file for ${req.params.task}` });
        return;
      }
      // Invalid task id (bad format) → 400; corrupt file → 422
      const status = e.message.includes("Invalid task id") ? 400 : 422;
      void reply.code(status).send({ error: e.message });
    }
  });

  // ── PUT /api/verify/:task — apply VerdictPatch[] + write the file ──────────
  fastify.put<{
    Params: { task: string };
    Body: VerdictPatch[];
    Reply: VerifyFile | { error: string; reload?: boolean };
  }>(
    "/api/verify/:task",
    { preHandler: [writeGuard] },
    async (req, reply) => {
      const taskId = req.params.task;
      const patches = req.body;

      // Body must be an array.
      if (!Array.isArray(patches)) {
        void reply.code(400).send({ error: "Request body must be a VerdictPatch[] array" });
        return;
      }

      try {
        // Read the existing file first (+ its write token — mtime + content
        // hash — for the M4 conflict check below).
        const { file: existing, mtimeMs, contentHash } = readVerifyFileWithMeta(taskId);
        // Apply patches (validates each patch entry; throws on bad input).
        let updated = applyPatches(existing, patches);
        // Change 3: spawn a linked follow-up task for any newly-cr'd item
        // (idempotent — see spawnCrFollowUps) BEFORE writing, so the
        // resulting crTaskId is part of the persisted file.
        updated = { ...updated, items: spawnCrFollowUps(taskId, updated.items) };
        // Write back (validates the full file before touching disk). M4: reject
        // + signal reload if the file changed on disk since we read it above.
        const writeResult = writeVerifyFile(updated, { mtimeMs, contentHash });
        if (!writeResult.ok) {
          void reply.code(409).send({
            error: `Verify file for ${taskId} changed on disk since it was read. Reload and retry.`,
            reload: true,
          });
          return;
        }
        // Change 1: once every item is pass/cr, auto-move the task/bug to
        // Done (best-effort — see autoMoveToDoneIfComplete's header note).
        autoMoveToDoneIfComplete(taskId, updated.items);
        // Return the updated file.
        return updated;
      } catch (err) {
        const e = err as { code?: string; message: string };
        if (e.code === "ENOENT") {
          void reply.code(404).send({ error: `No verify file for ${taskId}` });
          return;
        }
        if (e.message.includes("Invalid task id")) {
          void reply.code(400).send({ error: e.message });
          return;
        }
        // Validation failure on patch content or output file.
        void reply.code(422).send({ error: e.message });
      }
    }
  );
};

export default verifyRoutesPlugin;
