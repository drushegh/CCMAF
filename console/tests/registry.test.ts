/**
 * registry.test.ts — Console registry + pinned ports (TASK-037, DEC-025)
 *
 * Pure module: point the whole state tree at a temp dir via
 * CCMAF_CONSOLE_STATE_DIR and exercise register/deregister/read, autoStart
 * flip, malformed-file tolerance, and assign-and-remember ports.
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let stateDir = "";
const created: string[] = [];

function freshStateDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ccmaf-registry-"));
  created.push(d);
  process.env.CCMAF_CONSOLE_STATE_DIR = d;
  return d;
}

const {
  userStateDir,
  registryDir,
  projectName,
  sameRoot,
  registerConsole,
  deregisterConsole,
  readRegistry,
  readEntry,
  findByRoot,
  setAutoStart,
  assignPort,
  entryMtimeMs,
  isHeartbeatStale,
  hubLockPath,
  hubAlive,
} = await import("../src/server/hub/registry.js");

function makeEntry(
  port: number,
  root: string,
  over: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 1 as const,
    project: projectName(root),
    rootPath: root,
    port,
    pid: 1000 + port,
    version: "0.1.0",
    startedAt: "2026-06-28T18:00:00Z",
    shutdownToken: `tok-${port}`,
    autoStart: true,
    ...over,
  };
}

/** Parse the on-disk ports.json for the current state dir ({} when absent). */
function readPortsJson(): Record<string, number> {
  const f = join(stateDir, "ports.json");
  return existsSync(f)
    ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, number>)
    : {};
}

/** File names containing ".tmp" left behind in a dir (atomic-write leftovers). */
function strayTmp(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir).filter((f) => f.includes(".tmp"))
    : [];
}

beforeEach(() => {
  stateDir = freshStateDir();
});

