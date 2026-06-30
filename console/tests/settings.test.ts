/**
 * settings.test.ts — Hub/open settings store (TASK-040)
 * @vitest-environment node
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const created: string[] = [];
function freshStateDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ccmaf-settings-"));
  created.push(d);
  process.env.CCMAF_CONSOLE_STATE_DIR = d;
  return d;
}

const { readSettings, writeSettings, normalizeSettings, DEFAULT_SETTINGS } =
  await import("../src/server/hub/settings.js");

let dir = "";
beforeEach(() => {
  dir = freshStateDir();
});
afterAll(() => {
  delete process.env.CCMAF_CONSOLE_STATE_DIR;
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

describe("normalizeSettings", () => {
  it("falls back to defaults for missing/invalid fields", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ openMode: "bogus", windowStyle: 9 })).toEqual(
      DEFAULT_SETTINGS,
    );
  });
  it("keeps valid values + customBrowser only when a non-empty string", () => {
    const s = normalizeSettings({
      openMode: "app",
      autoOpenOnStart: true,
      windowStyle: "tabbed",
      customBrowser: "C:/x/chrome.exe",
    });
    expect(s).toEqual({
      openMode: "app",
      autoOpenOnStart: true,
      windowStyle: "tabbed",
      customBrowser: "C:/x/chrome.exe",
    });
    expect("customBrowser" in normalizeSettings({ customBrowser: "" })).toBe(false);
  });
});

describe("readSettings / writeSettings", () => {
  it("defaults when no file exists", () => {
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("round-trips, and a partial patch preserves other fields", () => {
    writeSettings({ openMode: "app" });
    expect(readSettings().openMode).toBe("app");
    writeSettings({ autoOpenOnStart: true });
    const s = readSettings();
    expect(s.openMode).toBe("app"); // preserved
    expect(s.autoOpenOnStart).toBe(true);
  });
  it("recovers from a malformed file → defaults", () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "settings.json"), "{ not json", "utf8");
    expect(readSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
