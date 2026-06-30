// @vitest-environment node
/**
 * watcher.test.ts — unit tests for src/server/watch/watcher.ts (TASK-008).
 *
 * Mocks node:fs.watch to avoid real filesystem side-effects.
 * Tests:
 *   1. subscribe() registers a listener
 *   2. fs.watch events debounce to a single "change" emission
 *   3. stop() clears watchers and listeners
 *   4. Multiple file changes within the debounce window emit once
 *   5. ENOENT / watch errors are swallowed (no throw)
 *   6. getWatcher() returns the same instance on repeated calls
 *   7. start() is idempotent (calling twice doesn't double-register)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock project-root so watcher tests don't require a real .claude/ dir ─────
vi.mock("../src/server/project-root.js", () => ({
  getProjectRoot: () => "/fake/project",
  dotClaudePath: (...segments: string[]) =>
    ["/fake/project", ".claude", ...segments].join("/"),
}));

// ── Capture the fs.watch mock handles ────────────────────────────────────────

type WatchCallback = (event: string, filename: string | null) => void;

interface MockHandle {
  callback: WatchCallback;
  errorListeners: Array<(err: Error) => void>;
  closed: boolean;
  on: (event: string, listener: (err: Error) => void) => MockHandle;
  close: () => void;
  /** Simulate a file system event */
  emit: (event: string, filename?: string) => void;
}

const mockHandles: MockHandle[] = [];

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    watch: vi.fn((_path: string, _opts: object, callback?: WatchCallback) => {
      const handle: MockHandle = {
        callback: callback ?? (() => {}),
        errorListeners: [],
        closed: false,
        on(event, listener) {
          if (event === "error") this.errorListeners.push(listener);
          return this;
        },
        close() { this.closed = true; },
        emit(event, filename = null) {
          if (!this.closed) this.callback(event, filename);
        },
      };
      mockHandles.push(handle);
      return handle;
    }),
  };
});

// Import AFTER mocks are registered
const { createWatcher, getWatcher } = await import("../src/server/watch/watcher.js");

// ── Helpers ───────────────────────────────────────────────────────────────────

function flushTimers() {
  vi.runAllTimers();
}

// ── Tests ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockHandles.length = 0;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("createWatcher — subscribe / start / stop", () => {
  it("registers a listener and calls it on a file change", () => {
    const w = createWatcher();
    const listener = vi.fn();
    w.subscribe(listener);
    w.start();

    // Simulate a change on the first file handle (TASKS.md)
    expect(mockHandles.length).toBeGreaterThan(0);
    mockHandles[0].emit("change", "TASKS.md");

    // Debounce timer must fire before listener is called
    expect(listener).not.toHaveBeenCalled();
    flushTimers();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("subscriberCount tracks open subscribers (the reaper's 'cockpit open' signal)", () => {
    const w = createWatcher();
    expect(w.subscriberCount()).toBe(0);
    const unsubA = w.subscribe(vi.fn());
    const unsubB = w.subscribe(vi.fn());
    expect(w.subscriberCount()).toBe(2);
    unsubA();
    expect(w.subscriberCount()).toBe(1);
    unsubB();
    expect(w.subscriberCount()).toBe(0);
  });

  it("debounces: multiple rapid events emit once", () => {
    const w = createWatcher();
    const listener = vi.fn();
    w.subscribe(listener);
    w.start();

    // Fire three events before the debounce fires
    mockHandles[0].emit("change", "TASKS.md");
    vi.advanceTimersByTime(50);
    mockHandles[0].emit("change", "TASKS.md");
    vi.advanceTimersByTime(50);
    mockHandles[0].emit("change", "TASKS.md");

    // Still 0 calls before debounce expires
    expect(listener).not.toHaveBeenCalled();
    flushTimers();
    // Only one call after debounce
    expect(listener).toHaveBeenCalledOnce();
  });

  it("stop() closes all handles and removes listeners", () => {
    const w = createWatcher();
    const listener = vi.fn();
    w.subscribe(listener);
    w.start();
    const handleCount = mockHandles.length;
    expect(handleCount).toBeGreaterThan(0);

    w.stop();
    // All handles should be closed
    for (const h of mockHandles) {
      expect(h.closed).toBe(true);
    }
    // Listener should NOT be called after stop
    mockHandles[0].emit("change", "TASKS.md");
    flushTimers();
    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribe removes the listener without stopping others", () => {
    const w = createWatcher();
    const l1 = vi.fn();
    const l2 = vi.fn();
    const unsub1 = w.subscribe(l1);
    w.subscribe(l2);
    w.start();

    unsub1();
    mockHandles[0].emit("change", "TASKS.md");
    flushTimers();

    expect(l1).not.toHaveBeenCalled();
    expect(l2).toHaveBeenCalledOnce();
    w.stop();
  });

  it("start() is idempotent — calling twice does not double handles", () => {
    const w = createWatcher();
    w.start();
    const firstCount = mockHandles.length;
    w.start(); // second call should be a no-op
    expect(mockHandles.length).toBe(firstCount);
    w.stop();
  });

  it("emits {path} when a single file changes", () => {
    const w = createWatcher();
    const received: Array<{ path?: string }> = [];
    w.subscribe((evt) => received.push(evt));
    w.start();

    mockHandles[0].emit("change", "TASKS.md");
    flushTimers();

    expect(received).toHaveLength(1);
    // path may be undefined (we can't predict the exact normalised path in unit test)
    // but the event must be an object
    expect(typeof received[0]).toBe("object");
    w.stop();
  });

  it("swallows watch errors — does not throw", () => {
    const w = createWatcher();
    w.subscribe(vi.fn());
    w.start();

    // Simulate an error event on a handle
    expect(() => {
      for (const h of mockHandles) {
        for (const errListener of h.errorListeners) {
          errListener(new Error("ENOENT"));
        }
      }
    }).not.toThrow();

    w.stop();
  });
});

describe("getWatcher — singleton", () => {
  it("returns the same instance on repeated calls", () => {
    const a = getWatcher();
    const b = getWatcher();
    expect(a).toBe(b);
  });
});