afterAll(() => {
  delete process.env.CCMAF_CONSOLE_STATE_DIR;
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

describe("userStateDir", () => {
  it("honors the CCMAF_CONSOLE_STATE_DIR override", () => {
    expect(userStateDir()).toBe(stateDir);
    expect(registryDir()).toBe(join(stateDir, "registry"));
  });
});

describe("projectName", () => {
  it("is the basename of the root path", () => {
    expect(projectName("F:/Git/Personal/babynamey")).toBe("babynamey");
    expect(projectName("/home/u/proj")).toBe("proj");
  });
});

describe("register / deregister / read", () => {
  it("round-trips an entry and lists it sorted by port", () => {
    registerConsole(makeEntry(6131, "F:/Git/Personal/babynamey"));
    registerConsole(makeEntry(6120, "F:/Git/Personal/alpha"));

    const all = readRegistry();
    expect(all.map((e) => e.port)).toEqual([6120, 6131]); // sorted
    expect(all[1].project).toBe("babynamey");
    expect(all[1].shutdownToken).toBe("tok-6131");

    expect(readEntry(6131)?.rootPath).toBe("F:/Git/Personal/babynamey");
  });

  it("deregister removes only that entry and is idempotent", () => {
    registerConsole(makeEntry(6120, "F:/p/a"));
    registerConsole(makeEntry(6121, "F:/p/b"));
    deregisterConsole(6120);
    deregisterConsole(6120); // idempotent — no throw
    expect(readRegistry().map((e) => e.port)).toEqual([6121]);
  });

  it("readRegistry returns [] when the dir is absent", () => {
    expect(readRegistry()).toEqual([]); // fresh state dir, nothing written
  });

  it("skips a malformed registry file instead of throwing", () => {
    registerConsole(makeEntry(6120, "F:/p/a"));
    mkdirSync(registryDir(), { recursive: true });
    writeFileSync(join(registryDir(), "6199.json"), "{ not json", "utf8");
    const all = readRegistry();
    expect(all.map((e) => e.port)).toEqual([6120]); // 6199 dropped, no crash
  });
});

describe("setAutoStart", () => {
  it("flips the flag on a live entry (tray End → suppress respin)", () => {
    registerConsole(makeEntry(6120, "F:/p/a", { autoStart: true }));
    setAutoStart(6120, false);
    expect(readEntry(6120)?.autoStart).toBe(false);
  });

  it("no-ops on a missing entry", () => {
    setAutoStart(6999, false); // no throw
    expect(readEntry(6999)).toBeNull();
  });
});

describe("heartbeat / reaper helpers", () => {
  it("entryMtimeMs returns a number for a live entry, null when absent", () => {
    registerConsole(makeEntry(6120, "F:/p/a"));
    const m = entryMtimeMs(6120);
    expect(typeof m).toBe("number");
    expect(entryMtimeMs(6999)).toBeNull();
  });

  it("isHeartbeatStale: null mtime (file gone) → reap", () => {
    expect(isHeartbeatStale(null, 60_000, 1_000_000)).toBe(true);
  });

  it("isHeartbeatStale: fresh within grace → keep; older than grace → reap", () => {
    const now = 1_000_000;
    const grace = 60_000;
    expect(isHeartbeatStale(now - 30_000, grace, now)).toBe(false); // 30s old, 60s grace
    expect(isHeartbeatStale(now - 90_000, grace, now)).toBe(true); // 90s old → stale
  });
});

describe("hubAlive — tray Hub pid-lock liveness (launcher's ensureHub gate)", () => {
  it("false when no hub.lock exists", () => {
    expect(hubLockPath()).toBe(join(stateDir, "hub.lock"));
    expect(hubAlive()).toBe(false);
  });

  it("true when the lock holds a live pid (this test process)", () => {
    mkdirSync(userStateDir(), { recursive: true });
    writeFileSync(hubLockPath(), String(process.pid), "utf8");
    expect(hubAlive()).toBe(true);
  });

  it("false when the lock holds a dead pid", () => {
    mkdirSync(userStateDir(), { recursive: true });
    writeFileSync(hubLockPath(), "999999999", "utf8"); // no such process → ESRCH
    expect(hubAlive()).toBe(false);
  });

  it("false when the lock is malformed (non-numeric)", () => {
    mkdirSync(userStateDir(), { recursive: true });
    writeFileSync(hubLockPath(), "not-a-pid", "utf8");
    expect(hubAlive()).toBe(false);
  });
});

describe("assignPort — assign-and-remember", () => {
  it("assigns the base port first, then remembers it stably", () => {
    const p1 = assignPort("F:/p/a");
    expect(p1).toBe(6120);
    // Same root → same port across calls (bookmarkable).
    expect(assignPort("F:/p/a")).toBe(6120);
  });

  it("gives distinct roots distinct ports, skipping taken ones", () => {
    const a = assignPort("F:/p/a");
    const b = assignPort("F:/p/b");
    const c = assignPort("F:/p/c");
    expect(new Set([a, b, c]).size).toBe(3);
    expect([a, b, c]).toEqual([6120, 6121, 6122]);
    // Re-asking keeps each stable regardless of order.
    expect(assignPort("F:/p/b")).toBe(6121);
  });

  it("persists across a fresh module read (it's on disk, not in memory)", () => {
    assignPort("F:/p/a"); // → 6120 in this state dir
    // ports.json is the source of truth, so a re-read returns the same.
    expect(existsSync(join(stateDir, "ports.json"))).toBe(true);
    expect(assignPort("F:/p/a")).toBe(6120);
  });

  it("treats a drive-letter case flip as the same project on win32", () => {
    const p1 = assignPort("F:/proj/x");
    const p2 = assignPort("f:/proj/x");
    if (process.platform === "win32") {
      // Case-insensitive: same pin, no second allocation.
      expect(p2).toBe(p1);
      expect(Object.keys(readPortsJson())).toHaveLength(1);
    } else {
      // Case-sensitive FS: genuinely distinct roots.
      expect(p2).not.toBe(p1);
    }
  });

  it("does not persist a bogus pin when the range is exhausted", () => {
    const a = assignPort("F:/x/a", 7000, 2);
    const b = assignPort("F:/x/b", 7000, 2);
    expect([a, b]).toEqual([7000, 7001]);
    // Range [7000, 7002) is full → fall back to base, remember NOTHING new
    // (no out-of-range 7002, no duplicate).
    expect(assignPort("F:/x/c", 7000, 2)).toBe(7000);
    expect(Object.keys(readPortsJson())).toHaveLength(2);
    // Existing pins are untouched.
    expect(assignPort("F:/x/a", 7000, 2)).toBe(7000);
    expect(assignPort("F:/x/b", 7000, 2)).toBe(7001);
  });
});

// ── sameRoot + findByRoot — win32 case-insensitive matching ───────────────────

describe("sameRoot", () => {
  it("matches identical roots", () => {
    expect(sameRoot("F:/p/a", "F:/p/a")).toBe(true);
  });

  it("ignores drive-letter case on win32; case-sensitive elsewhere", () => {
    expect(sameRoot("f:/Git/proj", "F:/Git/proj")).toBe(
      process.platform === "win32",
    );
  });

  it("distinguishes genuinely different roots", () => {
    expect(sameRoot("F:/p/a", "F:/p/b")).toBe(false);
  });
});

describe("findByRoot — locate a live console by its project root", () => {
  it("finds the entry regardless of drive-letter case on win32", () => {
    registerConsole(makeEntry(6120, "F:/Git/Personal/proj"));
    const flipped = findByRoot("f:/Git/Personal/proj");
    if (process.platform === "win32") {
      expect(flipped?.port).toBe(6120);
    } else {
      expect(flipped).toBeNull(); // different root on a case-sensitive FS
    }
    // Exact-case match always works.
    expect(findByRoot("F:/Git/Personal/proj")?.port).toBe(6120);
  });

  it("returns null when no live entry serves the root", () => {
    registerConsole(makeEntry(6120, "F:/p/a"));
    expect(findByRoot("F:/p/other")).toBeNull();
  });
});

// ── atomic writes — no torn/partial ports.json or registry entry ──────────────

describe("atomic writes", () => {
  it("writes valid JSON with no leftover .tmp files", () => {
    registerConsole(makeEntry(6120, "F:/p/a"));
    assignPort("F:/p/b"); // writes ports.json

    // Registry entry parses cleanly.
    const raw = readFileSync(join(registryDir(), "6120.json"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();

    // No tmp leftovers in either dir.
    expect(strayTmp(registryDir())).toEqual([]);
    expect(strayTmp(stateDir)).toEqual([]);
  });
});
