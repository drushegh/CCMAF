/**
 * readme-assets.ts — Serve image assets referenced by the root README (BUG-015)
 *
 * The root README references images by repo-root-relative paths — the GitHub
 * idiom `<p align="center"><img src=".github/assets/hero.webp" …></p>`. The
 * Console does NOT serve arbitrary repo files; this is a narrowly-scoped
 * exception for README images, locked down exactly like docs-fs:
 *
 *   1. CONFINEMENT — every path is resolved against the project root and must
 *      stay strictly inside it (`startsWith(root + sep)`), then `realpathSync`
 *      is applied and re-checked so a symlink can't point outside the repo.
 *   2. ALLOWLIST — IMAGES ONLY (png/jpg/jpeg/gif/svg/webp). No markdown, text,
 *      JSON, or code — nothing executable is ever served through this endpoint.
 *   3. SIZE CAP — a file larger than MAX_FILE_BYTES is refused, not buffered.
 *
 * The thrown messages are generic on purpose (no path leakage).
 *
 * contract:console-http-api, contract:console-state-sources
 */

import { resolve, sep, extname } from "node:path";
import { existsSync, statSync, realpathSync, readFileSync } from "node:fs";
import { getProjectRoot } from "../project-root.js";

/** Extension (lowercase, no dot) → Content-Type. The allowlist IS this map. */
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

function extOf(name: string): string {
  return extname(name).replace(/^\./, "").toLowerCase();
}

/** True if `child` is strictly inside `base` (or equal to it). */
function isInside(base: string, child: string): boolean {
  const safeBase = base.endsWith(sep) ? base : base + sep;
  return child === base || child.startsWith(safeBase);
}

/**
 * Resolve a README-relative image path to an absolute path PROVEN to live inside
 * the project root and to be an allowlisted image. Throws (generic message) on
 * any escape attempt, a missing file, a non-file, a non-image, or an oversize file.
 */
export function resolveReadmeAsset(relPath: string): {
  abs: string;
  contentType: string;
} {
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new Error("Missing asset path");
  }
  if (relPath.includes("\0")) {
    throw new Error("Invalid asset path");
  }

  const root = getProjectRoot();
  // resolve() collapses any ../ segments; we then re-assert containment.
  const candidate = resolve(root, relPath);
  if (!isInside(root, candidate)) {
    throw new Error("Path escapes project root");
  }
  if (!existsSync(candidate)) {
    throw new Error("Asset not found");
  }

  // Resolve symlinks and re-check — a symlink inside the repo must not point out.
  const real = realpathSync(candidate);
  const realRoot = realpathSync(root);
  if (!isInside(realRoot, real)) {
    throw new Error("Path escapes project root");
  }

  const st = statSync(real);
  if (!st.isFile()) {
    throw new Error("Not a file");
  }
  if (st.size > MAX_FILE_BYTES) {
    throw new Error("Asset too large");
  }

  const ext = extOf(real);
  if (!Object.prototype.hasOwnProperty.call(IMAGE_TYPES, ext)) {
    throw new Error("Unsupported asset type");
  }

  return { abs: real, contentType: IMAGE_TYPES[ext] };
}

/** Read a README image asset (after resolveReadmeAsset validation). */
export function readReadmeAsset(relPath: string): {
  buffer: Buffer;
  contentType: string;
} {
  const { abs, contentType } = resolveReadmeAsset(relPath);
  return { buffer: readFileSync(abs), contentType };
}
