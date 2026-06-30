/**
 * dashboard-routes.ts — Fastify plugin exposing GET /api/dashboard (TASK-007)
 *
 * Registers:
 *   GET /api/dashboard -> DashboardSummary
 *
 * Aggregates from the existing parsers and the verify io layer. Files are read
 * fresh on every request (no-state-projection, DEC-002). All parsing is
 * delegated to existing parsers — no re-implementation of parsing logic here.
 *
 * How to wire into server.ts:
 *   import { dashboardRoutes } from "./routes/dashboard-routes.js";
 *   await fastify.register(dashboardRoutes);
 *   // Then remove the stub GET /api/dashboard handler.
 *
 * contract:console-http-api, contract:console-state-sources
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { readFileSync, existsSync } from "node:fs";

import { dotClaudePath } from "../project-root.js";
import { parseTasksFile } from "../parsers/tasks-parser.js";
import { parseContractsFile } from "../parsers/contracts-parser.js";
import { parseDecisionsFile } from "../parsers/decisions-parser.js";
import { parseSpecsList } from "../parsers/specs-parser.js";
import { listVerifyRefs } from "../verify/io.js";
import type { DashboardSummary, Lane } from "../types.js";

/** Number of latest decisions to surface on the dashboard. */
const MAX_DECISIONS = 5;

/**
 * Parse the sprint goal from STATUS.md.
 *
 * Expected format:
 *   ## Current Sprint Goal
 *   <one or more paragraphs>
 *   ## <next section>
 *
 * Returns the first non-empty paragraph after the heading, trimmed.
 * Returns null if the file is absent, the heading is not found, or the
 * section is empty.
 */
function readSprintGoal(statusPath: string): string | null {
  if (!existsSync(statusPath)) return null;

  let content: string;
  try {
    content = readFileSync(statusPath, "utf8");
  } catch {
    return null;
  }

  const lines = content.split(/\r?\n/);
  let inGoalSection = false;
  const goalLines: string[] = [];

  for (const line of lines) {
    if (/^##\s+Current Sprint Goal/i.test(line)) {
      inGoalSection = true;
      continue;
    }

    // A new ## heading closes the section.
    if (inGoalSection && /^##\s+/.test(line)) {
      break;
    }

    if (inGoalSection) {
      goalLines.push(line);
    }
  }

  // Join and trim — return first non-empty paragraph.
  const goal = goalLines.join("\n").trim();
  return goal.length > 0 ? goal : null;
}

export const dashboardRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance
) => {
  fastify.get<{ Reply: DashboardSummary }>("/api/dashboard", async () => {
    // ── Task counts ──────────────────────────────────────────────────────────
    const taskBoard = parseTasksFile(dotClaudePath("TASKS.md"));

    const taskCounts: { lane: Lane; status: string; n: number }[] = [];
    for (const col of taskBoard.columns) {
      taskCounts.push({ lane: col.lane, status: col.status, n: col.items.length });
    }

    // ── Contract counts ──────────────────────────────────────────────────────
    const contracts = parseContractsFile(dotClaudePath("ECOSYSTEM.md"));
    let stableN = 0;
    let draftN = 0;
    for (const c of contracts) {
      if (c.status === "stable") stableN++;
      else draftN++;
    }
    const contractCounts: { status: "draft" | "stable"; n: number }[] = [];
    if (stableN > 0 || draftN > 0) {
      contractCounts.push({ status: "stable", n: stableN });
      contractCounts.push({ status: "draft", n: draftN });
    }

    // ── Latest decisions ─────────────────────────────────────────────────────
    // DECISIONS.md is authored newest-first (DEC-010 at the top) and the parser
    // preserves file order, so the first MAX_DECISIONS entries are already the
    // newest. (Previously this reversed → oldest-first; that was the bug.)
    const allDecisions = parseDecisionsFile(dotClaudePath("DECISIONS.md"));
    const latestDecisions = allDecisions.slice(0, MAX_DECISIONS);

    // ── Current spec ─────────────────────────────────────────────────────────
    const specsDir = dotClaudePath("framework", "docs", "specs");
    const specs = parseSpecsList(specsDir);
    // Return the name of the first spec found (sorted alphabetically by the parser).
    // Prefer "SPEC-project-console" if it exists, else the first entry.
    const currentSpec =
      specs.find((s) => s.name.toLowerCase().includes("project-console"))?.name ??
      specs[0]?.name ??
      null;

    // ── Sprint goal ──────────────────────────────────────────────────────────
    const sprintGoal = readSprintGoal(dotClaudePath("STATUS.md"));

    // ── Handback queue ───────────────────────────────────────────────────────
    // listVerifyRefs() returns all verify files — these represent tasks that
    // have a pass-file written by the Tester. Items are already gracefully
    // empty when the verify dir doesn't exist or has no files.
    //
    // The pass-file only knows the task ID, so a ref's `title` defaults to the
    // ID. Join the REAL task title from TASKS.md (already parsed above) so the
    // queue reads descriptively — stripping the trailing " — <status/date>"
    // suffix the board appends. Falls back to the ID when the task isn't found.
    const titleById = new Map<string, string>();
    for (const col of taskBoard.columns) {
      for (const item of col.items) {
        titleById.set(item.id, item.title.split(/\s+—\s+/)[0].trim());
      }
    }
    const handbackQueue = listVerifyRefs().map((ref) => {
      const realTitle = titleById.get(ref.task);
      return realTitle && realTitle !== ref.task
        ? { ...ref, title: realTitle }
        : ref;
    });

    return {
      handbackQueue,
      taskCounts,
      contractCounts,
      latestDecisions,
      currentSpec,
      sprintGoal,
    };
  });
};
