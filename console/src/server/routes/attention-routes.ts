/**
 * attention-routes.ts — GET /api/attention (TASK-109; CONSOLE-V2-DESIGN.md S3 + §2.9).
 *
 * One ranked "needs a human" aggregator per project — the substrate under the
 * Needs-you inbox (#9), the ticker's attention zone (#6), and the Hub's
 * fleet-watch notification plan (plan §4c diffs successive snapshots of the
 * SAME AttentionItem[] shape — one ranking to tune, not two).
 *
 * Sources (existing parsers/flags ONLY — no new state, no new file formats):
 *   rank 0  P0 bugs           — tasks-parser, bug lane, not Done ([P0] title marker)
 *   rank 1  doctor findings   — .claude/.framework-doctor-findings.md flag
 *                               (existence + first line; CRITICAL count best-effort)
 *   rank 2  verify seeds      — .claude/console/verify/*.json with pending items
 *                               (verify schema + reconcile, board-title join)
 *   rank 3  P1 bugs           — as rank 0, [P1]
 *   rank 4  flagged decisions — DECISIONS.md entries with `Proposed` status or
 *                               ⚑ in the title (the ⚑ scan lives here — S3)
 *   rank 5  review criticals  — findings-parser openCriticals over review-findings.md
 *   rank 6  update available  — .claude/.framework-update-available.md flag
 * Within a rank, OLDER `since` sorts first (waited longest → most attention);
 * null `since` sorts last.
 *
 * computeAttention(root) is PURE over the filesystem — root-parameterised, no
 * getProjectRoot()/dotClaudePath() binding — so the Hub reuses it for STOPPED
 * projects (fleet inbox) and the notification plan diffs it. Reads are
 * fresh-from-disk per call (house rule DEC-002: files are the truth; every
 * source file here is small). Read-only route: loopback-bound via the server's
 * global Host guard, no write token (contract:console-http-api read rules).
 */

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { getProjectRoot } from "../project-root.js";
import { parseTasksFile } from "../parsers/tasks-parser.js";
import { parseDecisionsFile } from "../parsers/decisions-parser.js";
import { parseReviewFindingsMd } from "../parsers/findings-parser.js";
import {
  validateVerifyFile,
  normalizeLegacyVerdicts,
} from "../verify/schema.js";
import { applyBugFixes, computeRollup } from "../verify/reconcile.js";
import type { VerifyFile } from "../verify/schema.js";
import type { AttentionItem, TaskBoard } from "../types.js";

// ── Rank constants (S3 ranking — keep in sync with the AttentionItem doc) ─────

const RANK_P0_BUG = 0;
const RANK_DOCTOR = 1;
const RANK_VERIFY = 2;
const RANK_P1_BUG = 3;
const RANK_DECISION = 4;
const RANK_REVIEW = 5;
const RANK_UPDATE = 6;

// ── Small helpers ─────────────────────────────────────────────────────────────

/**
 * Severity of a bug from its BOARD TITLE. House style puts the marker in the
 * heading — `#### [BUG-31] title [P0]` (the `**Severity:**` body line is not
 * part of the parser's TaskItem). Bracketed marker first; bare-word P0/P1
 * fallback for boards that drop the brackets. No marker → null (not surfaced —
 * S3 only wants P0/P1).
 */
function bugSeverity(title: string): "P0" | "P1" | "P2" | "P3" | null {
  const bracketed = /\[(P[0-3])\]/.exec(title);
  if (bracketed) return bracketed[1] as "P0" | "P1" | "P2" | "P3";
  const bare = /\b(P[01])\b/.exec(title);
  return bare ? (bare[1] as "P0" | "P1") : null;
}

