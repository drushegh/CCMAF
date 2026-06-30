/**
 * use-async-live.test.tsx — tests for the live-refresh extension in useAsync (TASK-008).
 *
 * Runs in jsdom (default environment). We mock the events singleton so that we
 * can manually fire change notifications without a real EventSource or server.
 *
 * Tests:
 *   1. Existing useAsync behaviour is unchanged (backward-compat)
 *   2. When EventSource is defined, useAsync subscribes to the change stream
 *   3. A change event triggers a reload (fetches again)
 *   4. When EventSource is undefined, subscribe is NOT called (guard)
 *   5. On unmount, the subscription is cleaned up
 */

import { render, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { useAsync } from "../src/app/pages/lib.js";

// ── Mock the events module ────────────────────────────────────────────────────

let _changeListeners: Array<(evt: { path?: string }) => void> = [];

const mockSubscribe = vi.fn((listener: (evt: { path?: string }) => void) => {
  _changeListeners.push(listener);
  return () => {
    _changeListeners = _changeListeners.filter((l) => l !== listener);
  };
});

vi.mock("../src/app/api/events.js", () => ({
  subscribe: (listener: (evt: { path?: string }) => void) => mockSubscribe(listener),
}));

function fireChange(evt: { path?: string } = {}) {
  for (const l of [..._changeListeners]) l(evt);
}

// ── Helper component ──────────────────────────────────────────────────────────

interface HookResult<T> {
  phase: string;
  data: T | undefined;
  reloadCount: number;
}

function UseAsyncHarness<T>({
  loader,
  onResult,
}: {
  loader: () => Promise<T>;
  onResult: (r: HookResult<T>) => void;
}) {
  const reloadCountRef = React.useRef(0);
  const state = useAsync(loader);
  // Track how many times we've entered "loading" beyond the first
  React.useEffect(() => {
    if (state.phase === "loading") reloadCountRef.current++;
  }, [state.phase]);
  onResult({ phase: state.phase, data: state.data, reloadCount: reloadCountRef.current });
  return null;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _changeListeners = [];
  mockSubscribe.mockClear();
  // Ensure EventSource is defined in jsdom scope (vitest.setup.ts imports jest-dom;
  // jsdom 26 ships EventSource as undefined, so we stub it)
  if (typeof EventSource === "undefined") {
    vi.stubGlobal("EventSource", class {});
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useAsync — backward-compat (TASK-006 behaviour)", () => {
  it("resolves data and sets phase to ready", async () => {
    const loader = vi.fn(() => Promise.resolve("hello"));
    const results: HookResult<string>[] = [];

    render(<UseAsyncHarness loader={loader} onResult={(r) => results.push(r)} />);

    await waitFor(() => expect(results.at(-1)?.phase).toBe("ready"));
    expect(results.at(-1)?.data).toBe("hello");
    expect(loader).toHaveBeenCalledOnce();
  });

  it("sets phase to error when loader rejects", async () => {
    const loader = vi.fn(() => Promise.reject(new Error("boom")));
    const results: HookResult<never>[] = [];

    render(<UseAsyncHarness loader={loader} onResult={(r) => results.push(r)} />);

    await waitFor(() => expect(results.at(-1)?.phase).toBe("error"));
  });
});

describe("useAsync — live-refresh extension (TASK-008)", () => {
  it("subscribes to the change stream when mounted (EventSource defined)", async () => {
    const loader = vi.fn(() => Promise.resolve("data"));
    render(<UseAsyncHarness loader={loader} onResult={() => {}} />);

    // Wait for mount + first load
    await waitFor(() => expect(loader).toHaveBeenCalledOnce());

    // subscribe should have been called once (one listener registered)
    expect(mockSubscribe).toHaveBeenCalledOnce();
  });

  it("re-runs the loader when a change event fires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const loader = vi.fn(() => Promise.resolve("data"));
    render(<UseAsyncHarness loader={loader} onResult={() => {}} />);

    await waitFor(() => expect(loader).toHaveBeenCalledOnce());

    // Fire a change event
    await act(async () => {
      fireChange({ path: "/fake/.claude/TASKS.md" });
      // Advance past the 250ms debounce
      vi.advanceTimersByTime(300);
    });

    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    vi.useRealTimers();
  });

  it("debounces rapid change events — loader called once per burst", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const loader = vi.fn(() => Promise.resolve("data"));
    render(<UseAsyncHarness loader={loader} onResult={() => {}} />);

    await waitFor(() => expect(loader).toHaveBeenCalledOnce());

    // Fire three rapid changes
    await act(async () => {
      fireChange();
      vi.advanceTimersByTime(50);
      fireChange();
      vi.advanceTimersByTime(50);
      fireChange();
      vi.advanceTimersByTime(300); // let debounce settle
    });

    await waitFor(() => expect(loader).toHaveBeenCalledTimes(2));
    vi.useRealTimers();
  });

  it("does NOT subscribe when EventSource is undefined (guard)", async () => {
    vi.stubGlobal("EventSource", undefined);
    const loader = vi.fn(() => Promise.resolve("data"));
    const prevCallCount = mockSubscribe.mock.calls.length;

    render(<UseAsyncHarness loader={loader} onResult={() => {}} />);

    await waitFor(() => expect(loader).toHaveBeenCalledOnce());

    // subscribe should NOT have been called (EventSource guard fired)
    expect(mockSubscribe.mock.calls.length).toBe(prevCallCount);
  });

  it("cleans up the subscription on unmount", async () => {
    const loader = vi.fn(() => Promise.resolve("data"));
    const { unmount } = render(<UseAsyncHarness loader={loader} onResult={() => {}} />);

    await waitFor(() => expect(loader).toHaveBeenCalledOnce());
    const before = _changeListeners.length;
    expect(before).toBeGreaterThan(0);

    unmount();

    // Listener should be removed
    expect(_changeListeners.length).toBe(before - 1);
  });
});
