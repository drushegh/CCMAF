#!/usr/bin/env node
/**
 * console.mjs — the framework's handle on the Project Console (cross-platform).
 *
 * In this consolidated repo the Console is BUNDLED at `console/` (its own source root).
 * The Console ships its own launcher CLI (`start | stop | open | restart`); this script is
 * a thin DRIVER: it (1) ensures the bundled Console is built (in place, first run only),
 * then (2) invokes the Console's launcher for THIS project. Shell-agnostic (PowerShell,
 * cmd, bash):
 *
 *   node tools/console.mjs start     # cold-start: ensure up, print URL (idempotent)
 *   node tools/console.mjs stop      # /wrapup:   graceful teardown of this project's console
 *   node tools/console.mjs open      # open it (browser per settings)
 *   node tools/console.mjs restart   # stop then start fresh — use after a Console version bump
 *
 * No verb defaults to `start`. The launcher resolves the live port from the per-user
 * registry by rootPath, spawns the server DETACHED, and prints `http://127.0.0.1:<port>`.
 *
 * Opt-in: a project declares it wants the Console with `.claude/.console-version` (presence =
 * opted in). The legacy boolean `.claude/.console-enabled` is still honored. Cold-start /
 * /wrapup gate on opt-in; this driver does NOT (callers gate). `stop` is a no-op when the
 * Console isn't built, so it's always safe to call.
 *
 * Reaper enable: the Console's mtime self-reaper activates ONLY when `CONSOLE_REAP_GRACE_MIN`
 * is in the server's env. The launcher forwards its env to the spawned server, so on
 * start/open/restart this driver sets CONSOLE_REAP_GRACE_MIN (default 60) — exactly when the
 * framework's console-heartbeat hook is keeping the registry mtime fresh.
 *
 * Config (env — all optional):
 *   CONSOLE_DIR             use a Console source dir OTHER than the bundled <repo>/console
 *                           (e.g. a separate dev checkout). Explicit override only.
 *   CONSOLE_REAP_GRACE_MIN  reaper grace minutes set on start/open/restart (default 60)
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, platform } from "node:os";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const VERB = (process.argv[2] || "start").toLowerCase();
const log = (m) => console.error(`console.mjs: ${m}`); // stderr so stdout stays URL-only
const die = (m) => {
  console.error(`console.mjs: ${m}`);
  process.exit(1);
};
function must(cmd, args, opts = {}) {
  // npm is npm.cmd on Windows → shell:true.
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", ...opts });
  if (r.error) die(`could not run \`${cmd}\` — installed/on PATH? (${r.error.message})`);
  if (r.status !== 0) die(`\`${cmd} ${args.join(" ")}\` failed (exit ${r.status}).`);
}

if (!["start", "stop", "open", "restart"].includes(VERB)) {
  die(`unknown verb "${VERB}" — usage: node tools/console.mjs <start|stop|open|restart>`);
}

// Per-user Console state dir — mirrors the Console's registry.js userStateDir() so the
// framework and Console agree on where the registry lives.
function userStateDir() {
  if (process.env.CCMAF_CONSOLE_STATE_DIR) return resolve(process.env.CCMAF_CONSOLE_STATE_DIR);
  const home = homedir();
  switch (platform()) {
    case "win32":
      return join(process.env.LOCALAPPDATA || join(home, "AppData", "Local"), "ccmaf-console");
    case "darwin":
      return join(home, "Library", "Application Support", "ccmaf-console");
    default:
      return join(process.env.XDG_STATE_HOME || join(home, ".local", "state"), "ccmaf-console");
  }
}

// The live registry entry for this project, matched by rootPath EXACTLY as the Console's
// findByRoot does (resolve()-equality) so both sides agree. null if none.
function findEntryByRoot(root) {
  const dir = join(userStateDir(), "registry");
  if (!existsSync(dir)) return null;
  const want = resolve(root);
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return null;
  }
  for (const f of files) {
    try {
      const e = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (e && typeof e.rootPath === "string" && resolve(e.rootPath) === want) return e;
    } catch {
      /* skip malformed */
    }
  }
  return null;
}

// The bundled Console source dir (or a CONSOLE_DIR override). No clone — it ships in-repo.
function resolveConsoleDir() {
  if (process.env.CONSOLE_DIR) {
    log(`using Console at CONSOLE_DIR=${process.env.CONSOLE_DIR} (override)`);
    return resolve(process.env.CONSOLE_DIR);
  }
  return join(REPO_ROOT, "console");
}

// Build the bundled Console in place if the launcher/server artefacts are absent (first run
// only — slow). Build steps match console/README.md.
function ensureBuilt(consoleDir) {
  if (!existsSync(join(consoleDir, "package.json")))
    die(
      `no bundled Console at ${consoleDir} — expected it at <repo>/console/. ` +
        `Set CONSOLE_DIR to a Console checkout, or restore the console/ directory.`
    );
  const launcher = join(consoleDir, "dist-server", "hub", "launcher.js");
  const serverMain = join(consoleDir, "dist-server", "main.js");
  if (!existsSync(launcher) || !existsSync(serverMain)) {
    log("building the bundled Console (npm install && npm run build && npm run build:server) — first run only…");
    must("npm", ["install"], { cwd: consoleDir });
    must("npm", ["run", "build"], { cwd: consoleDir });
    must("npm", ["run", "build:server"], { cwd: consoleDir });
  }
  if (!existsSync(launcher)) die(`Console built but no launcher at ${launcher} — the bundle may be incomplete.`);
  return launcher;
}

// --- autoStart gate: a manual tray "End" sets autoStart:false to suppress the cold-start
// respin until the next explicit Start. `start` honours it; open/restart/stop do not.
if (VERB === "start") {
  const entry = findEntryByRoot(REPO_ROOT);
  if (entry && entry.autoStart === false) {
    log(`start: autoStart is false for this project (manual tray End) — skipping respin`);
    process.exit(0);
  }
}

// --- resolve + (for non-stop) build ------------------------------------------------------
const consoleDir = resolveConsoleDir();
let launcher;
if (VERB === "stop") {
  // stop must never build — if it isn't built, nothing is running to stop.
  launcher = join(consoleDir, "dist-server", "hub", "launcher.js");
  if (!existsSync(launcher)) {
    log("stop: no built Console present — nothing to stop");
    process.exit(0);
  }
} else {
  launcher = ensureBuilt(consoleDir);
}

// Env for the launcher → it forwards to the spawned server. Setting CONSOLE_REAP_GRACE_MIN
// on start/open/restart is what enables the Console's self-reaper.
const childEnv = { ...process.env };
if (VERB !== "stop") {
  childEnv.CONSOLE_REAP_GRACE_MIN = process.env.CONSOLE_REAP_GRACE_MIN || "60";
}

log(`${VERB} → ${launcher} --root ${REPO_ROOT}`);
const r = spawnSync(process.execPath, [launcher, VERB, "--root", REPO_ROOT], {
  stdio: "inherit", // launcher prints the URL to stdout; we relay it verbatim
  env: childEnv,
});
if (r.error) die(`could not run the Console launcher (${r.error.message})`);
process.exit(r.status ?? 0);
