/**
 * open.ts — open a console URL per the user's open-mode (TASK-040)
 *
 *   "default" → OS default browser
 *   "app"     → chromeless Chromium (Chrome/Edge) --app window; falls back to the
 *               default browser if no Chromium is found
 *   "custom"  → a specific browser exe (settings.customBrowser), --app if it's
 *               Chromium-like; falls back to default if the path is missing
 *
 * Chromium discovery is ported from the legacy tray's browser-opener (that tray
 * retires once the Hub supersedes it). Pure selection logic (chooseOpener) is
 * separated so it unit-tests without spawning anything.
 */

import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { userStateDir } from "./registry.js";
import type { ConsoleSettings } from "./settings.js";

/** Ordered Chrome/Edge candidates (Windows only; [] elsewhere → default browser). */
export function chromiumCandidates(): string[] {
  if (os.platform() !== "win32") return [];
  const pf = process.env["ProgramFiles"] ?? "C:\\Program Files";
  const pfx = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const lad = process.env["LOCALAPPDATA"] ?? "";
  return [
    `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pfx}\\Google\\Chrome\\Application\\chrome.exe`,
    `${lad}\\Google\\Chrome\\Application\\chrome.exe`,
    `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${pfx}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ].filter(Boolean);
}

function findChromiumExe(candidates = chromiumCandidates()): string | null {
  return candidates.find((c) => existsSync(c)) ?? null;
}

export type OpenPlan =
  | { method: "chromeless"; exe: string }
  | { method: "default-browser" };

/**
 * Decide HOW to open, given the settings + which exes exist (injectable for
 * tests). Pure — no spawning.
 */
export function chooseOpener(
  settings: ConsoleSettings,
  exists: (p: string) => boolean = existsSync,
  chromium: () => string | null = () => findChromiumExe(),
): OpenPlan {
  if (settings.openMode === "custom" && settings.customBrowser) {
    if (exists(settings.customBrowser)) {
      return { method: "chromeless", exe: settings.customBrowser };
    }
    // custom path gone → fall through to default
  }
  if (settings.openMode === "app") {
    const exe = chromium();
    if (exe) return { method: "chromeless", exe };
  }
  return { method: "default-browser" };
}

function spawnDetached(cmd: string, args: string[]): void {
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
}

/** Open OS default browser (platform dispatch). */
function openDefaultBrowser(url: string): void {
  if (os.platform() === "win32") spawnDetached("cmd", ["/c", "start", "", url]);
  else if (os.platform() === "darwin") spawnDetached("open", [url]);
  else spawnDetached("xdg-open", [url]);
}

/**
 * The bottom-right corner of the primary monitor's WORK AREA (excludes the
 * taskbar) for a `width`×`height` window — i.e. "near the system tray". Windows
 * only (via PowerShell); returns null elsewhere or on any failure, so callers
 * just skip positioning and let the window centre.
 */
export function bottomRightPosition(
  width: number,
  height: number,
  margin = 12,
): { x: number; y: number } | null {
  if (os.platform() !== "win32") return null;
  try {
    const out = execSync(
      "powershell -NoProfile -NonInteractive -Command " +
        "\"Add-Type -AssemblyName System.Windows.Forms; " +
        "$w=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; " +
        "Write-Output ($w.Right.ToString()+','+$w.Bottom.ToString())\"",
      { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const [right, bottom] = out.split(",").map((n) => parseInt(n, 10));
    if (!Number.isFinite(right) || !Number.isFinite(bottom)) return null;
    return {
      x: Math.max(0, right - width - margin),
      y: Math.max(0, bottom - height - margin),
    };
  } catch {
    return null;
  }
}

/**
 * Open `url` in a SMALL chromeless window (the Hub flyout) — independent of the
 * user's open-mode, since the panel always wants a compact, positioned window.
 * `position` (optional) places it (e.g. near the tray).
 *
 * KEY: a dedicated `--user-data-dir` so the window launches as its OWN Chrome
 * process. `--window-size`/`--window-position` are honoured only by a fresh
 * browser process — if the user's main Chrome/Edge is already running, a plain
 * `--app` reuses it and IGNORES both flags (verified: the flyout opened
 * centre-screen at the wrong size). An isolated profile forces a new process, so
 * the size + bottom-right position actually stick. Falls back to the default
 * browser when no Chromium is found.
 */
export function openSizedWindow(
  url: string,
  width: number,
  height: number,
  position?: { x: number; y: number } | null,
): OpenPlan {
  const exe = findChromiumExe();
  if (exe) {
    // NO --new-window: with a dedicated profile, re-launching the SAME url FOCUSES
    // the existing window instead of spawning a duplicate (single-instance flyout).
    const args = [
      `--app=${url}`,
      `--user-data-dir=${join(userStateDir(), "window-profile")}`,
      "--no-first-run",
      "--no-default-browser-check",
      `--window-size=${width},${height}`,
    ];
    if (position) args.push(`--window-position=${position.x},${position.y}`);
    spawnDetached(exe, args);
    return { method: "chromeless", exe };
  }
  openDefaultBrowser(url);
  return { method: "default-browser" };
}

/**
 * Open `url` per `settings`. Chromeless windows go through a dedicated profile with
 * NO --new-window, so they're **per-URL singletons**: re-opening the same console
 * (or the one tabbed `/shell`) focuses the existing window instead of stacking
 * duplicates; a different console URL still gets its own window.
 */
export function openConsoleUrl(url: string, settings: ConsoleSettings): OpenPlan {
  const plan = chooseOpener(settings);
  if (plan.method === "chromeless") {
    spawnDetached(plan.exe, [
      `--app=${url}`,
      `--user-data-dir=${join(userStateDir(), "cockpit-profile")}`,
      "--no-first-run",
      "--no-default-browser-check",
    ]);
    return plan;
  }
  openDefaultBrowser(url);
  return { method: "default-browser" };
}
