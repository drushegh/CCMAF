// @vitest-environment node
/**
 * watcher-atomic-rewrite.test.ts — regression test for F1 (S1): fs.watch on
 * TASKS.md (and the other read-set files) must keep firing "change" events
 * after MULTIPLE atomic temp-file + renameSync writes — the exact pattern
 * every write in this codebase uses (see atomicWriteTasksMd in
 * ../src/server/routes/tasks-write-routes.ts, and writeVerifyFile in
 * ../src/server/verify/io.ts).
 *
 * tests/watcher.test.ts fully mocks node:fs.watch, so it can never exercise
 * real inotify-across-rename semantics — that was the actual blind spot that
 * let F1 ship (see findings/CCMAF/overnight-20260704/findings-console-server.md
 * and verify-console-server.md). This file uses REAL fs (not mocked) against
 * a real temp directory, mirroring the mock-project-root pattern already used
 * by tests/verify.test.ts and tests/verify-routes.test.ts, specifically so it
 * can catch a regression back to "watch the file directly" (which dies after
 * write #1 on Linux/inotify — confirmed in the verifier's WSL2 repro).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let tempRoot: string;

beforeAll(() => {
  tempRoot = join(tmpdir(), `ccmaf-watcher-atomic-${Date.now()}-${process.pid}`);
  mkdirSync(join(tempRoot, ".claude"), { recursive: true });
  // Seed TASKS.md (this regression is specifically about it) and README.md
  // (the other file outside .claude/) so both watched directories exist.
  writeFileSync(join(tempRoot, ".claude", "TASKS.md"), "# Task Board\n", "utf8");
  writeFileSync(join(tempRoot, "README.md"), "# readme\n", "utf8");
});

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

// Must be registered before any import that depends on project-root — same
// pattern as tests/verify.test.ts / tests/verify-routes.test.ts. Unlike
// watcher.test.ts, this file does NOT mock node:fs — it needs real fs.watch.
vi.mock("../src/server/project-root.js", () => {
  return {
    findProjectRoot: (_: string) => tempRoot,
    getProjectRoot: () => tempRoot,
    dotClaudePath: (...segments: string[]) => [tempRoot, ".claude", ...segments].join("/"),
  };
});

const { createWatcher } = await import("../src/server/watch/watcher.js");

/**
 * Mirrors atomicWriteTasksMd (tasks-write-routes.ts) / writeVerifyFile
 * (verify/io.ts): write a temp file in the same directory, then renameSync
 * onto the target path. This is the exact write pattern that kills a
 * per-file fs.watch on Linux (inotify tracks the file's inode, not the path
 * — a rename onto that path leaves the old watch behind).
 */
function atomicWrite(targetPath: string, content: string): void {
  const tmp = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, targetPath);
}

/** Wait long enough to clear the watcher's 250ms debounce plus fs event latency. */
function waitForDebounce(ms = 700): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("watcher — survives repeated atomic rename-writes to TASKS.md (F1 regression)", () => {
  let watcher: ReturnType<typeof createWatcher> | undefined;

  afterEach(() => {
    watcher?.stop();
    watcher = undefined;
  });

  it(
    "keeps firing 'change' after the 1st, 2nd, and 3rd atomic write, not just the first",
    async () => {
      watcher = createWatcher();
      const events: unknown[] = [];
      watcher.subscribe((evt) => events.push(evt));
      watcher.start();

      const tasksPath = join(tempRoot, ".claude", "TASKS.md");

      atomicWrite(tasksPath, "# Task Board\nwrite 1\n");
      await waitForDebounce();
      expect(events.length).toBeGreaterThanOrEqual(1);

      const afterFirst = events.length;
      atomicWrite(tasksPath, "# Task Board\nwrite 2\n");
      await waitForDebounce();
      // This is the exact bug F1 describes: a per-file fs.watch on Linux
      // never fires again after the FIRST rename-based write. Watching the
      // containing directory (the fix) must not regress this.
      expect(events.length).toBeGreaterThan(afterFirst);

      const afterSecond = events.length;
      atomicWrite(tasksPath, "# Task Board\nwrite 3\n");
      await waitForDebounce();
      expect(events.length).toBeGreaterThan(afterSecond);
    },
    20000
  );
});
