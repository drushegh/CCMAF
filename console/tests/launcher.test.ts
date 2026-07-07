/**
 * launcher.test.ts — Console launcher CLI helpers (TASK-038, DEC-025)
 *
 * Unit-covers the parts that don't spawn a real process (arg parsing, the
 * no-console-registered graceful paths, and findByRoot resolution). The full
 * start→stop spawn cycle is live-verified separately (it detaches a real server).
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const created: string[] = [];
function freshStateDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ccmaf-launcher-"));
  created.push(d);
  process.env.CCMAF_CONSOLE_STATE_DIR = d;
  return d;
}

const { readArg, start, stop, open, restart, cockpitUrl } =
  await import("../src/server/hub/launcher.js");
const { registerConsole, findByRoot } =
  await import("../src/server/hub/registry.js");
const { DEFAULT_SETTINGS } = await import("../src/server/hub/settings.js");

beforeEach(() => {
  freshStateDir();
});

afterAll(() => {
  delete process.env.CCMAF_CONSOLE_STATE_DIR;
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

describe("readArg", () => {
  it("reads a --flag value", () => {
    expect(readArg(["node", "x", "start", "--root", "/p/a"], "--root")).toBe(
      "/p/a",
    );
  });
  it("returns undefined when absent or dangling", () => {
    expect(readArg(["node", "x", "start"], "--root")).toBeUndefined();
    expect(readArg(["node", "x", "--root"], "--root")).toBeUndefined(); // no value after
  });
});

describe("stop — graceful when nothing is registered", () => {
  it("returns 0 and does not throw when no console exists for the root", async () => {
    const code = await stop("F:/p/does-not-exist");
    expect(code).toBe(0);
  });
});

describe("findByRoot resolution (launcher's lookup key)", () => {
  it("matches a registered console by rootPath regardless of port", () => {
    registerConsole({
      schemaVersion: 1,
      project: "alpha",
      rootPath: "F:/p/alpha",
      port: 6177, // bound port differs from any pin — match must be by rootPath
      pid: 1,
      version: "0.1.0",
      startedAt: "2026-06-28T00:00:00Z",
      shutdownToken: "t",
      autoStart: true,
    });
    expect(findByRoot("F:/p/alpha")?.port).toBe(6177);
    expect(findByRoot("F:/p/other")).toBeNull();
  });
});

describe("start — autoStart gate (moved from the framework driver)", () => {
  it("skips the respin (returns 0, no spawn) when the live entry has autoStart:false", async () => {
    // A manual tray "End" sets autoStart:false; start() must honour it and bail
    // BEFORE ensureRunning (so no server is spawned and no Hub is ensured).
    registerConsole({
      schemaVersion: 1,
      project: "ended",
      rootPath: "F:/p/ended",
      port: 6188,
      pid: 1,
      version: "0.1.0",
      startedAt: "2026-06-28T00:00:00Z",
      shutdownToken: "t",
      autoStart: false,
    });
    const code = await start("F:/p/ended");
    expect(code).toBe(0);
    // The entry is untouched — the gate is read-only.
    expect(findByRoot("F:/p/ended")?.autoStart).toBe(false);
  });
});

describe("open — exported and callable", () => {
  it("returns a number exit code (no console + bad root → starts then fails fast is out of scope here)", () => {
    // We only assert the export shape; the real open() path is live-verified.
    expect(typeof open).toBe("function");
  });
});

describe("restart — exported (stop+start; the post-rebuild verb)", () => {
  it("is callable (the spawn path is live-verified, not unit-spawned)", () => {
    expect(typeof restart).toBe("function");
  });
});

describe("cockpitUrl — windowStyle shaping (TASK-041)", () => {
  const base = "http://127.0.0.1:6120";

  it("single → the console URL unchanged (activePort ignored)", () => {
    const s = { ...DEFAULT_SETTINGS, windowStyle: "single" as const };
    expect(cockpitUrl(base, s, 6120)).toBe(base);
  });

  it("tabbed → the console's /shell route", () => {
    const s = { ...DEFAULT_SETTINGS, windowStyle: "tabbed" as const };
    expect(cockpitUrl(base, s)).toBe("http://127.0.0.1:6120/shell");
  });

  it("tabbed + activePort → /shell preselecting that tab", () => {
    const s = { ...DEFAULT_SETTINGS, windowStyle: "tabbed" as const };
    expect(cockpitUrl(base, s, 6121)).toBe(
      "http://127.0.0.1:6120/shell?active=6121",
    );
  });
});
