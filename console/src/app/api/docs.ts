/**
 * docs.ts — Client fetch helpers for the Docs browser (TASK-028)
 *
 * Mirrors contract:console-http-api (DocsTree). The SPA imports ONLY from this
 * file for docs data — never server code.
 */

import { ApiError } from "./state.js";

export type { ApiError };

export interface DocsNode {
  name: string;
  path: string;
  type: "dir" | "file";
  ext?: string;
  children?: DocsNode[];
}

export interface DocsTree {
  exists: boolean;
  root: DocsNode | null;
}

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError(
      `Could not reach the Console server (${path}). Is it running?`
    );
  }
  if (!res.ok) {
    throw new ApiError(
      `Request to ${path} failed with ${res.status} ${res.statusText}`,
      res.status
    );
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(`Malformed JSON from ${path}`, res.status);
  }
}

export function fetchDocsTree(): Promise<DocsTree> {
  return getJson<DocsTree>("/api/docs");
}

/** URL for a file's raw bytes — use directly as an <img src> or to fetch text. */
export function docRawUrl(path: string): string {
  return `/api/docs/raw?path=${encodeURIComponent(path)}`;
}

/** Fetch a text-ish doc (markdown / txt) as a string for client-side rendering. */
export async function fetchDocText(path: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(docRawUrl(path), { method: "GET" });
  } catch {
    throw new ApiError(`Could not reach the Console server. Is it running?`);
  }
  if (!res.ok) {
    throw new ApiError(
      `Could not load ${path} (${res.status} ${res.statusText})`,
      res.status
    );
  }
  return res.text();
}

// ── Helpers shared by the page ────────────────────────────────────────────────

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"]);
const TEXT_EXTS = new Set(["md", "markdown", "txt", "json"]);

export function isImageExt(ext?: string): boolean {
  return !!ext && IMAGE_EXTS.has(ext);
}
export function isMarkdownExt(ext?: string): boolean {
  return ext === "md" || ext === "markdown";
}
export function isTextExt(ext?: string): boolean {
  return !!ext && TEXT_EXTS.has(ext);
}

/** Flatten the tree to the files only (depth-first), for "first file" selection. */
export function firstFile(node: DocsNode | null): DocsNode | null {
  if (!node) return null;
  if (node.type === "file") return node;
  for (const child of node.children ?? []) {
    const found = firstFile(child);
    if (found) return found;
  }
  return null;
}
