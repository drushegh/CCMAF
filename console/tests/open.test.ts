/**
 * open.test.ts — open-mode selection logic (TASK-040)
 *
 * chooseOpener is pure (exists + chromium are injectable), so we test the
 * decision without spawning a browser.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import { chooseOpener } from "../src/server/hub/open.js";
import type { ConsoleSettings } from "../src/server/hub/settings.js";

const base: ConsoleSettings = {
  openMode: "default",
  autoOpenOnStart: false,
  windowStyle: "single",
};
const noChromium = () => null;
const chromium = () => "C:/Chrome/chrome.exe";
const noFiles = () => false;
const allFiles = () => true;

describe("chooseOpener", () => {
  it("default → default browser", () => {
    expect(chooseOpener(base, noFiles, chromium)).toEqual({
      method: "default-browser",
    });
  });

  it("app + chromium found → chromeless with that exe", () => {
    expect(chooseOpener({ ...base, openMode: "app" }, noFiles, chromium)).toEqual({
      method: "chromeless",
      exe: "C:/Chrome/chrome.exe",
    });
  });

  it("app + no chromium → falls back to default browser", () => {
    expect(chooseOpener({ ...base, openMode: "app" }, noFiles, noChromium)).toEqual({
      method: "default-browser",
    });
  });

  it("custom + path exists → chromeless with the custom exe", () => {
    expect(
      chooseOpener(
        { ...base, openMode: "custom", customBrowser: "C:/Brave/brave.exe" },
        allFiles,
        noChromium,
      ),
    ).toEqual({ method: "chromeless", exe: "C:/Brave/brave.exe" });
  });

  it("custom + path missing → falls back to default browser", () => {
    expect(
      chooseOpener(
        { ...base, openMode: "custom", customBrowser: "C:/gone.exe" },
        noFiles,
        noChromium,
      ),
    ).toEqual({ method: "default-browser" });
  });
});
