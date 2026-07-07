// scripts/smoke-pack.mjs — release gate for `ccmaf-console`.
//
// Proves the PACKED tarball actually works end-to-end, the way a consumer gets it:
//   1. `npm pack` (prepack builds dist/ + dist-server/) → ccmaf-console-<v>.tgz
//   2. install that tarball into a throwaway prefix (pulls only runtime deps)
//   3. create a fixture project (.claude/TASKS.md with 2 bracketed tasks)
//   4. `ccmaf-console start --root <fixture>` → capture the printed URL
//   5. GET /api/health  → app === "ccmaf-console"
//      GET /api/tasks   → exactly 2 tasks parsed
//      GET /            → 200 HTML with the x-console-token meta AND an
//                        /assets/*.js reference; that asset → 200, JS mime.
//                        (Proves the SPA actually loads — a broken/empty dist/
//                        serves API-only and would white-screen every npx user.)
//   6. `ccmaf-console stop --root <fixture>` → registry entry removed
//
// Everything runs under an isolated CCMAF_CONSOLE_STATE_DIR so it never touches
// the real per-user registry. Exit 0 = PASS, non-zero = FAIL (with a clear reason).
//
// Run: npm run smoke-pack   (Git Bash or PowerShell on Windows; best-effort elsewhere).

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const CONSOLE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IS_WIN = process.platform === "win32";
const log = (m) => console.log(`[smoke-pack] ${m}`);
const die = (m) => { console.error(`[smoke-pack] FAIL: ${m}`); process.exit(1); };

const work = mkdtempSync(join(tmpdir(), "ccmaf-smoke-"));
const stateDir = join(work, "state");
const fixture = join(work, "fixture");
const installDir = join(work, "install");
let stopServer = null; // set once the server is up → token-aware teardown on any exit path

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    shell: IS_WIN, // resolve npm/npm.cmd on Windows
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

async function main() {
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(installDir, { recursive: true });

  // 1) pack (prepack builds).
  log("npm pack …");
  const packOut = run("npm", ["pack", "--pack-destination", work], { cwd: CONSOLE_ROOT });
  const tgz = packOut.trim().split(/\r?\n/).pop().trim();
  const tgzPath = join(work, tgz);
  if (!existsSync(tgzPath)) die(`tarball not produced (${tgz})`);
  log(`packed ${tgz}`);

  // 2) install the tarball (+ its runtime deps) into a throwaway prefix.
  log("installing tarball into throwaway prefix …");
  writeFileSync(join(installDir, "package.json"), JSON.stringify({ name: "smoke-host", private: true }) + "\n");
  run("npm", ["install", "--no-audit", "--no-fund", "--save", tgzPath], { cwd: installDir });
  const binJs = join(installDir, "node_modules", "ccmaf-console", "bin", "ccmaf-console.mjs");
  if (!existsSync(binJs)) die(`installed bin missing at ${binJs}`);

  // 3) fixture project with 2 bracketed tasks.
  mkdirSync(join(fixture, ".claude"), { recursive: true });
  writeFileSync(
    join(fixture, ".claude", "TASKS.md"),
    [
      "# Task Board", "", "## Feature Lane", "", "### In Progress", "",
      "#### [TASK-001] First smoke task", "**Status:** In Progress", "",
      "#### [TASK-002] Second smoke task", "**Status:** In Progress", "",
    ].join("\n") + "\n",
  );

  const env = { ...process.env, CCMAF_CONSOLE_STATE_DIR: stateDir };
  const bin = (verb) => run("node", [binJs, verb, "--root", fixture], { cwd: work, env });

  // 4) start → capture URL.
  log("ccmaf-console start …");
  const startOut = bin("start");
  const m = startOut.match(/http:\/\/127\.0\.0\.1:\d+/);
  if (!m) die(`no URL in start output:\n${startOut}`);
  const url = m[0];
  // token-aware teardown: `stop` reads the shutdown token from the registry and
  // force-kills if the graceful POST fails (a bare /api/shutdown is 403'd — no token).
  stopServer = () => { try { bin("stop"); } catch { /* best effort */ } };
  log(`server up at ${url}`);

  // 5) assertions.
  const health = await (await fetch(`${url}/api/health`)).json();
  if (health.app !== "ccmaf-console") die(`/api/health app="${health.app}" (expected "ccmaf-console")`);
  log(`health OK — app=${health.app} version=${health.version}`);

  // /api/tasks → TaskBoard { columns: [{ status, lane, items: TaskItem[] }] }
  const board = await (await fetch(`${url}/api/tasks`)).json();
  const cols = Array.isArray(board?.columns) ? board.columns : [];
  const count = cols.reduce((n, c) => n + (Array.isArray(c.items) ? c.items.length : 0), 0);
  if (count !== 2) die(`/api/tasks parsed ${count} tasks (expected 2)`);
  log(`tasks OK — parsed ${count} across ${cols.length} columns`);

  // 5b) SPA loads: GET / must be real HTML (token meta + a hashed JS bundle),
  // and that bundle must itself be a servable JS asset. /api/health + /api/tasks
  // alone are served even in API-only mode, so a broken/empty dist/ would PASS
  // this gate without them — this is what catches it.
  const rootResp = await fetch(`${url}/`);
  if (rootResp.status !== 200) die(`GET / status ${rootResp.status} (expected 200)`);
  const rootCt = rootResp.headers.get("content-type") || "";
  if (!rootCt.includes("text/html")) die(`GET / content-type "${rootCt}" (expected text/html)`);
  const html = await rootResp.text();
  if (!/<meta[^>]+name=["']x-console-token["']/.test(html)) {
    die("GET / HTML has no x-console-token meta tag — SPA can't authenticate writes");
  }
  const assetMatch = html.match(/\/assets\/[^"']+\.js/);
  if (!assetMatch) die("GET / HTML references no /assets/*.js bundle (dist/ built?)");
  const assetPath = assetMatch[0];
  const assetResp = await fetch(`${url}${assetPath}`);
  if (assetResp.status !== 200) die(`GET ${assetPath} status ${assetResp.status} (expected 200)`);
  const assetCt = assetResp.headers.get("content-type") || "";
  if (!/javascript|ecmascript/i.test(assetCt)) {
    die(`GET ${assetPath} content-type "${assetCt}" (expected a JS mime — dist/ is intact?)`);
  }
  log(`SPA OK — / serves HTML with token meta + ${assetPath} (${assetCt})`);

  // 6) stop → registry entry gone.
  log("ccmaf-console stop …");
  bin("stop");
  stopServer = null; // explicit stop done — don't double-stop in finally
  const regDir = join(stateDir, "registry");
  const leftover = existsSync(regDir) ? readdirSync(regDir).filter((f) => f.endsWith(".json")) : [];
  if (leftover.length !== 0) die(`registry not cleared after stop: ${leftover.join(", ")}`);
  log("registry cleared after stop");

  log("PASS ✅");
}

main()
  .catch((err) => die(err?.stack || String(err)))
  .finally(() => {
    // best-effort teardown: token-aware stop of a stray server, then remove temp tree.
    if (stopServer) stopServer();
    try { rmSync(work, { recursive: true, force: true }); } catch { /* ignore */ }
  });
