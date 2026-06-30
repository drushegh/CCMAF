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
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
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
  registerConsole,
  deregisterConsole,
  readRegistry,
  readEntry,
  setAutoStart,
  assignPort,
  entryMtimeMs,
  isHeartbeatStale,
} = await import("../src/server/hub/registry.js");

function makeEntry(port: number, root: string, over: Record<string, unknown> = {}) {
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
});
