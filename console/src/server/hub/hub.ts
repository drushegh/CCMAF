/**
 * hub.ts — the machine-global tray launcher (TASK-039 → reshaped by TASK-043, DEC-028)
 *
 * ONE tray icon. Its menu is intentionally minimal — **Open Hub** + **Quit Hub** —
 * because the actual Hub UI (running consoles + Start/Open/End + settings) is now a
 * small console-served window (`GET /hub`) the tray opens, NOT a native menu (native
 * menus can't show good state or rich controls; the author wanted a flyout-style
 * panel). "Open Hub" opens that window (chromeless, positioned near the tray);
 * everything else happens inside it via /api/hub/* + /api/settings.
 *
 * The tray still owns: the singleton (pid lockfile — Windows reserves shifting port
 * blocks, so a fixed lock port is unreliable), the registry health-prune (so a dead
 * console can't be "opened"), and auto-exit once no console runs.
 *
 * Run: `node dist-server/hub/hub-main.js` (npm `hub`).
 */

import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { Menu, MenuItem, ClickEvent } from "systray2";

import { TRAY_ICON_BASE64 } from "./icon.js";
import { openSizedWindow, bottomRightPosition } from "./open.js";
import {
  readRegistry,
  deregisterConsole,
  userStateDir,
  type RegistryEntry,
} from "./registry.js";

// ── CJS interop for systray2 (same pattern as the legacy tray) ────────────────
const require = createRequire(import.meta.url);
const SysTrayModule = require("systray2") as {
  default: {
    new (conf: { menu: Menu; debug?: boolean; copyDir?: boolean | string }): {
      ready(): Promise<void>;
      onClick(listener: (action: ClickEvent) => void): Promise<unknown>;
      sendAction(action: { type: "update-menu"; menu: Menu }): Promise<unknown>;
      kill(exitNode?: boolean): Promise<void>;
      onError(listener: (err: Error) => void): void;
      onExit(listener: (code: number | null, signal: string | null) => void): void;
    };
    separator: MenuItem;
  };
};
const SysTray = SysTrayModule.default;

/** How often the tray re-checks the registry (auto-exit + Open-Hub enable/disable). */
const REFRESH_MS = 5000;
/** Flyout window size (small, tray-anchored). */
const HUB_W = 380;
const HUB_H = 600;

type HubKind = "open-hub" | "quit";
/** A menu item carrying the action kind (survives into onClick via Object.assign). */
type HubItem = MenuItem & { hubKind?: HubKind };

// ── Menu (static shape; only the header text + Open-Hub enabled state change) ──

function buildMenu(running: RegistryEntry[]): Menu {
  const n = running.length;
  const header: HubItem = {
    title: n ? `${n} console${n > 1 ? "s" : ""} running` : "No consoles running",
    tooltip: "Project Console Hub",
    enabled: false,
  };
  const openHub: HubItem = {
    title: "Open Hub",
    tooltip: n ? "Open the Hub window" : "Start a console first",
    enabled: n > 0,
    hubKind: "open-hub",
  };
  const quit: HubItem = {
    title: "Quit Hub",
    tooltip: "Stop the Hub tray (leaves running consoles up)",
    enabled: true,
    hubKind: "quit",
  };
  return {
    icon: TRAY_ICON_BASE64,
    title: "CCMAF Hub",
    tooltip: "Project Console Hub",
    items: [header, SysTray.separator, openHub, quit],
  };
}

// ── Health-prune (drop phantom entries) ───────────────────────────────────────
// A registry file is left behind when a server dies WITHOUT its graceful
// deregister (PC restart / hard kill). Health-check each + delete the dead ones,
// so "Open Hub" never targets a dead console.

async function isLive(port: number, rootPath: string): Promise<boolean> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!resp.ok) return false;
    const b = (await resp.json()) as { app?: string; projectRoot?: string };
    return b.app === "ccmaf-console" && resolve(b.projectRoot ?? "") === resolve(rootPath);
  } catch {
    return false;
  }
}

/**
 * Does this console serve the Hub flyout (`/hub`)? A mixed-build machine can have
 * older consoles WITHOUT the route (they'd serve the SPA fallback → a blank
 * window), so the Hub must open on a capable one. `/api/hub/state` exists only on
 * builds that have the flyout → a clean capability probe.
 */
