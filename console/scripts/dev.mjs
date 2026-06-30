// scripts/dev.mjs — one-command dev for the Console.
//
// Vite serves the SPA (with HMR) on :6120; the Fastify API server runs on
// :6121; Vite proxies /api → :6121 (see vite.config.ts). In production a
// single server serves both (npm run serve) — this just reproduces that
// over two dev processes so the pages fetch real data while you edit.
//
// Run: npm run dev   (Ctrl-C stops both)
//
// NOTE: the API runs from the compiled output (dist-server/), built once at
// startup. If you change server/ code, restart `npm run dev` (or re-run
// `npm run build:server`). UI changes hot-reload via Vite.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

// One shared per-launch token for the dev session: the API validates against it
// AND Vite injects it into the served index.html (Fastify doesn't serve the page
// in dev), so SPA write requests carry a token the API accepts. See vite.config.ts.
const CONSOLE_TOKEN = randomBytes(16).toString("hex");

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* already gone */
    }
  }
  process.exit(code);
}

function start(name, command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...env },
  });
  child.on("exit", (code) => {
    console.log(`[dev] ${name} exited (${code ?? 0}) — shutting down`);
    shutdown(code ?? 0);
  });
  children.push(child);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// Build the server once, then launch API (6121) + Vite (6120).
console.log("[dev] building server (one-off)…");
const build = spawn("npm", ["run", "build:server"], {
  stdio: "inherit",
  shell: true,
});
build.on("exit", (code) => {
  if (code !== 0) {
    console.error("[dev] build:server failed — aborting");
    process.exit(code ?? 1);
  }
  start("api", "node", ["dist-server/main.js"], { CONSOLE_PORT: "6121", CONSOLE_TOKEN });
  start("web", "npx", ["vite"], { CONSOLE_TOKEN });
  console.log(
    "[dev] API on http://127.0.0.1:6121, SPA on http://127.0.0.1:6120 (open this one)"
  );
});
