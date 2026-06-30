/**
 * events.ts — shared EventSource singleton for live-refresh (TASK-008).
 *
 * One EventSource for the whole SPA; individual consumers (useAsync via lib.tsx)
 * register listeners via `subscribe()` and receive WatchChangeEvent objects.
 *
 * Design:
 *   - Singleton: one connection, many subscribers. Opening one EventSource per
 *     useAsync instance would send a new SSE request per hook call — wasteful.
 *   - Guarded: `typeof EventSource !== 'undefined'` prevents import-time errors
 *     in jsdom (which ships EventSource as undefined) and in SSR/test contexts.
 *   - Fan-out: a simple Set<listener> with subscribe → unsubscribe pattern.
 *   - No automatic reconnect logic beyond what the browser EventSource provides
 *     by default (it already reconnects on connection loss).
 *
 * contract:console-http-api, TASK-008
 */

/** Payload received from `event: change` messages on /api/events. */
export interface WatchChangeEvent {
  /** The changed file path, or undefined when multiple files changed. */
  path?: string;
}

export type ChangeListener = (evt: WatchChangeEvent) => void;

// ── Singleton state ───────────────────────────────────────────────────────────

let _source: EventSource | null = null;
const _listeners = new Set<ChangeListener>();

function ensureConnected(): void {
  // Guard: EventSource is not defined in jsdom / SSR test environments.
  if (typeof EventSource === "undefined") return;
  if (_source !== null) return;

  _source = new EventSource("/api/events");

  _source.addEventListener("change", (raw: MessageEvent) => {
    let evt: WatchChangeEvent = {};
    try {
      evt = JSON.parse(raw.data as string) as WatchChangeEvent;
    } catch {
      // Malformed data frame — treat as a global change signal
    }
    for (const listener of _listeners) {
      try { listener(evt); } catch { /* isolate per-listener errors */ }
    }
  });

  _source.addEventListener("error", () => {
    // The browser will auto-reconnect; nothing extra needed here.
    // We do NOT close the source — that would suppress the built-in reconnect.
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Subscribe to file-change notifications from the server.
 *
 * Returns an unsubscribe function; call it in a useEffect cleanup.
 *
 * @example
 *   const unsub = subscribe((evt) => { console.log("changed", evt.path); });
 *   return () => unsub();
 */
export function subscribe(listener: ChangeListener): () => void {
  ensureConnected();
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/**
 * Expose the current connection state for testing / diagnostics.
 * Normal app code should not need this.
 */
export function _getConnectionState(): { source: EventSource | null; listenerCount: number } {
  return { source: _source, listenerCount: _listeners.size };
}

/**
 * Reset the singleton. FOR TESTING ONLY — do not call in production code.
 */
export function _resetForTest(): void {
  if (_source) {
    _source.close();
    _source = null;
  }
  _listeners.clear();
}
