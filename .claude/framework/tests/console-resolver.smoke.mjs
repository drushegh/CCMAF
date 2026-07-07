#!/usr/bin/env node
// console-resolver.smoke.mjs — resolver-order smoke for tools/console.mjs.
//
// The driver picks a Console COMMAND by first-match-wins order. Post-npm-publish
// the console is no longer bundled in any repo, so there are three routes:
//   1. CONSOLE_DIR override (dev checkout)
//   2. a global `ccmaf-console` on PATH
//   3. npx ccmaf-console@<spec>  (the default for consumers)
//
// Technique: copy the real driver into a throwaway <tmp>/tools/console.mjs (so
// its REPO_ROOT resolves to <tmp>) and drive the `stop` verb — which, for a
// dir-route with no built launcher, logs the chosen route then no-ops (exit 0)
// WITHOUT building or hitting the network. Route selection is asserted from the
// driver's stderr. No bats needed; run with:  node <thisfile>
//
// Exit 0 = all checks passed; exit 1 = a check failed (prints the failure).

import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRIVER_SRC = join(HERE, "..", "..", "..", "tools", "console.mjs");
const WIN = process.platform === "win32";

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`ok   - ${name}`);
  } else {
    failures++;
    console.log(`FAIL - ${name}${detail ? `\n       ${detail}` : ""}`);
  }
}

// Build a throwaway repo with the real driver at <tmp>/tools/console.mjs.
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "ccmaf-console-smoke-"));
  mkdirSync(join(root, "tools"), { recursive: true });
  copyFileSync(DRIVER_SRC, join(root, "tools", "console.mjs"));
  return root;
}

function runDriver(root, verb, { env = {}, extraPath } = {}) {
  const childEnv = { ...process.env, ...env };
  if (extraPath !== undefined) childEnv.PATH = extraPath;
  const r = spawnSync(process.execPath, [join(root, "tools", "console.mjs"), verb], {
    encoding: "utf8",
    env: childEnv,
  });
  return { status: r.status, stderr: r.stderr || "", stdout: r.stdout || "" };
}

// --- Check A: CONSOLE_DIR override wins (route 1) -----------------------------
// Even with npx on the real PATH, an explicit dev checkout must be chosen first.
{
  const root = makeRepo();
  const dev = join(root, "dev-console");
  mkdirSync(dev, { recursive: true });
  writeFileSync(join(dev, "package.json"), "{}\n");
  const { status, stderr } = runDriver(root, "stop", { env: { CONSOLE_DIR: dev } });
  check(
    "A: CONSOLE_DIR override is chosen (route 1)",
    stderr.includes("CONSOLE_DIR=") && stderr.includes("override"),
    stderr.trim(),
  );
  check("A: stop no-ops cleanly (exit 0)", status === 0, `exit ${status}`);
}

// --- Check B: no CONSOLE_DIR / no global bin, npx present → npx fallback ------
// A fake npx that just exits 0, so nothing hits the network.
{
  const root = makeRepo();
  const fakebin = join(root, "fakebin");
  mkdirSync(fakebin, { recursive: true });
  // POSIX + Windows shims (shell:true on win32 runs the .cmd).
  writeFileSync(join(fakebin, "npx"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(fakebin, "npx"), 0o755);
  if (WIN) writeFileSync(join(fakebin, "npx.cmd"), "@echo off\r\nexit /b 0\r\n");
  // PATH = fakebin + the OS system dir (so `where`/`command -v` themselves run),
  // but NOT the node install dir → the real npx / any global ccmaf-console are
  // out of reach; only our fake npx resolves.
  const sysDir = WIN ? join(process.env.SystemRoot || "C:\\Windows", "System32") : "/usr/bin:/bin";
  const sep = WIN ? ";" : ":";
  const { status, stderr } = runDriver(root, "stop", { extraPath: `${fakebin}${sep}${sysDir}` });
  check(
    "B: only npx present → resolver uses the npx fallback (route 3)",
    stderr.includes("using npx ccmaf-console@"),
    stderr.trim(),
  );
  check("B: fake-npx stop exits 0", status === 0, `exit ${status}`);
}

// --- Check C: no CONSOLE_DIR, no global bin, no npx → clean die ---------------
{
  const root = makeRepo();
  const sysDir = WIN ? join(process.env.SystemRoot || "C:\\Windows", "System32") : "/usr/bin:/bin";
  const { status, stderr } = runDriver(root, "stop", { extraPath: sysDir });
  check(
    "C: nothing resolvable → dies with the no-console message (exit 1)",
    status === 1 && stderr.includes("no ccmaf-console found"),
    `exit ${status}; stderr: ${stderr.trim()}`,
  );
}

console.log("");
if (failures) {
  console.log(`console-resolver.smoke: ${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("console-resolver.smoke: all checks passed");
