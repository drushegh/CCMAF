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
 *
 * State discipline: every write goes through commit(), which keeps a ref
 * mirror (stateRef) alongside useState. Async callbacks read the CURRENT
 * state synchronously from the mirror — never via a setState-updater side
 * channel, which React only evaluates eagerly when the fiber has no pending
 * update in the tick (the silent-no-op that broke the ?turn deep-link chase).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAgentWindow,
  type AgentConversation,
  type ConversationTurn,
  type TurnBlock,
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
  /**
   * Prepend the previous page. Resolves TRUE only when a page fetch actually
   * completed (deep-link chasers spend their load budget on that signal);
   * FALSE on busy / nothing-earlier / fetch failure / stale generation.
   */
  loadEarlier: () => Promise<boolean>;
  /**
   * Refetch the tail and merge. `follow` = pinned-to-bottom: on a gap the
   * window jumps to the live edge instead of arming the pill. Returns the
   * number of appended turns (0 on no-op). A no-change tick keeps the SAME
   * state object, so nothing downstream re-renders.
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

  // Synchronous mirror of `state` — see the header comment. All writes go
  // through commit(); async callbacks read stateRef.current directly.
  const stateRef = useRef<ConversationState>(INITIAL);
  const commit = useCallback((next: ConversationState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    genRef.current++;
    const gen = genRef.current;
    busyEarlierRef.current = false;
    busyTailRef.current = false;
    commit(INITIAL);
    if (!sessionId || !agentId) return;
    fetchAgentWindow(sessionId, agentId)
      .then((c) => {
        if (genRef.current !== gen) return;
        commit({
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
        commit({
          ...INITIAL,
          phase: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
  }, [sessionId, agentId, nonce, commit]);

  const loadEarlier = useCallback(async (): Promise<boolean> => {
    if (!sessionId || !agentId) return false;
    if (busyEarlierRef.current) return false;
    const s0 = stateRef.current;
    const before = s0.hasMore ? s0.oldestUuid : null;
    if (!before) return false;
    const gen = genRef.current;
    busyEarlierRef.current = true;
    commit({ ...stateRef.current, loadingEarlier: true });
    try {
      const c = await fetchAgentWindow(sessionId, agentId, { before });
      if (genRef.current !== gen) return false;
      const s = stateRef.current;
      // Dedupe guard: drop any incoming turn already in the window.
      const have = new Set(s.turns.map((t) => t.uuid));
      const fresh = c.turns.filter((t) => !have.has(t.uuid));
      commit({
        ...s,
        loadingEarlier: false,
        turns: [...fresh, ...s.turns],
        hasMore: c.hasMore,
        oldestUuid: c.oldestUuid ?? s.oldestUuid,
        total: c.total || s.total,
      });
      return true;
    } catch {
      if (genRef.current === gen) {
        commit({ ...stateRef.current, loadingEarlier: false });
      }
      return false;
    } finally {
      busyEarlierRef.current = false;
    }
  }, [sessionId, agentId, commit]);

  const refreshTail = useCallback(
    async (follow: boolean): Promise<number> => {
      if (!sessionId || !agentId) return 0;
      if (busyTailRef.current) return 0;
      busyTailRef.current = true;
      const gen = genRef.current;
      try {
        const c = await fetchAgentWindow(sessionId, agentId);
        if (genRef.current !== gen) return 0;
        const s = stateRef.current;
        if (s.phase !== "ready") return 0;
        const incoming = c.turns;
        if (s.turns.length === 0) {
          commit({
            ...s,
            ...identityOf(c),
            turns: incoming,
            total: c.total,
            hasMore: c.hasMore,
            oldestUuid: c.oldestUuid,
            paged: isPaged(c),
            unseenCount: follow ? 0 : s.unseenCount + incoming.length,
          });
          return incoming.length;
        }
        const last = s.turns[s.turns.length - 1];
        const idx = incoming.findIndex((t) => t.uuid === last.uuid);
        if (idx !== -1) {
          // Overlap: replace the last loaded turn (it may have grown) and
          // append everything after it.
          const appended = incoming.length - idx - 1;
          if (appended === 0 && sameTurnContent(incoming[idx], last)) {
            // No-change tick (fresh JSON is never reference-equal — compare
            // by content). Keep the SAME state object so a 1.5s SSE tick
            // doesn't rebuild turns, re-render the pane or re-fire the
            // deep-link effect.
            if (c.total && c.total !== s.total) {
              commit({ ...s, total: c.total });
            }
            return 0;
          }
          commit({
            ...s,
            ...identityOf(c),
            turns: [...s.turns.slice(0, -1), ...incoming.slice(idx)],
            total: c.total || s.total,
            unseenCount: follow ? 0 : s.unseenCount + appended,
          });
          return appended;
        }
        // GAP — more than a window of new turns since our tail.
        if (follow) {
          commit({
            ...s,
            ...identityOf(c),
            turns: incoming,
            total: c.total,
            hasMore: c.hasMore,
            oldestUuid: c.oldestUuid,
            unseenCount: 0,
            gapBehindLive: false,
          });
          return incoming.length;
        }
        if (!s.gapBehindLive || (c.total !== 0 && c.total !== s.total)) {
          commit({ ...s, total: c.total || s.total, gapBehindLive: true });
        }
        return 0;
      } catch {
        return 0; // transient live-refresh failure — keep what we have
      } finally {
        busyTailRef.current = false;
      }
    },
    [sessionId, agentId, commit],
  );

  const jumpToLive = useCallback(async () => {
    if (!sessionId || !agentId) return;
    const gen = genRef.current;
    try {
      const c = await fetchAgentWindow(sessionId, agentId);
      if (genRef.current !== gen) return;
      commit({
        ...stateRef.current,
        phase: "ready",
        ...identityOf(c),
        turns: c.turns,
        total: c.total,
        hasMore: c.hasMore,
        oldestUuid: c.oldestUuid,
        paged: isPaged(c),
        unseenCount: 0,
        gapBehindLive: false,
      });
    } catch {
      // keep current window
    }
  }, [sessionId, agentId, commit]);

  const acknowledgeUnseen = useCallback(() => {
    const s = stateRef.current;
    if (s.unseenCount !== 0) commit({ ...s, unseenCount: 0 });
  }, [commit]);

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

/**
 * Content equality for the overlap turn of a tail refresh. Two fetches of an
 * unchanged tail produce fresh (never reference-equal) JSON objects; a turn
 * "grows" by gaining blocks or by a block's text/summary/flags changing.
 */
function sameTurnContent(a: ConversationTurn, b: ConversationTurn): boolean {
  if (a.uuid !== b.uuid || a.blocks.length !== b.blocks.length) return false;
  for (let i = 0; i < a.blocks.length; i++) {
    if (!sameBlock(a.blocks[i], b.blocks[i])) return false;
  }
  return true;
}

function sameBlock(x: TurnBlock, y: TurnBlock): boolean {
  if (x.kind !== y.kind) return false;
  if (x.kind === "text" || x.kind === "thinking") {
    const yy = y as Extract<TurnBlock, { kind: "text" | "thinking" }>;
    return x.text === yy.text && x.truncated === yy.truncated;
  }
  if (x.kind === "tool_use") {
    const yy = y as Extract<TurnBlock, { kind: "tool_use" }>;
    return (
      x.toolUseId === yy.toolUseId &&
      x.name === yy.name &&
      x.summary === yy.summary
    );
  }
  const yy = y as Extract<TurnBlock, { kind: "tool_result" }>;
  return (
    x.toolUseId === yy.toolUseId &&
    x.text === yy.text &&
    x.isError === yy.isError &&
    x.truncated === yy.truncated
  );
}
