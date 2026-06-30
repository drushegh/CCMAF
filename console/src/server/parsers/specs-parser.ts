/**
 * specs-parser.ts — List/read .claude/framework/docs/specs/*.md (TASK-003)
 *
 * parseSpecsList  → SpecRef[]  (filenames without the .md extension)
 * readSpecDoc     → SpecDoc | null  (name + full markdown content)
 *
 * Empty states:
 *   - Missing specs dir → []
 *   - Named spec not found → null (caller sends 404)
 *
 * contract:console-state-sources, contract:console-http-api
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import type { SpecRef, SpecDoc } from "../types.js";

/**
 * List all *.md files in the specs directory as SpecRef[].
 * Returns [] if the directory does not exist or is not a directory.
 */
export function parseSpecsList(specsDir: string): SpecRef[] {
  if (!existsSync(specsDir)) return [];

  try {
    const stat = statSync(specsDir);
    if (!stat.isDirectory()) return [];

    return readdirSync(specsDir)
      .filter((f) => f.endsWith(".md") && !f.startsWith("."))
      .map((f) => ({ name: basename(f, ".md") }));
  } catch (err) {
    console.warn(`[console] failed to read ${specsDir}: ${String(err)}`);
    return [];
  }
}

/**
 * Read a named spec file from the specs directory.
 * The `name` param is the filename without the .md extension.
 *
 * Returns null if:
 *   - The name contains path-separator characters or ".." (safety check)
 *   - The file does not exist
 *   - The resolved path escapes the specsDir
 */
export function readSpecDoc(specsDir: string, name: string): SpecDoc | null {
  // Safety: reject names containing path separators or ".."
  if (/[/\\]/.test(name) || name.startsWith(".") || name.includes("..")) {
    return null;
  }

  const filePath = join(specsDir, `${name}.md`);
  const resolvedFile = resolve(filePath);
  const resolvedDir = resolve(specsDir);

  // Confirm the resolved path stays inside specsDir (defence-in-depth)
  const safeBase = resolvedDir.endsWith("/") || resolvedDir.endsWith("\\")
    ? resolvedDir
    : resolvedDir + (resolvedDir.includes("\\") ? "\\" : "/");

  if (!resolvedFile.startsWith(safeBase)) {
    return null;
  }

  if (!existsSync(resolvedFile)) return null;

  try {
    const markdown = readFileSync(resolvedFile, "utf8");
    return { name, markdown };
  } catch (err) {
    console.warn(`[console] failed to read ${resolvedFile}: ${String(err)}`);
    return null;
  }
}
