#!/usr/bin/env node
/**
 * console.mjs — the framework's handle on the Project Console (cross-platform).
 *
 * The Console is an INSTALLABLE npm package (`ccmaf-console`), delivered + self-updated
 * through npm — NOT bundled into the framework and NOT in framework-manifest.txt (TASK-072).
 * This script is a thin DRIVER: it resolves the installed Console CLI and invokes its
 * launcher verb for THIS project. Shell-agnostic (PowerShell, cmd, bash):
 *
 *   node tools/console.mjs start     # cold-start: ensure up, print URL (idempotent)
 *   node tools/console.mjs stop      # /wrapup:   graceful teardown of this project's console
 *   node tools/console.mjs open      # open it (browser per settings)
 *   node tools/console.mjs restart   # stop then start fresh — use after a Console version bump
 *
 * No verb defaults to `start`. The launcher resolves the live port from the per-user
 * registry by rootPath, spawns the server DETACHED, and prints `http://127.0.0.1:<port>`.
 *
 * Command resolution (first match wins). ccmaf-console is published to npm and
 * lives in its own repo (drushegh/console) — it is NOT bundled into any repo, so
 * there is no <repo>/console route: a global install or npx is how consumers get it.
 *   1. CONSOLE_DIR set         → node <CONSOLE_DIR>/dist-server/hub/launcher.js   (dev override;
 *                                build-in-place if the artefacts are absent)
 *   2. `ccmaf-console` on PATH → the global bin                                   (npm i -g)
 *   3. npx fallback            → npx -y ccmaf-console@<spec>                       (spec from
 *                                .claude/.console-version content, default "latest")
 *
 * The launcher (Console-owned) owns the autoStart-gate (honour a manual tray "End") AND
 * ensuring the machine-global tray Hub is up — this driver no longer duplicates either.
 *
 * Opt-in: a project declares it wants the Console with `.claude/.console-version` (presence =
 * opted in; content = npm version spec). The legacy boolean `.claude/.console-enabled` is
 * still honored (implies spec "latest"). Cold-start / /wrapup gate on opt-in; this driver
 * does NOT (callers gate). `stop` is a graceful no-op when nothing is running, so it's always
 * safe to call.
 *
 * Reaper enable: the Console's mtime self-reaper activates ONLY when `CONSOLE_REAP_GRACE_MIN`
 * is in the server's env. The launcher forwards its env to the spawned server, so on
 * start/open/restart this driver sets CONSOLE_REAP_GRACE_MIN (default 60) — exactly when the
 * framework's console-heartbeat hook is keeping the registry mtime fresh.
 *
 * Config (env — all optional):
 *   CONSOLE_DIR             use a Console source dir (dev checkout) instead of the installed
 *                           package. Explicit override only; built in place if needed.
 *   CONSOLE_REAP_GRACE_MIN  reaper grace minutes set on start/open/restart (default 60)
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";

const VERB = (process.argv[2] || "start").toLowerCase();
const log = (m) => console.error(`console.mjs: ${m}`); // stderr so stdout stays URL-only
const die = (m) => {
  console.error(`console.mjs: ${m}`);
  process.exit(1);
};
function must(cmd, args, opts = {}) {
  // npm is npm.cmd on Windows → shell:true.
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: WIN, ...opts });
  if (r.error) die(`could not run \`${cmd}\` — installed/on PATH? (${r.error.message})`);
  if (r.status !== 0) die(`\`${cmd} ${args.join(" ")}\` failed (exit ${r.status}).`);
}

if (!["start", "stop", "open", "restart"].includes(VERB)) {
  die(`unknown verb "${VERB}" — usage: node tools/console.mjs <start|stop|open|restart>`);
}

// True if `bin` is resolvable on PATH (win: `where`, else: `command -v`). shell:true so the
// win `where` shim + the POSIX `command` builtin both resolve.
function onPath(bin) {
  const r = spawnSync(WIN ? "where" : "command", WIN ? [bin] : ["-v", bin], {
    stdio: "ignore",
    shell: true,
  });
  return r.status === 0;
}

// A valid npm version spec: semver-ish plus the range operators (^ ~ < > =),
// wildcards (x/* via the char class), and "latest". Deliberately EXCLUDES
// whitespace and every shell metacharacter (& | ; ( ) $ ` ' " space) so a
// crafted `.console-version` (e.g. `latest && rm -rf …`) can NEVER reach the
// Windows shell route below — the injection vector in this driver.
const SPEC_RE = /^[A-Za-z0-9@^~<>=.+*_-]+$/;

// The npm version spec for the npx route: `.claude/.console-version` content (e.g. "latest",
// "0.2.x", "^0.3"). Empty / absent / legacy (.console-enabled only) / MALFORMED → "latest".
function versionSpec() {
  let s;
  try {
    s = readFileSync(join(REPO_ROOT, ".claude", ".console-version"), "utf8").trim();
  } catch {
    return "latest";
  }
  if (!s) return "latest";
  if (!SPEC_RE.test(s)) {
    log(`ignoring invalid .console-version spec ${JSON.stringify(s)} — using "latest".`);
    return "latest";
  }
  return s;
}

// Build the dev Console in place if the launcher/server artefacts are absent (first
// run only — slow). Route 1 (CONSOLE_DIR) only. Returns the launcher path.
function ensureBuilt(consoleDir) {
  if (!existsSync(join(consoleDir, "package.json")))
    die(`no Console at ${consoleDir} — expected a Console source dir with package.json.`);
  const launcher = join(consoleDir, "dist-server", "hub", "launcher.js");
  const serverMain = join(consoleDir, "dist-server", "main.js");
  if (!existsSync(launcher) || !existsSync(serverMain)) {
    log("building the Console (npm install && npm run build && npm run build:server) — first run only…");
    must("npm", ["install"], { cwd: consoleDir });
    must("npm", ["run", "build"], { cwd: consoleDir });
    must("npm", ["run", "build:server"], { cwd: consoleDir });
  }
  if (!existsSync(launcher)) die(`Console built but no launcher at ${launcher} — the bundle may be incomplete.`);
  return launcher;
}

// --- resolve the Console command (first match wins) --------------------------------------
// Returns either { kind:"dir", dir } (a Console source dir → run its launcher.js with node)
// or { kind:"bin", command, baseArgs, shell } (an installed CLI / npx). The launcher itself
// owns the autoStart-gate + ensureHub, so the driver only picks the command and relays IO.
function resolveConsoleCmd() {
  // 1. CONSOLE_DIR override (dev checkout).
  if (process.env.CONSOLE_DIR) {
    const dir = resolve(process.env.CONSOLE_DIR);
    log(`using Console at CONSOLE_DIR=${dir} (override)`);
    return { kind: "dir", dir };
  }
  // 2. global install on PATH.
  if (onPath("ccmaf-console")) {
    log("using ccmaf-console from PATH (global install)");
    return { kind: "bin", command: "ccmaf-console", baseArgs: [], shell: WIN };
  }
  // 3. npx fallback (spec from .console-version) — the default for consumers.
  //    ccmaf-console is published to npm and no longer bundled in any repo, so
  //    npx is the last resort after CONSOLE_DIR and a global install.
  if (onPath("npx")) {
    const spec = versionSpec();
    log(`using npx ccmaf-console@${spec} (npm fallback)`);
    return { kind: "bin", command: "npx", baseArgs: ["-y", `ccmaf-console@${spec}`], shell: WIN };
  }
  die(
    "no ccmaf-console found — install it (npm i -g ccmaf-console), set CONSOLE_DIR to a " +
      "Console checkout, or ensure npx is available.",
  );
}

const cmd = resolveConsoleCmd();
const verbArgs = [VERB, "--root", REPO_ROOT];

// Env for the launcher → it forwards to the spawned server. Setting CONSOLE_REAP_GRACE_MIN
// on start/open/restart is what enables the Console's self-reaper.
const childEnv = { ...process.env };
if (VERB !== "stop") {
  childEnv.CONSOLE_REAP_GRACE_MIN = process.env.CONSOLE_REAP_GRACE_MIN || "60";
}

// Quote a single argument for cmd.exe: wrap in double quotes and escape any
// embedded quote as "". Inside double quotes cmd.exe treats & | < > ^ ( ) as
// literal, so this blocks BOTH the spaced-path arg-split (a `--root` under
// `C:\Users\John Smith\proj`) AND metachar injection. Used only on the Windows
// shell route, where Node joins args UNQUOTED into one cmd.exe command line.
function winQuote(s) {
  return `"${String(s).replace(/"/g, '""')}"`;
}

// Determine the exit status honestly: a launcher killed by a signal reports
// status=null — treat that as failure, not success (don't tell cold-start/wrapup
// "up" when the process was signalled).
function relayExit(r) {
  if (r.error) die(`could not run the Console launcher (${r.error.message})`);
  process.exit(r.status ?? (r.signal ? 1 : 0));
}

const spawnOpts = { stdio: "inherit", env: childEnv }; // launcher prints the URL to stdout; we relay it verbatim

if (cmd.kind === "dir") {
  // Routes 1 & 3: run the Console source dir's built launcher with node — a
  // direct exec (shell:false), so Node quotes every arg; nothing to injection-proof.
  const launcherPath = join(cmd.dir, "dist-server", "hub", "launcher.js");
  if (VERB === "stop") {
    // stop must never build — if it isn't built, nothing is running to stop.
    if (!existsSync(launcherPath)) {
      log("stop: no built Console present — nothing to stop");
      process.exit(0);
    }
  } else {
    ensureBuilt(cmd.dir);
  }
  log(`${VERB} → node ${launcherPath} --root ${REPO_ROOT}`);
  relayExit(spawnSync(process.execPath, [launcherPath, ...verbArgs], { ...spawnOpts, shell: false }));
} else if (!cmd.shell) {
  // Routes 2 & 4 on POSIX: a direct exec with shell:false → Node quotes args,
  // so a spaced --root and any .console-version content are inert as arguments.
  const args = [...cmd.baseArgs, ...verbArgs];
  log(`${VERB} → ${[cmd.command, ...cmd.baseArgs].join(" ")} --root ${REPO_ROOT}`);
  relayExit(spawnSync(cmd.command, args, { ...spawnOpts, shell: false }));
} else {
  // Routes 2 & 4 on Windows: `ccmaf-console` / `npx` are .cmd shims Node cannot
  // spawn without a shell, but shell:true joins args UNQUOTED into one cmd.exe
  // command line — the arg-split + injection surface. Build the command line
  // ourselves with explicit cmd.exe quoting on every ARGUMENT (the command name
  // is a fixed no-space literal → left unquoted to dodge cmd's outer-quote
  // stripping). The version spec inside baseArgs is additionally regex-validated
  // in versionSpec(), so no shell metacharacter can reach this point.
  const commandLine = [
    cmd.command,
    ...cmd.baseArgs.map(winQuote),
    ...verbArgs.map(winQuote),
  ].join(" ");
  log(`${VERB} → ${commandLine}`);
  relayExit(spawnSync(commandLine, { ...spawnOpts, shell: true }));
}
