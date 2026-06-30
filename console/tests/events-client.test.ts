/**
 * events-client.test.ts — unit tests for src/app/api/events.ts (TASK-008).
 *
 * Runs in jsdom (the default vitest environment) so EventSource is accessible
 * (mocked via vi.stubGlobal). We test:
 *   1. subscribe() returns an unsubscribe function
 *   2. A "change" message fan-outs to all registered listeners
 *   3. Unsubscribing stops future deliveries
 *   4. _resetForTest() cleans up state between tests
 *   5. Guard: when EventSource is undefined, subscribe() is a no-op (no throw)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock EventSource ──────────────────────────────────────────────────────────

interface MockEventSourceInstance {
  addEventListener: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  /** Simulate a server-sent event */
  _fireEvent: (eventName: string, data: unknown) => void;
}

let _mockInstance: MockEventSourceInstance | null = null;

function makeMockEventSource() {
  const listeners: Map<string, Array<(e: MessageEvent) => void>> = new Map();

  const instance: MockEventSourceInstance = {
    addEventListener: vi.fn((eventName: string, listener: (e: MessageEvent) => void) => {
      const list = listeners.get(eventName) ?? [];
      list.push(listener);
      listeners.set(eventName, list);
    }),
    close: vi.fn(),
    _fireEvent(eventName: string, data: unknown) {
      const evt = { data: JSON.stringify(data) } as MessageEvent;
      for (const listener of (listeners.get(eventName) ?? [])) {
        listener(evt);
      }
    },
  };

  _mockInstance = instance;
  return instance;
}

const MockEventSourceCtor = vi.fn(() => makeMockEventSource());

// ── Test setup ────────────────────────────────────────────────────────────────

let resetForTest: () => void;
let subscribe: (listener: (evt: { path?: string }) => void) => () => void;

beforeEach(async () => {
  vi.stubGlobal("EventSource", MockEventSourceCtor);
  MockEventSourceCtor.mockClear();
  _mockInstance = null;

  // Re-import the module fresh (reset module cache) or use the reset helper.
  // Since vitest module cache persists across tests, we use _resetForTest.
  const mod = await import("../src/app/api/events.js");
  subscribe = mod.subscribe;
  resetForTest = mod._resetForTest;
  resetForTest();
});

afterEach(() => {
  resetForTest?.();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("subscribe — fan-out", () => {
  it("returns an unsubscribe function", () => {
    const unsub = subscribe(() => {});
    expect(typeof unsub).toBe("function");
  });

  it("creates exactly one EventSource on first subscribe", () => {
    subscribe(() => {});
    expect(MockEventSourceCtor).toHaveBeenCalledOnce();
    expect(MockEventSourceCtor).toHaveBeenCalledWith("/api/events");
  });

  it("reuses the same EventSource for multiple subscribers", () => {
    subscribe(() => {});
    subscribe(() => {});
    subscribe(() => {});
    expect(MockEventSourceCtor).toHaveBeenCalledOnce();
  });

  it("fans out a change event to all registered listeners", () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    subscribe(l1);
    subscribe(l2);

    const data = { path: "/fake/.claude/TASKS.md" };
    _mockInstance!._fireEvent("change", data);

    expect(l1).toHaveBeenCalledOnce();
    expect(l1).toHaveBeenCalledWith(data);
    expect(l2).toHaveBeenCalledOnce();
    expect(l2).toHaveBeenCalledWith(data);
  });

  it("unsubscribing stops future change deliveries", () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    const unsub1 = subscribe(l1);
    subscribe(l2);

    unsub1();

    _mockInstance!._fireEvent("change", {});
    expect(l1).not.toHaveBeenCalled();
    expect(l2).toHaveBeenCalledOnce();
  });

  it("handles malformed JSON in change event data without throwing", () => {
    const l = vi.fn();
    subscribe(l);

    // Directly fire with malformed data (bypass the type-safe _fireEvent)
    const listeners = (
      _mockInstance!.addEventListener as ReturnType<typeof vi.fn>
    ).mock.calls;
    const changeEntry = listeners.find(([name]: [string]) => name === "change");
    expect(changeEntry).toBeDefined();
    const changeListener = changeEntry[1] as (e: MessageEvent) => void;

    expect(() => changeListener({ data: "NOT_JSON{{{" } as MessageEvent)).not.toThrow();
    // Listener still called (with empty fallback evt)
    expect(l).toHaveBeenCalledOnce();
    expect(l).toHaveBeenCalledWith({});
  });
});

describe("guard: no EventSource in environment", () => {
  it("subscribe() does not throw when EventSource is undefined", () => {
    resetForTest();
    vi.stubGlobal("EventSource", undefined);
    // Must not throw even when EventSource is not available
    expect(() => subscribe(() => {})).not.toThrow();
  });

  it("no EventSource created when EventSource is undefined", () => {
    resetForTest();
    vi.stubGlobal("EventSource", undefined);
    subscribe(() => {});
    // MockEventSourceCtor not called (we un-stubbed it)
    expect(MockEventSourceCtor).not.toHaveBeenCalled();
  });
});

describe("_resetForTest — singleton cleanup", () => {
  it("closes the EventSource and clears listeners", () => {
    const l = vi.fn();
    subscribe(l);
    const inst = _mockInstance!;
    resetForTest();
    expect(inst.close).toHaveBeenCalled();
    // After reset, a new subscribe should create a new EventSource
    subscribe(l);
    expect(MockEventSourceCtor).toHaveBeenCalledTimes(2);
  });
});
