/**
 * project-root.ts — auto-detect the project root from the .claude/ sentinel.
 *
 * Strategy: walk up from CWD until we find a directory containing `.claude/`.
 * The project root is the directory that *contains* `.claude/` — the repo root.
 *
 * DEC-007: v1 serves the single project the server is launched in.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Walk up from startDir until a directory containing `.claude/` is found.
 * Returns the resolved project root path or null if none is found.
 */
export function findProjectRoot(startDir: string): string | null {
  let current = startDir;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (existsSync(join(current, ".claude"))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      // Reached the filesystem root without finding .claude/
      return null;
    }
    current = parent;
  }
}

let _projectRoot: string | undefined = undefined;

/**
 * Returns the auto-detected project root.
 * Exits with a clear message if none found (this is a fatal misconfiguration).
 */
export function getProjectRoot(): string {
  if (_projectRoot !== undefined) {
    return _projectRoot;
  }

  const found = findProjectRoot(process.cwd());
  if (found === null) {
    const msg =
      "CCMAF Console: could not find a project root (no .claude/ directory " +
      `found in '${process.cwd()}' or any parent). ` +
      "Run the server from within a CCMAF project directory.";
    console.error(msg);
    process.exit(1);
  }

  _projectRoot = found;
  return found;
}

/**
 * Resolve a path relative to the project root's .claude/ directory.
 * Example: dotClaudePath("TASKS.md") → "<root>/.claude/TASKS.md"
 */
export function dotClaudePath(...segments: string[]): string {
  return join(getProjectRoot(), ".claude", ...segments);
}
