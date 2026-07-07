/**
 * useConversation.ts — windowed conversation state machine for one agent.
 *
 * Owns the loaded turn WINDOW (a contiguous, chronological slice ending at the
 * live tail unless the user paged back):
 *   - initial load  → the TAIL (open at the end; the verdict is what you want)
 *   - loadEarlier() → prepend the page before `oldestUuid`
 *   - refreshTail() → SSE-driven: fetch the tail again and MERGE by uuid
 *     overlap (replace the last loaded turn — it may have grown while
 *     streaming — and append what's new). A gap (>window of new turns) either
 *     jumps to the live edge (follow mode) or arms a "new activity" pill.
 *
 * Tolerates the pre-pagination backend transparently: fetchAgentWindow
 * normalises the full-conversation shape to {hasMore:false, total:length},
 * so every code path below behaves identically. `paged` reports which
 * backend answered (drives live-subtitle fetches and search).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAgentWindow,
  type AgentConversation,
  type ConversationTurn,
} from "../api/sessions";

export interface ConversationState {
  phase: "loading" | "ready" | "error";
  error: Error | null;
  /** Agent identity/meta from the last response. */
  agentType: string;
  description: string | null;
  model: string | null;
  /** The loaded window, oldest → newest. */
  turns: ConversationTurn[];
  /** Full conversation turn count (window-independent). */
  total: number;
  /** Older turns exist before the window. */
  hasMore: boolean;
  oldestUuid: string | null;
  /** True when the backend answered with pagination fields. */
  paged: boolean;
  /** Busy flags for the two incremental operations. */
  loadingEarlier: boolean;
  /** Turns appended by tail refreshes since the last acknowledge (pill count). */
  unseenCount: number;
  /** A tail refresh found a GAP while unpinned — the window is behind live. */
  gapBehindLive: boolean;
}

const INITIAL: ConversationState = {
  phase: "loading",
  error: null,
  agentType: "",
  description: null,
  model: null,
  turns: [],
  total: 0,
  hasMore: false,
  oldestUuid: null,
  paged: false,
  loadingEarlier: false,
  unseenCount: 0,
  gapBehindLive: false,
};

export interface UseConversation extends ConversationState {
  /** Prepend the previous page. No-op while busy or when nothing earlier. */
  loadEarlier: () => Promise<void>;
  /**
   * Refetch the tail and merge. `follow` = pinned-to-bottom: on a gap the
   * window jumps to the live edge instead of arming the pill. Returns the
   * number of appended turns (0 on no-op).
   */
  refreshTail: (follow: boolean) => Promise<number>;
  /** Jump the window to the live tail (pill click after a gap). */
  jumpToLive: () => Promise<void>;
  /** Reset the unseen-turns counter (user re-pinned to bottom). */
  acknowledgeUnseen: () => void;
  /** Full reload (error retry). */
  reload: () => void;
}

