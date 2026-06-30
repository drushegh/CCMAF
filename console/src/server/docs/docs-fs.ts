/**
 * docs-fs.ts — Safe filesystem access for the Docs browser (TASK-028)
 *
 * This is the Console's first general file reader, so it is deliberately
 * locked down. Three layers of defence, all enforced here:
 *
 *   1. CONFINEMENT — every requested path is resolved against the docs root and
 *      must stay strictly inside it (the same `startsWith(root + sep)` check as
 *      resolveVerifyPath). `realpathSync` is then applied and re-checked so a
 *      symlink inside docs/ can't point outside it.
 *   2. ALLOWLIST — only known-safe extensions are served (markdown / text /
 *      images). Anything else (.js, .env, no extension, …) is refused.
 *   3. SIZE CAP — a file larger than MAX_FILE_BYTES is refused, not buffered.
 *
 * The tree builder skips dotfiles, caps depth, and caps total node count so a
 * pathological tree can't exhaust memory.
 *
 * contract:console-http-api, contract:console-state-sources
 */

import { resolve, join, sep, extname, basename } from "node:path";
import {
  existsSync,
  readdirSync,
  statSync,
  realpathSync,
  readFileSync,
} from "node:fs";
import { getProjectRoot } from "../project-root.js";
import type { DocsNode, DocsTree } from "../types.js";

/** Extension (lowercase, no dot) → Content-Type. The allowlist IS this map. */
const CONTENT_TYPES: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  json: "application/json; charset=utf-8",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_DEPTH = 8;
const MAX_NODES = 2000;

/** One active docs root: a stable `key` (the top-level path segment used to
 *  address files in it), a display `label`, and its absolute path. */
export interface DocsRootDef {
  key: string;
  label: string;
  abs: string;
}

/**
 * The project's docs root(s), resolved fresh — no caching (TASK-034 dual-root).
 *
 * Default: BOTH `<root>/docs` (the framework-scaffolded supplementary-material
 * home) and `<root>/01_Project/docs` (CCMAF's own app docs, alongside
 * code-conventions.md) — whichever exist. A project with only one (CCMAF has
 * just `01_Project/docs`; the framework repo has just `docs`) gets a single
 * root, identical to the pre-dual-root behaviour. When NEITHER exists the Docs
 * tab shows its empty state.
 *
 * `CONSOLE_DOCS_DIR` is the single-root override escape hatch: when set it
 * REPLACES the candidate list with exactly that one directory (absolute, or
 * relative to the project root).
 */
export function docsRoots(): DocsRootDef[] {
  const projectRoot = getProjectRoot();

  const override = process.env.CONSOLE_DOCS_DIR;
  if (override) {
    const abs = resolve(projectRoot, override);
    const name = basename(abs) || "docs";
    return [{ key: name, label: name, abs }];
  }

  const candidates: DocsRootDef[] = [
    { key: "docs", label: "docs", abs: resolve(projectRoot, "docs") },
    {
      key: "01_Project-docs",
      label: "01_Project/docs",
      abs: resolve(projectRoot, "01_Project", "docs"),
    },
  ];
  return candidates.filter((c) => {
    try {
      return existsSync(c.abs) && statSync(c.abs).isDirectory();
    } catch {
      return false;
    }
  });
}

/**
 * Legacy single-root accessor (the override, else `01_Project/docs`). Retained
 * for backward compatibility; the reader/tree now use `docsRoots()`.
 */
export function docsRoot(): string {
  const override = process.env.CONSOLE_DOCS_DIR;
  if (override) return resolve(getProjectRoot(), override);
  return resolve(getProjectRoot(), "01_Project", "docs");
}

/** lowercase extension without the dot ("" if none). */
function extOf(name: string): string {
  return extname(name).replace(/^\./, "").toLowerCase();
}

export function isAllowedExt(ext: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONTENT_TYPES, ext);
}