async function isHubCapable(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/hub/state`, {
      signal: AbortSignal.timeout(2000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** Registry entries that actually answer health; stale files are pruned (deleted). */
async function readLiveConsoles(): Promise<RegistryEntry[]> {
  const entries = readRegistry();
  const checked = await Promise.all(
    entries.map(async (e) => ({ e, live: await isLive(e.port, e.rootPath) })),
  );
  const live: RegistryEntry[] = [];
  for (const { e, live: ok } of checked) {
    if (ok) live.push(e);
    else {
      console.log(`[hub] pruning stale entry :${e.port} (${e.project})`);
      deregisterConsole(e.port);
    }
  }
  return live.sort((a, b) => a.port - b.port);
}

// ── Singleton lock (pid-lockfile) ──────────────────────────────────────────────

function hubLockPath(): string {
  return join(userStateDir(), "hub.lock");
}

/** True if `pid` is a live process (ESRCH → dead; EPERM → alive but not ours). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function acquireSingleton(): boolean {
  const lock = hubLockPath();
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, "utf8").trim());
    if (Number.isFinite(pid) && pid !== process.pid && pidAlive(pid)) {
      return false; // another Hub is alive
    }
    // else: stale lock (dead pid) → take it over
  }
  mkdirSync(userStateDir(), { recursive: true });
  writeFileSync(lock, String(process.pid), "utf8");
  return true;
}

function releaseSingleton(): void {
  try {
    if (Number(readFileSync(hubLockPath(), "utf8").trim()) === process.pid) {
      unlinkSync(hubLockPath());
    }
  } catch {
    /* already gone */
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runHub(): Promise<void> {
  if (!acquireSingleton()) {
    console.log("[hub] another Hub is already running — exiting.");
    process.exit(0);
  }

  let hasSeen = false;
  // Remembered flyout host — keeping the /hub URL stable lets Chrome FOCUS the one
  // window (open.ts uses no --new-window) instead of opening a duplicate.
  let hubHost: number | null = null;
  // Prune BEFORE the first paint so a phantom never enables "Open Hub".
  let running = await readLiveConsoles();
  if (running.length > 0) hasSeen = true;

  const systray = new SysTray({
    menu: buildMenu(running),
    debug: false,
    copyDir: false,
  });
  await systray.ready();
  console.log(`[hub] tray active. "Open Hub" → the Hub window; refresh ${REFRESH_MS}ms.`);

  let lastSig = String(running.length);
  const rebuild = async (): Promise<void> => {
    running = await readLiveConsoles();
    const sig = String(running.length);
    if (sig !== lastSig) {
      lastSig = sig;
      await systray.sendAction({ type: "update-menu", menu: buildMenu(running) });
    }
    if (running.length > 0) hasSeen = true;
    else if (hasSeen) {
      console.log("[hub] no consoles left — exiting.");
      await systray.kill(false);
      releaseSingleton();
      process.exit(0);
    }
  };

  /** Open the Hub flyout on a /hub-CAPABLE console near the tray (single window). */
  const openHubWindow = async (): Promise<void> => {
    running = await readLiveConsoles();
    // Reuse the remembered host if it's still running + capable (stable URL → one
    // window); otherwise pick the first capable console.
    let host: number | null =
      hubHost != null &&
      running.some((e) => e.port === hubHost) &&
      (await isHubCapable(hubHost))
        ? hubHost
        : null;
    if (host == null) {
      for (const e of running) {
        if (await isHubCapable(e.port)) {
          host = e.port;
          break;
        }
      }
    }
    if (host == null) {
      console.log(
        "[hub] Open Hub: no console with the Hub UI is running " +
          "(an older build serves the SPA, not /hub — update/restart a console).",
      );
      return;
    }
    hubHost = host;
    openSizedWindow(
      `http://127.0.0.1:${host}/hub`,
      HUB_W,
      HUB_H,
      bottomRightPosition(HUB_W, HUB_H),
    );
    console.log(`[hub] Hub window opened on :${host}`);
  };

  await systray.onClick(async (action) => {
    const it = action.item as HubItem;
    switch (it.hubKind) {
      case "open-hub":
        await openHubWindow();
        break;
      case "quit":
        console.log("[hub] Quit — leaving consoles running.");
        await systray.kill(false);
        releaseSingleton();
        process.exit(0);
        break;
      default:
        break;
    }
  });

  const timer = setInterval(() => void rebuild(), REFRESH_MS);
  timer.unref();

  systray.onError((err) => console.error("[hub] systray error:", err));
  systray.onExit(() => releaseSingleton());
  process.on("exit", releaseSingleton);
  const bye = () => {
    releaseSingleton();
    process.exit(0);
  };
  process.on("SIGINT", bye);
  process.on("SIGTERM", bye);
}
