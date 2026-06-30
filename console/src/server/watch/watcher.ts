/**
 * watcher.ts — file-system watcher for the Console read-set (TASK-008).
 *
 * Watches the paths defined in contract:console-state-sources and emits
 * a "change" event (debounced ~250ms) whenever any of them are modified.
 *
 * Design:
 *   - Uses node:fs.watch. On Windows, recursive watch is supported at the
 *     directory level, so we watch parent directories recursively and filter
 *     events back to the known read-set.
 *   - Debounce: a single 250ms timer coalesces rapid editor-save bursts.
 *   - ENOENT / transient errors are swallowed (files may not exist yet).
 *   - Exported as a singleton factory; the plugin calls start() once and
 *     stop() on server close.
 *
 * contract:console-state-sources, TASK-008
 */

import { watch, type FSWatcher } from "node:fs";
import { EventEmitter } from "node:events";
import { join, resolve, normalize } from "node:path";
import { dotClaudePath, getProjectRoot } from "../project-root.js";

// ── Event shape ──────────────────────────────────────────────────────────────

/** Payload emitted on the "change" event. */
export interface WatchChangeEvent {
  /** The changed file path (absolute), or undefined if multiple changed. */
  path?: string;
}

// ── Read-set ─────────────────────────────────────────────────────────────────

/**
 * Returns the full list of absolute paths/directories that form the read-set.
 * Called at start() time so project root is resolved once.
 *
 * Read-set per contract:console-state-sources:
 *   .claude/TASKS.md
 *   .claude/ECOSYSTEM.md
 *   .claude/DECISIONS.md
 *   .claude/STATUS.md
 *   .claude/GOTCHAS.md
 *   .claude/FRAMEWORK-SUGGESTIONS.md
 *   .claude/review-findings.md
 *   .claude/test-findings.md
 *   .claude/framework/docs/specs/  (directory)
 *   <root>/README.md
 *   .claude/console/verify/        (directory)
 *   .claude/telemetry/             (directory — .hook-metrics + events.jsonl)
 */
function buildReadSet(): { files: string[]; dirs: string[] } {
  const files = [
    dotClaudePath("TASKS.md"),
    dotClaudePath("ECOSYSTEM.md"),
    dotClaudePath("DECISIONS.md"),
    dotClaudePath("STATUS.md"),
    dotClaudePath("GOTCHAS.md"),
    dotClaudePath("FRAMEWORK-SUGGESTIONS.md"),
    dotClaudePath("review-findings.md"),
    dotClaudePath("test-findings.md"),
    join(getProjectRoot(), "README.md"),
  ];
  const dirs = [
    dotClaudePath("framework", "docs", "specs"),
    dotClaudePath("console", "verify"),
    dotClaudePath("telemetry"),
  ];
  return { files, dirs };
}

// ── Watcher ───────────────────────────────────────────────────────────────────

export interface Watcher {
  /** Subscribe to change events. Returns an unsubscribe function. */
  subscribe(listener: (evt: WatchChangeEvent) => void): () => void;
  /** Number of active subscribers — one per open SSE stream, i.e. one per
   *  cockpit a browser currently has open. Used by the reaper to avoid killing
   *  a console someone is actively viewing (TASK-039 hardening). */
  subscriberCount(): number;
  /** Start watching (idempotent). */
  start(): void;
  /** Stop watching and clean up all fs.watch handles. */
  stop(): void;
}

/**
 * Create a file-set watcher for the Console read-set.
 *
 * Usage:
 *   const w = createWatcher();
 *   w.start();
 *   const unsub = w.subscribe((evt) => { ... });
 *   // on server close:
 *   w.stop();
 */
export function createWatcher(): Watcher {
  const emitter = new EventEmitter();
  const handles: FSWatcher[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPath: string | undefined = undefined;
  let multipleChanged = false;
  let started = false;

  function scheduleEmit(filePath: string | undefined): void {
    if (debounceTimer !== null) {
      // Track whether multiple distinct files changed during the burst
      if (filePath !== lastPath) {
        multipleChanged = true;
        lastPath = undefined;
      }
      clearTimeout(debounceTimer);
    } else {
      lastPath = filePath;
      multipleChanged = false;
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const evt: WatchChangeEvent = multipleChanged ? {} : { path: lastPath };
      lastPath = undefined;
      multipleChanged = false;
      emitter.emit("change", evt);
    }, 250);
  }

  /**
   * Build a normalised set of absolute file paths from the read-set so we can
   * filter directory-watch events back to known files.
   */
  function buildNormalizedFileSet(files: string[]): Set<string> {
    const s = new Set<string>();
    for (const f of files) s.add(normalize(resolve(f)));
    return s;
  }

  function start(): void {
    if (started) return;
    started = true;

    const { files, dirs } = buildReadSet();
    const knownFiles = buildNormalizedFileSet(files);

    // Watch individual files directly (for .claude/*.md and README.md)
    for (const filePath of files) {
      try {
        const h = watch(filePath, { persistent: false }, (eventType) => {
          if (eventType === "change" || eventType === "rename") {
            scheduleEmit(normalize(resolve(filePath)));
          }
        });
        h.on("error", () => {
          // ENOENT or transient — swallow silently
        });
        handles.push(h);
      } catch {
        // File may not exist yet — skip; it will be picked up by dir watch if in a dir
      }
    }

    // Watch directories recursively for specs/ and verify/
    for (const dirPath of dirs) {
      try {
        const h = watch(dirPath, { recursive: true, persistent: false }, (eventType, filename) => {
          if (eventType === "change" || eventType === "rename") {
            let absPath: string | undefined;
            if (filename) {
              const candidate = normalize(resolve(dirPath, filename));
              absPath = candidate;
              // Only emit if it's a known individual file, OR any file in the
              // watched dir (directory watch is already scoped to the dir)
              if (knownFiles.has(candidate)) {
                scheduleEmit(candidate);
                return;
              }
              scheduleEmit(absPath);
            } else {
              scheduleEmit(undefined);
            }
          }
        });
        h.on("error", () => {
          // Directory may not exist — swallow
        });
        handles.push(h);
      } catch {
        // Dir may not exist — skip gracefully
      }
    }
  }

  function stop(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    for (const h of handles) {
      try { h.close(); } catch { /* ignore */ }
    }
    handles.length = 0;
    started = false;
    emitter.removeAllListeners();
  }

  function subscribe(listener: (evt: WatchChangeEvent) => void): () => void {
    emitter.on("change", listener);
    return () => { emitter.off("change", listener); };
  }

  function subscriberCount(): number {
    return emitter.listenerCount("change");
  }

  return { subscribe, subscriberCount, start, stop };
}

// ── Module-level singleton (used by the events route plugin) ──────────────────

let _instance: Watcher | null = null;

/** Return the module-level watcher singleton, creating it if necessary. */
export function getWatcher(): Watcher {
  if (!_instance) {
    _instance = createWatcher();
  }
  return _instance;
}
