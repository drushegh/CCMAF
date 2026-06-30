/**
 * hub.test.ts — Hub state logic (TASK-043)
 *
 * The tray itself is now a thin launcher (Open Hub / Quit Hub) and the Hub UI is a
 * console-served window, so the testable logic lives in hub-state.ts: deriving the
 * stopped-projects list and assembling the flyout state. (The tray's icon/menu is
 * interactive and verified by running it.)
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const created: string[] = [];
function freshStateDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ccmaf-hubstate-"));
  created.push(d);
  process.env.CCMAF_CONSOLE_STATE_DIR = d;
  return d;
}

const { computeStopped, readHubState } = await import("../src/server/hub/hub-state.js");
const { registerConsole, assignPort } = await import("../src/server/hub/registry.js");

beforeEach(() => {
  freshStateDir();
});

afterAll(() => {
  delete process.env.CCMAF_CONSOLE_STATE_DIR;
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

describe("computeStopped", () => {
  it("returns known projects that are NOT currently running (rootPath match)", () => {
    const running = [{ rootPath: "F:/p/alpha" }];
    const known = [
      { rootPath: "F:/p/alpha", pinnedPort: 6120 }, // running → excluded
      { rootPath: "F:/p/beta", pinnedPort: 6121 }, // stopped → kept
    ];
    expect(computeStopped(running, known).map((s) => s.rootPath)).toEqual([
      "F:/p/beta",
    ]);
  });
});

describe("readHubState", () => {
  it("empty registry → no running, settings defaults", () => {
    const s = readHubState();
    expect(s.running).toEqual([]);
    expect(s.settings.openMode).toBe("default");
  });

  it("a registered console appears in running (no shutdownToken leaked)", () => {
    registerConsole({
      schemaVersion: 1,
      project: "alpha",
      rootPath: "F:/p/alpha",
      port: 6120,
      pid: 1,
      version: "0.1.0",
      startedAt: "2026-06-29T00:00:00Z",
      shutdownToken: "secret",
      autoStart: true,
    });
    const s = readHubState();
    expect(s.running).toEqual([
      { project: "alpha", port: 6120, rootPath: "F:/p/alpha" },
    ]);
    expect(JSON.stringify(s.running)).not.toContain("secret");
  });

  it("a known-but-not-running project shows up in stopped", () => {
    assignPort("F:/p/beta", 6120, 80); // remember it in ports.json
    const s = readHubState();
    // rootPath is resolved (OS separators), so match on the derived project name.
    expect(s.stopped.some((x) => x.project === "beta")).toBe(true);
  });
});