/** Strip the `[Pn]` marker and trailing ✓ from a board title for display. */
function cleanBugTitle(title: string): string {
  return title
    .replace(/\s*\[(P[0-3])\]\s*/g, " ")
    .replace(/\s*✓\s*$/u, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** A framework flag file's display facts: first non-empty line + mtime. */
interface FlagInfo {
  firstLine: string;
  raw: string;
  mtimeIso: string | null;
}

/** Read a flag file (existence + first line, per S3). Null when absent/unreadable. */
function readFlag(path: string): FlagInfo | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const first = raw.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
    const firstLine = first.replace(/^#+\s*/, "").trim();
    let mtimeIso: string | null = null;
    try {
      mtimeIso = new Date(statSync(path).mtimeMs).toISOString();
    } catch {
      /* deleted between read and stat — omit */
    }
    return { firstLine, raw, mtimeIso };
  } catch {
    return null; // unreadable flag — degrade to "no item", never crash a read route
  }
}

/** File mtime as ISO, or null (missing/unreadable). */
function mtimeIsoOf(path: string): string | null {
  try {
    return new Date(statSync(path).mtimeMs).toISOString();
  } catch {
    return null;
  }
}

/** rank asc → since asc (oldest waits longest; nulls last) → title (stable). */
function byRankThenAge(a: AttentionItem, b: AttentionItem): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.since !== null || b.since !== null) {
    if (a.since === null) return 1;
    if (b.since === null) return -1;
    // ISO-8601 strings compare chronologically as strings (date-only sorts
    // before same-day timestamps — acceptable for a tiebreak).
    const d = a.since < b.since ? -1 : a.since > b.since ? 1 : 0;
    if (d !== 0) return d;
  }
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

// ── Per-source collectors (all pure over `root`) ──────────────────────────────

/** Board-derived facts shared by the bug and verify collectors. */
interface BoardFacts {
  board: TaskBoard;
  /** Task/bug ids in a Done column (either lane) — drops closed work. */
  doneIds: Set<string>;
  /** BUG-ids in the bug lane's Done column — feeds the verify reconcile. */
  doneBugIds: Set<string>;
  /** id → board title (feature name join for verify items). */
  titles: Map<string, string>;
}

function readBoardFacts(root: string): BoardFacts {
  const board = parseTasksFile(join(root, ".claude", "TASKS.md"));
  const doneIds = new Set<string>();
  const doneBugIds = new Set<string>();
  const titles = new Map<string, string>();
  for (const col of board.columns) {
    const isDone = col.status.toLowerCase() === "done";
    for (const item of col.items) {
      if (isDone) {
        doneIds.add(item.id);
        if (col.lane === "bug") doneBugIds.add(item.id);
      }
      const t = item.title.trim();
      if (t) titles.set(item.id, t);
    }
  }
  return { board, doneIds, doneBugIds, titles };
}

/** Open P0 (rank 0) / P1 (rank 3) bugs — bug lane, not Done, not archived. */
function collectBugs(facts: BoardFacts): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const col of facts.board.columns) {
    if (col.lane !== "bug" || col.status.toLowerCase() === "done") continue;
    for (const bug of col.items) {
      if (bug.archived) continue;
      const sev = bugSeverity(bug.title);
      if (sev !== "P0" && sev !== "P1") continue;
      items.push({
        kind: "bug",
        rank: sev === "P0" ? RANK_P0_BUG : RANK_P1_BUG,
        title: cleanBugTitle(bug.title) || bug.id,
        detail: `${bug.id} · ${sev} · ${col.status}`,
        link: `/kanban?task=${bug.id}`,
        since: null, // the board carries no per-entry timestamp
      });
    }
  }
  return items;
}

/** Verify seeds with pending items (rank 2) — one item per seed. */
function collectVerify(root: string, facts: BoardFacts): AttentionItem[] {
  const dir = join(root, ".claude", "console", "verify");
  let entries: string[];
  try {
    entries = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return []; // no verify dir → no seeds (zero coupling when Console state is absent)
  }

  const items: AttentionItem[] = [];
  for (const filename of entries) {
    const task = filename.replace(/\.json$/i, "");
    // Done on the board → no longer awaiting a human (mirrors listVerifyRefs).
    if (facts.doneIds.has(task)) continue;

    const filePath = join(dir, filename);
    try {
      const parsed = normalizeLegacyVerdicts(
        JSON.parse(readFileSync(filePath, "utf8")),
      );
      // Invalid seeds are the Verify TAB's business (it lists them as
      // `invalid` entries); the attention feed only surfaces well-formed
      // pending work — S3 scope is "verify seeds with pending items".
      if (!validateVerifyFile(parsed).valid) continue;

      const file = parsed as VerifyFile;
      // Same reconciled view the Verify queue shows: a use case whose flagged
      // bug is now Done flips back to pending (it needs the human again).
      const { file: reconciled } = applyBugFixes(file, facts.doneBugIds);
      const counts = computeRollup(reconciled.items);
      const pending = counts["pending"] ?? 0;
      if (pending === 0) continue;

      items.push({
        kind: "verify",
        rank: RANK_VERIFY,
        title: facts.titles.get(reconciled.task) ?? reconciled.task,
        detail: `${reconciled.task} · ${pending}/${reconciled.items.length} pending`,
        link: `/verify/${reconciled.task}`,
        count: pending,
        since: mtimeIsoOf(filePath),
      });
    } catch {
      continue; // unreadable seed — the Verify tab surfaces it; not an inbox row
    }
  }
  return items;
}