export function contentTypeFor(ext: string): string {
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** True if `child` is strictly inside `base` (or equal to it). */
function isInside(base: string, child: string): boolean {
  const safeBase = base.endsWith(sep) ? base : base + sep;
  return child === base || child.startsWith(safeBase);
}

/**
 * Resolve `rel` against ONE root, proving the result lives inside it. Throws on
 * any escape attempt, a missing file, a non-file, a disallowed extension, or an
 * oversize file. The thrown message is generic on purpose.
 */
function resolveWithinRoot(
  root: string,
  rel: string
): { abs: string; ext: string } {
  // resolve() collapses any ../ segments; we then re-assert containment.
  const candidate = resolve(root, rel);
  if (!isInside(root, candidate)) {
    throw new Error("Path escapes docs root");
  }
  if (!existsSync(candidate)) {
    throw new Error("Doc not found");
  }

  // Resolve symlinks and re-check — a symlink inside docs/ must not point out.
  const real = realpathSync(candidate);
  const realRoot = realpathSync(root);
  if (!isInside(realRoot, real)) {
    throw new Error("Path escapes docs root");
  }

  const st = statSync(real);
  if (!st.isFile()) {
    throw new Error("Not a file");
  }
  if (st.size > MAX_FILE_BYTES) {
    throw new Error("Doc too large");
  }

  const ext = extOf(real);
  if (!isAllowedExt(ext)) {
    throw new Error("Unsupported file type");
  }

  return { abs: real, ext };
}

/**
 * Resolve a client-supplied path to an absolute path that is PROVEN to live
 * inside one of the active docs roots. Throws (generic message) on any failure.
 *
 * Dispatch (TASK-034 dual-root):
 *   - 1 active root → the path is root-relative (legacy/CCMAF scheme), resolved
 *     directly against it. Unchanged from before.
 *   - 2+ active roots → the FIRST path segment is the root key; the remainder is
 *     resolved within that root. A path whose first segment matches no key (e.g.
 *     the README image transform, which is root-relative) falls back to trying
 *     each root in order — the per-root confinement check still applies.
 */
export function resolveDocPath(relPath: string): { abs: string; ext: string } {
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new Error("Missing doc path");
  }
  // Reject NUL bytes outright (path-poisoning).
  if (relPath.includes("\0")) {
    throw new Error("Invalid doc path");
  }

  const roots = docsRoots();
  if (roots.length === 0) {
    throw new Error("Doc not found");
  }

  let attempts: { root: string; rel: string }[];
  if (roots.length === 1) {
    attempts = [{ root: roots[0].abs, rel: relPath }];
  } else {
    const slash = relPath.indexOf("/");
    const key = slash === -1 ? relPath : relPath.slice(0, slash);
    const rest = slash === -1 ? "" : relPath.slice(slash + 1);
    const matched = roots.find((r) => r.key === key);
    attempts = matched
      ? [{ root: matched.abs, rel: rest }]
      : roots.map((r) => ({ root: r.abs, rel: relPath })); // unprefixed → try each
  }

  let lastErr: unknown;
  for (const { root, rel } of attempts) {
    try {
      return resolveWithinRoot(root, rel);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Doc not found");
}

/** Read a doc file (after resolveDocPath validation) → bytes + content-type. */
export function readDoc(relPath: string): {
  buffer: Buffer;
  contentType: string;
} {
  const { abs, ext } = resolveDocPath(relPath);
  return { buffer: readFileSync(abs), contentType: contentTypeFor(ext) };
}

/**
 * Build the docs tree (TASK-034 dual-root). Returns { exists:false, root:null }
 * when NO docs root exists so the page degrades to an empty state. Dotfiles are
 * skipped; depth and total node count are capped (shared across roots).
 *
 *   - 1 active root → the tree root IS that directory, child paths root-relative
 *     (unchanged: CCMAF, the framework repo, and the CONSOLE_DOCS_DIR override).
 *   - 2+ active roots → a synthetic root whose children are one dir node per
 *     active root; each root's contents are prefixed with that root's key so
 *     resolveDocPath can dispatch the raw-file read back to the right root.
 */
export function buildDocsTree(): DocsTree {
  const roots = docsRoots();
  if (roots.length === 0) {
    return { exists: false, root: null };
  }

  let nodes = 0;

  const walk = (absDir: string, relDir: string, depth: number): DocsNode[] => {
    if (depth > MAX_DEPTH || nodes >= MAX_NODES) return [];
    let entries: string[];
    try {
      entries = readdirSync(absDir);
    } catch {
      return [];
    }
    // Stable, case-insensitive sort; directories first.
    const out: DocsNode[] = [];
    const sorted = entries
      .filter((name) => !name.startsWith(".")) // skip dotfiles (.gitkeep etc.)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    for (const name of sorted) {
      if (nodes >= MAX_NODES) break;
      const abs = join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      let st;
      try {
        st = statSync(abs);
      } catch {
        continue; // dangling symlink etc.
      }
      if (st.isDirectory()) {
        nodes++;
        out.push({
          name,
          path: rel,
          type: "dir",
          children: walk(abs, rel, depth + 1),
        });
      } else if (st.isFile()) {
        nodes++;
        out.push({ name, path: rel, type: "file", ext: extOf(name) });
      }
    }
    // Dirs first, then files (both already alpha-sorted).
    return [
      ...out.filter((n) => n.type === "dir"),
      ...out.filter((n) => n.type === "file"),
    ];
  };

  if (roots.length === 1) {
    // Single root — unchanged: the root node is the directory, paths root-relative.
    const r = roots[0];
    return {
      exists: true,
      root: {
        name: basename(r.abs),
        path: "",
        type: "dir",
        children: walk(r.abs, "", 0),
      },
    };
  }

  // Multiple roots — a synthetic container whose children are the active roots,
  // each addressed by its key so DocsPage links + the raw reader stay in sync.
  return {
    exists: true,
    root: {
      name: "docs",
      path: "",
      type: "dir",
      children: roots.map((r) => ({
        name: r.label,
        path: r.key,
        type: "dir" as const,
        children: walk(r.abs, r.key, 1),
      })),
    },
  };
}
