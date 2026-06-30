/**
 * registry.ts — per-user Console registry + pinned ports (TASK-037, DEC-025)
 *
 * The consolidated tray Hub discovers running consoles by reading a per-user,
 * machine-global directory — NOT any project's `.claude/` (a console is per
 * project, but the registry spans all of them). File-is-truth (DEC-002):
 *
 *   <userStateDir>/registry/<port>.json   one LIVE console (written on start,
 *                                          deleted on graceful exit)
 *   <userStateDir>/ports.json             rootPath → pinned port (assign + remember)
 *   <userStateDir>/settings.json          Hub/open settings (TASK-040)
 *
 * Everything here is pure + dependency-free so it unit-tests in isolation; set
 * CCMAF_CONSOLE_STATE_DIR to point the whole tree at a temp dir.
 */

import { resolve, join, basename } from "node:path";
import { homedir, platform } from "node:os";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  statSync,
} from "node:fs";

/** One live console, as written to `registry/<port>.json`. */
export interface RegistryEntry {
  schemaVersion: 1;
  /** Display name — basename of rootPath. */
  project: string;
  /** Absolute project root the console serves. */
  rootPath: string;
  /** Bound loopback port (the registry key). */
  port: number;
  /** OS pid of the server process (force-kill fallback). */
  pid: number;
  version: string;
  /** ISO-8601 start time. */
  startedAt: string;
  /** Secret the Hub/launcher presents to POST /api/shutdown. */
  shutdownToken: string;
  /** false after a manual tray "End" → the framework cold-start skips respin. */
  autoStart: boolean;
}

const APP_DIR = "ccmaf-console";

/**
 * Per-user, machine-global state dir. `CCMAF_CONSOLE_STATE_DIR` overrides it
 * (tests + power users). Platform defaults: Windows `%LOCALAPPDATA%`, macOS
 * `~/Library/Application Support`, Linux `$XDG_STATE_HOME` or `~/.local/state`.
 */
export function userStateDir(): string {
  const override = process.env.CCMAF_CONSOLE_STATE_DIR;
  if (override) return resolve(override);
  const home = homedir();
  switch (platform()) {
    case "win32":
      return join(
        process.env.LOCALAPPDATA || join(home, "AppData", "Local"),
        APP_DIR,
      );
    case "darwin":
      return join(home, "Library", "Application Support", APP_DIR);
    default:
      return join(
        process.env.XDG_STATE_HOME || join(home, ".local", "state"),
        APP_DIR,
      );
  }
}

export function registryDir(): string {
  return join(userStateDir(), "registry");
}

function portsFile(): string {
  return join(userStateDir(), "ports.json");
}

function entryPath(port: number): string {
  return join(registryDir(), `${port}.json`);
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Display name for a project root (basename, with a sane fallback). */
export function projectName(rootPath: string): string {
  return basename(resolve(rootPath)) || rootPath;
}

// ── Registry entries ────────────────────────────────────────────────────────

/** Write (or overwrite) this console's registry entry. */
export function registerConsole(entry: RegistryEntry): void {
  ensureDir(registryDir());
  writeFileSync(entryPath(entry.port), JSON.stringify(entry, null, 2), "utf8");
}

/** Remove a console's registry entry (graceful exit / tray End). Idempotent. */
export function deregisterConsole(port: number): void {
  try {
    unlinkSync(entryPath(port));
  } catch {
    /* already gone */
  }
}

/** All live entries, malformed files skipped, sorted by port. */
export function readRegistry(): RegistryEntry[] {
  const dir = registryDir();
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: RegistryEntry[] = [];
  for (const f of files) {
    try {
      const e = JSON.parse(readFileSync(join(dir, f), "utf8")) as RegistryEntry;
      if (e && typeof e.port === "number" && typeof e.rootPath === "string") {
        out.push(e);
      }
    } catch {
      /* skip malformed */
    }
  }
  return out.sort((a, b) => a.port - b.port);
}

/** The live entry whose rootPath matches `rootPath` (null if none). Used by the
 *  launcher (`stop`/`open`) + Hub to find a project's console regardless of which
 *  port it actually bound (the pin can differ from the bound port on fallback). */
export function findByRoot(rootPath: string): RegistryEntry | null {
  const want = resolve(rootPath);
  return readRegistry().find((e) => resolve(e.rootPath) === want) ?? null;
}

/** Read one entry by port (null if absent/malformed). */
export function readEntry(port: number): RegistryEntry | null {
  try {
    const e = JSON.parse(readFileSync(entryPath(port), "utf8")) as RegistryEntry;
    return e && typeof e.port === "number" ? e : null;
  } catch {
    return null;
  }
}

/**
 * Last-modified time (ms) of a console's registry file — the heartbeat signal.
 * The framework `touch`es this file on session activity (mtime only; it never
 * rewrites the Console-owned JSON). Returns null if the file is absent.
 */
export function entryMtimeMs(port: number): number | null {
  try {
    return statSync(entryPath(port)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Reaper predicate (pure): the console should reap when its heartbeat is gone.
 * `mtimeMs === null` (registry file deleted → orphaned from the Hub) OR stale
 * past the grace window both mean reap.
 */
export function isHeartbeatStale(
  mtimeMs: number | null,
  graceMs: number,
  now: number,
): boolean {
  return mtimeMs === null || now - mtimeMs > graceMs;
}

/** Flip autoStart on a live entry (tray End → suppress framework respin). */
export function setAutoStart(port: number, autoStart: boolean): void {
  const e = readEntry(port);
  if (!e) return;
  e.autoStart = autoStart;
  writeFileSync(entryPath(port), JSON.stringify(e, null, 2), "utf8");
}

// ── ports.json: assign-and-remember ─────────────────────────────────────────

function readPorts(): Record<string, number> {
  if (!existsSync(portsFile())) return {};
  try {
    const obj = JSON.parse(readFileSync(portsFile(), "utf8")) as Record<
      string,
      number
    >;
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function writePorts(map: Record<string, number>): void {
  ensureDir(userStateDir());
  writeFileSync(portsFile(), JSON.stringify(map, null, 2), "utf8");
}

/**
 * Every project root the machine has ever assigned a port to (from ports.json) —
 * the "known projects" list, used by the Hub to offer Start for a project that
 * isn't currently running. (A running project is found via the registry instead.)
 */
export function knownProjects(): { rootPath: string; pinnedPort: number }[] {
  return Object.entries(readPorts()).map(([rootPath, pinnedPort]) => ({
    rootPath,
    pinnedPort,
  }));
}

/**
 * The pinned port for a project root: return the remembered one, else assign the
 * next port not already remembered (within [base, base+range)) and persist it.
 * Stable across restarts → bookmarkable; human-editable in ports.json. The
 * ACTUAL bound port can still differ if the pinned one is taken at bind time —
 * the server records the real port in the registry.
 */
export function assignPort(rootPath: string, base = 6120, range = 80): number {
  const key = resolve(rootPath);
  const map = readPorts();
  if (typeof map[key] === "number") return map[key];
  const used = new Set(Object.values(map));
  let port = base;
  while (used.has(port) && port < base + range) port++;
  map[key] = port;
  writePorts(map);
  return port;
}
