// @vitest-environment node
/**
 * attention.test.ts — Tests for computeAttention + GET /api/attention
 * (TASK-109; CONSOLE-V2-DESIGN.md S3 + §2.9).
 *
 * Fixture-based: a temp project dir with a doctor flag, a pending verify
 * seed, open P0/P1 bugs, flagged decisions, open review criticals and an
 * update flag → assert the S3 ranking (P0 bug=0, doctor=1, verify=2,
 * P1 bug=3, decision=4, review=5, update=6) and the per-source filters
 * (Done/archived/P2 bugs out, pending-free seeds out, RESOLVED criticals
 * uncounted, age tiebreak within a rank).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TASKS_FIXTURE = `
# Task Board

## Feature Lane

### In Progress

#### [TASK-001] Needs-you inbox

### Done

#### [TASK-002] Shipped feature ✓

## Bug-Fix Lane

### Reported

#### [BUG-101] Hub reap kills live console [P0]
**Severity:** P0 (kills live consoles) | **Source:** owner
#### [BUG-102] Cosmetic misalignment [P2]

### Fixing

#### [BUG-104] Stale titles after rename [P1]

### Done

#### [BUG-103] Old fixed blocker [P0] ✓
`;

const DECISIONS_FIXTURE = `
# Decision Log

## DEC-050 — ⚑ CHANNEL mailbox design gate
**Date:** 2026-03-01 · **Status:** active
**Decision:** Needs an owner call before build.

## DEC-049 — Adopt scoped tabs
**Date:** 2026-02-01 · **Status:** Proposed
**Decision:** Pending sign-off.

## DEC-048 — Ordinary settled decision
**Date:** 2026-01-15 · **Status:** active
**Decision:** Nothing to see here.
`;

const REVIEW_FINDINGS_FIXTURE = `
# Review Findings

## 2026-07-01 — review pass

**VERDICT: CHANGES-NEEDED**

- [CRITICAL] Token leaks into the registry file (src/server/security.ts:12)
- [CRITICAL] RESOLVED — fixed in commit abc123
- [WARNING] Minor naming drift
`;

// Real doctor list-item format: `- **SEVERITY** — [area] …` (doctor.sh).
const DOCTOR_FLAG_FIXTURE = `# Framework Doctor Findings

- **CRITICAL** — [hooks] settings.json references a missing hook script.
- **WARNING** — [cross-refs] CLAUDE.md links to a missing file.
`;

// BUG-019 regression: a 0-CRITICAL / 1-WARNING file whose SUMMARY line and
// "What to do" prose both contain the word CRITICAL. The count must stay 0 —
// only `- **CRITICAL**` FINDING list-items count, never the prose.
const DOCTOR_WARNING_ONLY_FIXTURE = `# Framework Doctor — Issues Detected

**Scan time:** 2026-07-07T11:48:11Z
**Findings:** 0 CRITICAL, 1 WARNING, 0 INFO, 0 NAG

## Findings

- **WARNING** — [tasks] TASKS.md contains duplicate heading entries for \`TASK-071\`.

## What to do

CRITICAL findings should be resolved before continuing — they
indicate broken framework state that will cause silent failures.

WARNING findings should be triaged; some may be intentional
(e.g., a hook kept around but not wired yet).
`;

const UPDATE_FLAG_FIXTURE = `# Framework Update Available

- **Current:** \`abc1234\`
- **Latest:** \`def5678\`
`;

function verifySeed(task: string, verdicts: string[]): string {
  return JSON.stringify({
    schemaVersion: 1,
    task,
    status: "in-review",
    items: verdicts.map((verdict, i) => ({
      id: `uc-${i + 1}`,
      kind: "test-plan-item",
      title: `use case ${i + 1}`,
      subject: "s",
      expected: "e",
      verdict,
      severity: null,
      notes: "",
      changed: false,
    })),
  });
}

// ── Temp roots ────────────────────────────────────────────────────────────────

let tmpRoot = "";
let emptyRoot = "";
let warnRoot = "";

vi.mock("../src/server/project-root.js", () => {
  return {
    findProjectRoot: (_: string) => tmpRoot,
    getProjectRoot: () => tmpRoot,
    dotClaudePath: (...segments: string[]) =>
      [tmpRoot, ".claude", ...segments].join("/"),
  };
});

// ── Import after mock (route uses getProjectRoot; computeAttention does not) ──

const { computeAttention, attentionRoutes } =
  await import("../src/server/routes/attention-routes.js");

beforeAll(() => {
  tmpRoot = join(tmpdir(), `ccmaf-attention-${Date.now()}`);
  const dotClaude = join(tmpRoot, ".claude");
  const verifyDir = join(dotClaude, "console", "verify");
  mkdirSync(verifyDir, { recursive: true });

  writeFileSync(join(dotClaude, "TASKS.md"), TASKS_FIXTURE, "utf8");
  writeFileSync(join(dotClaude, "DECISIONS.md"), DECISIONS_FIXTURE, "utf8");
  writeFileSync(
    join(dotClaude, "review-findings.md"),
    REVIEW_FINDINGS_FIXTURE,
    "utf8",
  );
  writeFileSync(
    join(dotClaude, ".framework-doctor-findings.md"),
    DOCTOR_FLAG_FIXTURE,
    "utf8",
  );
  writeFileSync(
    join(dotClaude, ".framework-update-available.md"),
    UPDATE_FLAG_FIXTURE,
    "utf8",
  );

  // Pending seed for an in-progress task (2 pending / 3 items).
  writeFileSync(
    join(verifyDir, "TASK-001.json"),
    verifySeed("TASK-001", ["pending", "pass", "pending"]),
    "utf8",
  );
  // Seed for a task that's Done on the board → filtered out entirely.
  writeFileSync(
    join(verifyDir, "TASK-002.json"),
    verifySeed("TASK-002", ["pending"]),
    "utf8",
  );

  // A second, empty project root (bare .claude/) → empty feed.
  emptyRoot = join(tmpdir(), `ccmaf-attention-empty-${Date.now()}`);
  mkdirSync(join(emptyRoot, ".claude"), { recursive: true });

  // A third root with ONLY a WARNING-only doctor file (BUG-019 regression).
  warnRoot = join(tmpdir(), `ccmaf-attention-warn-${Date.now()}`);
  mkdirSync(join(warnRoot, ".claude"), { recursive: true });
  writeFileSync(
    join(warnRoot, ".claude", ".framework-doctor-findings.md"),
    DOCTOR_WARNING_ONLY_FIXTURE,
    "utf8",
  );
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(emptyRoot, { recursive: true, force: true });
  rmSync(warnRoot, { recursive: true, force: true });
});

// ── computeAttention (pure) ───────────────────────────────────────────────────

describe("computeAttention — ranking", () => {
  it("orders the full fixture by the S3 ranks 0..6", () => {
    const items = computeAttention(tmpRoot);
    // P0 bug, doctor, verify, P1 bug, 2 decisions, review, update = 8 items.
    expect(items.map((i) => i.kind)).toEqual([
      "bug",
      "doctor",
      "verify",
      "bug",
      "decision",
      "decision",
      "review",
      "update",
    ]);
    expect(items.map((i) => i.rank)).toEqual([0, 1, 2, 3, 4, 4, 5, 6]);
  });

  it("is sorted exactly as the comparator promises (rank asc)", () => {
    const items = computeAttention(tmpRoot);
    const ranks = items.map((i) => i.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("ties within a rank break by age — older `since` first", () => {
    const items = computeAttention(tmpRoot);
    const decisions = items.filter((i) => i.kind === "decision");
    expect(decisions.length).toBe(2);
    // DEC-049 (2026-02-01, Proposed) waited longer than DEC-050 (2026-03-01, ⚑).
    expect(decisions[0].detail).toContain("DEC-049");
    expect(decisions[1].detail).toContain("DEC-050");
  });
});

describe("computeAttention — bugs", () => {
  it("surfaces the open P0 bug at rank 0 with a kanban deep link", () => {
    const p0 = computeAttention(tmpRoot).find((i) => i.rank === 0);
    expect(p0).toBeDefined();
    expect(p0!.kind).toBe("bug");
    expect(p0!.link).toBe("/kanban?task=BUG-101");
    expect(p0!.title).toBe("Hub reap kills live console"); // [P0] marker stripped
    expect(p0!.detail).toContain("BUG-101");
    expect(p0!.detail).toContain("P0");
  });

  it("surfaces the open P1 bug at rank 3", () => {
    const p1 = computeAttention(tmpRoot).find((i) => i.rank === 3);
    expect(p1).toBeDefined();
    expect(p1!.link).toBe("/kanban?task=BUG-104");
  });

  it("excludes P2 bugs and Done bugs", () => {
    const links = computeAttention(tmpRoot).map((i) => i.link);
    expect(links).not.toContain("/kanban?task=BUG-102"); // P2 — below the bar
    expect(links).not.toContain("/kanban?task=BUG-103"); // Done — closed
  });
});

describe("computeAttention — verify seeds", () => {
  it("surfaces a seed with pending items, counting only pending", () => {
    const v = computeAttention(tmpRoot).find((i) => i.kind === "verify");
    expect(v).toBeDefined();
    expect(v!.rank).toBe(2);
    expect(v!.count).toBe(2); // 2 pending of 3
    expect(v!.detail).toBe("TASK-001 · 2/3 pending");
    expect(v!.link).toBe("/verify/TASK-001");
    expect(v!.title).toBe("Needs-you inbox"); // board-title join
    expect(v!.since).not.toBeNull(); // seed mtime drives the age chip
  });

  it("drops seeds whose task is Done on the board", () => {
    const links = computeAttention(tmpRoot).map((i) => i.link);
    expect(links).not.toContain("/verify/TASK-002");
  });

  it("drops seeds with no pending items", () => {
    const verifyDir = join(tmpRoot, ".claude", "console", "verify");
    writeFileSync(
      join(verifyDir, "TASK-003.json"),
      verifySeed("TASK-003", ["pass", "pass"]),
      "utf8",
    );
    try {
      const links = computeAttention(tmpRoot).map((i) => i.link);
      expect(links).not.toContain("/verify/TASK-003");
    } finally {
      rmSync(join(verifyDir, "TASK-003.json"), { force: true });
    }
  });
});

describe("computeAttention — flags, decisions, review", () => {
  it("doctor flag → rank 1 with the CRITICAL count and first line", () => {
    const d = computeAttention(tmpRoot).find((i) => i.kind === "doctor");
    expect(d).toBeDefined();
    expect(d!.rank).toBe(1);
    expect(d!.count).toBe(1); // one `- **CRITICAL**` finding in the fixture
    expect(d!.title).toBe("1 CRITICAL doctor finding");
    expect(d!.detail).toBe("Framework Doctor Findings"); // first line, # stripped
    expect(d!.link).toBe("/status");
  });

  it("BUG-019: a 0-CRITICAL doctor file is not miscounted from prose", () => {
    // The fixture has 0 CRITICAL findings / 1 WARNING, but the word CRITICAL
    // appears in the "**Findings:** 0 CRITICAL, …" summary and the "What to do"
    // prose. Only `- **CRITICAL**` list-items count → no critical is claimed.
    const d = computeAttention(warnRoot).find((i) => i.kind === "doctor");
    expect(d).toBeDefined();
    expect(d!.rank).toBe(1);
    expect(d!.count).toBeUndefined(); // NOT 2 (the pre-fix bug), NOT any number
    expect(d!.title).toBe("Doctor findings need triage"); // generic, no count
  });

  it("flags decisions by Proposed status AND by ⚑ in the title — not settled ones", () => {
    const decisions = computeAttention(tmpRoot).filter(
      (i) => i.kind === "decision",
    );
    const details = decisions.map((d) => d.detail);
    expect(details.some((d) => d.includes("DEC-049"))).toBe(true); // Proposed
    expect(details.some((d) => d.includes("DEC-050"))).toBe(true); // ⚑ title
    expect(details.some((d) => d.includes("DEC-048"))).toBe(false); // settled
    expect(decisions[0].link).toBe("/decisions");
    expect(decisions[0].since).toBe("2026-02-01"); // entry date, not file mtime
  });

  it("review criticals → rank 5, RESOLVED lines uncounted", () => {
    const r = computeAttention(tmpRoot).find((i) => i.kind === "review");
    expect(r).toBeDefined();
    expect(r!.rank).toBe(5);
    expect(r!.count).toBe(1); // the RESOLVED critical doesn't count
    expect(r!.detail).toContain("CHANGES-NEEDED");
    expect(r!.link).toBe("/findings");
  });

  it("update flag → rank 6 (lowest urgency)", () => {
    const items = computeAttention(tmpRoot);
    const u = items.find((i) => i.kind === "update");
    expect(u).toBeDefined();
    expect(u!.rank).toBe(6);
    expect(u!.detail).toBe("Framework Update Available");
    expect(items[items.length - 1]).toBe(u); // always last in this fixture
  });
});

describe("computeAttention — empty project", () => {
  it("returns [] for a bare .claude/ (nothing needs you)", () => {
    expect(computeAttention(emptyRoot)).toEqual([]);
  });
});

// ── Route plugin (Fastify inject) ─────────────────────────────────────────────

describe("attentionRoutes plugin", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(attentionRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/attention returns 200 with the ranked AttentionItem[]", async () => {
    const res = await app.inject({ method: "GET", url: "/api/attention" });
    expect(res.statusCode).toBe(200);
    const body = res.json<
      {
        kind: string;
        rank: number;
        title: string;
        detail: string;
        link: string;
        since: string | null;
      }[]
    >();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].rank).toBe(0); // the P0 bug leads
    for (const item of body) {
      expect(typeof item.kind).toBe("string");
      expect(typeof item.rank).toBe("number");
      expect(typeof item.title).toBe("string");
      expect(typeof item.detail).toBe("string");
      expect(item.link.startsWith("/")).toBe(true);
      expect(item.since === null || typeof item.since === "string").toBe(true);
    }
  });
});
