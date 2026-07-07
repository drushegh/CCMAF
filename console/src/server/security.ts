/**
 * security.ts — Per-launch token + DNS-rebinding/CSRF defence + path-safety.
 *
 * Security contract (SPEC §5, contract:console-http-api):
 *   - Per-launch token: generated at startup, injected into index.html.
 *     Required as X-Console-Token header on all WRITE endpoints.
 *   - Origin check: write requests from NON-loopback origins are rejected
 *     (DNS-rebinding / CSRF defence). Any loopback origin (127.0.0.1 / localhost,
 *     ANY port) is accepted — `npm run dev` serves the SPA from Vite on one port
 *     and the API on another, and the server may fall back to a different port; an
 *     exact-port match would wrongly reject same-machine requests. The per-launch
 *     token is the real write gate.
 *   - Path-safety: :task param validated against ^(TASK|BUG)-[0-9]+$ then
 *     resolved to .claude/console/verify/<id>.json — confirmed to stay inside
 *     the allowed directory; any traversal attempt is rejected.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { resolve, join, sep } from "node:path";
import { dotClaudePath } from "./project-root.js";

// ── Per-launch token ─────────────────────────────────────────────────────────

/**
 * 32 hex chars (128 bits). Fresh-random per process in production — EXCEPT in
 * `npm run dev`, where scripts/dev.mjs sets CONSOLE_TOKEN so the API and the
 * Vite-served page (Fastify doesn't serve index.html in dev) share ONE token.
 * In `npm run serve` the env var is unset → a fresh token injected into index.html.
 */
export const LAUNCH_TOKEN: string =
  process.env.CONSOLE_TOKEN || randomBytes(16).toString("hex");

export const TOKEN_HEADER = "x-console-token";

/** Verify that the request carries the correct per-launch token.
 *
 * Security properties:
 *   1. Explicit length equality check before comparison — rejects any prefix+garbage bypass
 *      (a value of LAUNCH_TOKEN+"extra" is rejected by the length check before comparison).
 *   2. crypto.timingSafeEqual — constant-time byte comparison; no timing side-channel.
 */
export function isValidToken(headerValue: string | undefined): boolean {
  if (!headerValue) return false;
  // Explicit length check first — rejects TOKEN+"garbage" prefix-bypass, and
  // makes the constant-time compare safe (timingSafeEqual needs equal lengths).
  if (headerValue.length !== LAUNCH_TOKEN.length) return false;
  // Compare the RAW utf8 bytes, NOT a hex decode. Hex-decoding both sides is a
  // foot-gun when CONSOLE_TOKEN is non-hex: Buffer.from(_, "hex") silently
  // truncates at the first invalid pair, so a non-hex token AND every non-hex
  // header decode to the SAME empty buffer → timingSafeEqual(∅, ∅) === true, an
  // auth bypass. utf8 keeps every byte significant. It also never throws (equal
  // string length ⇒ equal byte length for the ASCII hex token), so no 500/DoS.
  const a = Buffer.from(headerValue, "utf8");
  const b = Buffer.from(LAUNCH_TOKEN, "utf8");
  // Multibyte input can make equal string-lengths differ in byte-length; guard
  // so timingSafeEqual never throws on a length mismatch.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Origin / Host guard ───────────────────────────────────────────────────────

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * Return true if the request's `Host` header names a loopback address (any/no port).
 *
 * DNS-rebinding defence for READ routes (and the SPA): the console binds to 127.0.0.1,
 * but a browser page on an attacker domain rebound to 127.0.0.1 becomes same-origin and
 * could otherwise read responses (transcripts, projectRoot). A rebound request still
 * carries the ATTACKER's domain in its `Host` header, so a loopback-only Host allowlist
 * rejects it while every legitimate 127.0.0.1/localhost/[::1] request passes. Absence of
 * Host (non-browser CLI callers — the rebinding attack always sends a Host) is accepted.
 */
export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return true;
  let hostname = host.trim();
  if (hostname.startsWith("[")) {
    // IPv6 literal, e.g. "[::1]:6120" → keep the bracketed "[::1]".
    const end = hostname.indexOf("]");
    if (end >= 0) hostname = hostname.slice(0, end + 1);
  } else {
    // "127.0.0.1:6120" / "localhost:6120" → strip the port.
    const colon = hostname.indexOf(":");
    if (colon >= 0) hostname = hostname.slice(0, colon);
  }
  return LOOPBACK_HOSTS.has(hostname);
}

/**
 * Return true if the request comes from an acceptable origin (loopback only).
 *
 * For write requests we require the Origin or Referer (when Origin is absent)
 * to be the console itself. Absence of Origin (same-origin non-browser caller)
 * is also accepted since the tray launcher and curl tests have no Origin.
 */
export function isAllowedOrigin(
  origin: string | undefined,
  _port: number,
): boolean {
  // No Origin header — accept (CLI / server-side callers, not browser-page CSRF risk)
  if (!origin) return true;

  try {
    const u = new URL(origin);
    const hostname = u.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
    // Loopback-only — accept ANY loopback port. Dev serves the SPA (Vite) and the
    // API on different ports, and the server can fall back to another port, so an
    // exact-port check would reject legitimate same-machine writes. A cross-SITE
    // attacker's Origin is its own (non-loopback) domain and is still rejected;
    // the per-launch token gates the write regardless. `_port` is kept for the
    // signature (callers pass the server port) but no longer constrains the check.
    return LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

// ── Path-safety helper ────────────────────────────────────────────────────────

const TASK_ID_RE = /^(TASK|BUG)-[0-9]+$/;

/**
 * Validate a :task route param and resolve it to the safe verify-file path.
 *
 * Returns the absolute path to `.claude/console/verify/<taskId>.json` only if:
 *   1. taskId matches ^(TASK|BUG)-[0-9]+$
 *   2. The resolved path is strictly inside .claude/console/verify/
 *
 * Throws an Error with a human-readable message if either check fails.
 */
export function resolveVerifyPath(taskId: string): string {
  if (!TASK_ID_RE.test(taskId)) {
    throw new Error(
      `Invalid task id '${taskId}'. Must match (TASK|BUG)-[0-9]+.`,
    );
  }

  const verifyDir = resolve(dotClaudePath("console", "verify"));
  const target = join(verifyDir, `${taskId}.json`);
  const resolved = resolve(target);

  // Confirm the resolved path stays inside verifyDir (no traversal).
  // Use path.sep to get the correct separator for this OS (\ on Windows, / on Unix).
  // Both verifyDir and resolved come from resolve(), so they use the same separator.
  const safeBase = verifyDir.endsWith(sep) ? verifyDir : verifyDir + sep;

  if (!resolved.startsWith(safeBase) && resolved !== verifyDir) {
    throw new Error(`Path traversal detected for task id '${taskId}'.`);
  }

  return resolved;
}
