/**
 * settings.ts — Hub/open settings, stored per-user next to the registry (TASK-040)
 *
 *   <userStateDir>/settings.json
 *
 * Consumed by the launcher's open path + the Hub's Open action + its Settings
 * submenu. Graceful: a missing/!malformed file → defaults; writes merge over the
 * current values so a partial patch (one toggle) never drops the rest.
 */

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { userStateDir } from "./registry.js";

/** How the cockpit opens. */
export type OpenMode =
  | "default" // OS default browser
  | "app" // chromeless Chromium --app window (best cockpit feel; Harvey-ish)
  | "custom"; // a specific browser exe (settings.customBrowser)

/** How multiple consoles present (TASK-041 uses `tabbed`). */
export type WindowStyle = "single" | "tabbed";

export interface ConsoleSettings {
  openMode: OpenMode;
  /** Absolute exe path for openMode "custom" (set by editing settings.json). */
  customBrowser?: string;
  /** Whether `console start` also opens the cockpit (default off → tray only). */
  autoOpenOnStart: boolean;
  /** Single window per console, or one tabbed shell window (TASK-041). */
  windowStyle: WindowStyle;
}

export const DEFAULT_SETTINGS: ConsoleSettings = {
  openMode: "default",
  autoOpenOnStart: false,
  windowStyle: "single",
};

function settingsPath(): string {
  return join(userStateDir(), "settings.json");
}

const OPEN_MODES: OpenMode[] = ["default", "app", "custom"];
const WINDOW_STYLES: WindowStyle[] = ["single", "tabbed"];

/** Coerce arbitrary JSON into a valid ConsoleSettings (defaults for bad fields). */
export function normalizeSettings(raw: unknown): ConsoleSettings {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const openMode = OPEN_MODES.includes(o.openMode as OpenMode)
    ? (o.openMode as OpenMode)
    : DEFAULT_SETTINGS.openMode;
  const windowStyle = WINDOW_STYLES.includes(o.windowStyle as WindowStyle)
    ? (o.windowStyle as WindowStyle)
    : DEFAULT_SETTINGS.windowStyle;
  return {
    openMode,
    windowStyle,
    autoOpenOnStart:
      typeof o.autoOpenOnStart === "boolean"
        ? o.autoOpenOnStart
        : DEFAULT_SETTINGS.autoOpenOnStart,
    ...(typeof o.customBrowser === "string" && o.customBrowser
      ? { customBrowser: o.customBrowser }
      : {}),
  };
}

/** Read settings (defaults when absent/malformed). */
export function readSettings(): ConsoleSettings {
  if (!existsSync(settingsPath())) return { ...DEFAULT_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(readFileSync(settingsPath(), "utf8")));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Merge a partial patch over current settings and persist; returns the result. */
export function writeSettings(patch: Partial<ConsoleSettings>): ConsoleSettings {
  const next = normalizeSettings({ ...readSettings(), ...patch });
  mkdirSync(userStateDir(), { recursive: true });
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}