export function useConversation(
  sessionId: string | null,
  agentId: string | null,
): UseConversation {
  const [state, setState] = useState<ConversationState>(INITIAL);
  const [nonce, setNonce] = useState(0);
  // Generation token: any state-setting callback checks it after awaiting so a
  // stale response for a previous session/agent can never land.
  const genRef = useRef(0);
  const busyEarlierRef = useRef(false);
  const busyTailRef = useRef(false);

  useEffect(() => {
    genRef.current++;
    const gen = genRef.current;
    busyEarlierRef.current = false;
    busyTailRef.current = false;
    setState(INITIAL);
    if (!sessionId || !agentId) return;
    fetchAgentWindow(sessionId, agentId)
      .then((c) => {
        if (genRef.current !== gen) return;
        setState({
          ...INITIAL,
          phase: "ready",
          ...identityOf(c),
          turns: c.turns,
          total: c.total,
          hasMore: c.hasMore,
          oldestUuid: c.oldestUuid,
          paged: isPaged(c),
        });
      })
      .catch((err: unknown) => {
        if (genRef.current !== gen) return;
        setState({
          ...INITIAL,
          phase: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
  }, [sessionId, agentId, nonce]);

  const loadEarlier = useCallback(async () => {
    if (!sessionId || !agentId) return;
    if (busyEarlierRef.current) return;
    const gen = genRef.current;
    let before: string | null = null;
    setState((s) => {
      before = s.hasMore ? s.oldestUuid : null;
      return s.hasMore && s.oldestUuid ? { ...s, loadingEarlier: true } : s;
    });
    if (!before) return;
    busyEarlierRef.current = true;
    try {
      const c = await fetchAgentWindow(sessionId, agentId, { before });
      if (genRef.current !== gen) return;
      setState((s) => {
        // Dedupe guard: drop any incoming turn already in the window.
        const have = new Set(s.turns.map((t) => t.uuid));
        const fresh = c.turns.filter((t) => !have.has(t.uuid));
        return {
          ...s,
          loadingEarlier: false,
          turns: [...fresh, ...s.turns],
          hasMore: c.hasMore,
          oldestUuid: c.oldestUuid ?? s.oldestUuid,
          total: c.total || s.total,
        };
      });
    } catch {
      if (genRef.current === gen) {
        setState((s) => ({ ...s, loadingEarlier: false }));
      }
    } finally {
      busyEarlierRef.current = false;
    }
  }, [sessionId, agentId]);

  const refreshTail = useCallback(
    async (follow: boolean): Promise<number> => {
      if (!sessionId || !agentId) return 0;
      if (busyTailRef.current) return 0;
      busyTailRef.current = true;
      const gen = genRef.current;
      try {
        const c = await fetchAgentWindow(sessionId, agentId);
        if (genRef.current !== gen) return 0;
        let appended = 0;
        setState((s) => {
          if (s.phase !== "ready") return s;
          const incoming = c.turns;
          if (s.turns.length === 0) {
            appended = incoming.length;
            return {
              ...s,
              ...identityOf(c),
              turns: incoming,
              total: c.total,
              hasMore: c.hasMore,
              oldestUuid: c.oldestUuid,
              paged: isPaged(c),
              unseenCount: follow ? 0 : s.unseenCount + appended,
            };
          }
          const lastUuid = s.turns[s.turns.length - 1].uuid;
          const idx = incoming.findIndex((t) => t.uuid === lastUuid);
          if (idx !== -1) {
            // Overlap: replace the last loaded turn (it may have grown) and
            // append everything after it.
            appended = incoming.length - idx - 1;
            if (
              appended === 0 &&
              incoming[idx] === s.turns[s.turns.length - 1]
            ) {
              return { ...s, total: c.total || s.total };
            }
            return {
              ...s,
              ...identityOf(c),
              turns: [...s.turns.slice(0, -1), ...incoming.slice(idx)],
              total: c.total || s.total,
              unseenCount: follow ? 0 : s.unseenCount + appended,
            };
          }
          // GAP — more than a window of new turns since our tail.
          if (follow) {
            appended = incoming.length;
            return {
              ...s,
              ...identityOf(c),
              turns: incoming,
              total: c.total,
              hasMore: c.hasMore,
              oldestUuid: c.oldestUuid,
              unseenCount: 0,
              gapBehindLive: false,
            };
          }
          return { ...s, total: c.total || s.total, gapBehindLive: true };
        });
        return appended;
      } catch {
        return 0; // transient live-refresh failure — keep what we have
      } finally {
        busyTailRef.current = false;
      }
    },
    [sessionId, agentId],
  );

  const jumpToLive = useCallback(async () => {
    if (!sessionId || !agentId) return;
    const gen = genRef.current;
    try {
      const c = await fetchAgentWindow(sessionId, agentId);
      if (genRef.current !== gen) return;
      setState((s) => ({
        ...s,
        phase: "ready",
        ...identityOf(c),
        turns: c.turns,
        total: c.total,
        hasMore: c.hasMore,
        oldestUuid: c.oldestUuid,
        paged: isPaged(c),
        unseenCount: 0,
        gapBehindLive: false,
      }));
    } catch {
      // keep current window
    }
  }, [sessionId, agentId]);

  const acknowledgeUnseen = useCallback(() => {
    setState((s) => (s.unseenCount === 0 ? s : { ...s, unseenCount: 0 }));
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return {
    ...state,
    loadEarlier,
    refreshTail,
    jumpToLive,
    acknowledgeUnseen,
    reload,
  };
}

/* ── helpers ── */

function identityOf(c: AgentConversation) {
  return {
    agentType: c.agentType,
    description: c.description,
    model: c.model,
  };
}

/** Paged backend = pagination fields present & meaningful. */
function isPaged(c: AgentConversation): boolean {
  // The legacy normaliser sets total=turns.length & hasMore=false & oldestUuid
  // from turns[0] — indistinguishable when the whole conversation fits one
  // window. That's fine: behaviour only differs when hasMore=true, which the
  // legacy shape can never produce.
  return c.hasMore || c.total > c.turns.length;
}