/** Doctor findings flag (rank 1) — existence + first line, CRITICAL count best-effort. */
function collectDoctor(root: string): AttentionItem[] {
  const flag = readFlag(join(root, ".claude", ".framework-doctor-findings.md"));
  if (!flag) return [];
  // Best-effort severity count: doctor writes CRITICAL|WARNING|INFO|NAG lines.
  const criticals = flag.raw
    .split(/\r?\n/)
    .filter((l) => /\bCRITICAL\b/.test(l)).length;
  return [
    {
      kind: "doctor",
      rank: RANK_DOCTOR,
      title:
        criticals > 0
          ? `${criticals} CRITICAL doctor finding${criticals === 1 ? "" : "s"}`
          : "Doctor findings need triage",
      detail: flag.firstLine,
      link: "/status",
      ...(criticals > 0 ? { count: criticals } : {}),
      since: flag.mtimeIso,
    },
  ];
}

/** Flagged decisions (rank 4): `Proposed` status or ⚑ in the title (the S3 ⚑ scan). */
function collectDecisions(root: string): AttentionItem[] {
  const decisions = parseDecisionsFile(join(root, ".claude", "DECISIONS.md"));
  const items: AttentionItem[] = [];
  for (const d of decisions) {
    const proposed = d.status.trim().toLowerCase() === "proposed";
    const flagged = d.title.includes("⚑");
    if (!proposed && !flagged) continue;
    items.push({
      kind: "decision",
      rank: RANK_DECISION,
      title: d.title,
      detail: `${d.id}${d.status ? ` · ${d.status}` : ""}`,
      link: "/decisions",
      since: d.date || null, // ISO date (YYYY-MM-DD) straight from the entry
    });
  }
  return items;
}

/** Open review criticals (rank 5) — findings-parser over review-findings.md. */
function collectReview(root: string): AttentionItem[] {
  const path = join(root, ".claude", "review-findings.md");
  if (!existsSync(path)) return [];
  let content = "";
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const { latestVerdict, openCriticals } = parseReviewFindingsMd(content);
  if (openCriticals === 0) return [];
  return [
    {
      kind: "review",
      rank: RANK_REVIEW,
      title: `${openCriticals} open CRITICAL review finding${openCriticals === 1 ? "" : "s"}`,
      detail: latestVerdict
        ? `latest verdict ${latestVerdict}`
        : "review-findings.md",
      link: "/findings",
      count: openCriticals,
      since: mtimeIsoOf(path),
    },
  ];
}

/** Framework update flag (rank 6) — existence + first line. */
function collectUpdate(root: string): AttentionItem[] {
  const flag = readFlag(
    join(root, ".claude", ".framework-update-available.md"),
  );
  if (!flag) return [];
  return [
    {
      kind: "update",
      rank: RANK_UPDATE,
      title: "Framework update available",
      detail: flag.firstLine,
      link: "/dashboard", // framework-health tile; S2 anchor lands later
      since: flag.mtimeIso,
    },
  ];
}

// ── The aggregator (pure; exported for the Hub + notification-plan reuse) ─────

/**
 * Compute the ranked "needs a human" list for a project root. Pure over the
 * filesystem: no singletons, no caching, no writes — callable for any root
 * (the per-project route, the Hub's stopped-project fallback, and the plan-§4c
 * notification differ all share this one function).
 */
export function computeAttention(root: string): AttentionItem[] {
  const facts = readBoardFacts(root);
  const items: AttentionItem[] = [
    ...collectBugs(facts),
    ...collectDoctor(root),
    ...collectVerify(root, facts),
    ...collectDecisions(root),
    ...collectReview(root),
    ...collectUpdate(root),
  ];
  items.sort(byRankThenAge);
  return items;
}

// ── Route plugin ──────────────────────────────────────────────────────────────

export const attentionRoutes: FastifyPluginAsync = async (
  fastify: FastifyInstance,
) => {
  // GET /api/attention — read-only, fresh-from-disk (DEC-002), no token.
  fastify.get<{ Reply: AttentionItem[] }>("/api/attention", async () => {
    return computeAttention(getProjectRoot());
  });
};
