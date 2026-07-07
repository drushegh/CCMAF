/**
 * sessions.ts — Client fetch helpers for the Sessions agent-visualisation view.
 *
 * Mirrors the server shapes in src/server/types.ts (SessionSummary, SessionTree,
 * AgentConversation). The SPA imports ONLY from this file for sessions data —
 * never server code. Reuses the ApiError class and getJson pattern from
 * api/analytics.ts / api/state.ts.
 *
 * `subscribeToSession` opens a PER-SESSION EventSource on
 * /api/sessions/:id/stream (unlike api/events.ts' singleton, which covers the
 * project read-set — transcripts live outside the project tree).
 */

import { ApiError } from "./state.js";

export type { ApiError };

// ── Types (mirror src/server/types.ts sessions additions) ─────────────────────

export interface SessionSummary {
  id: string;
  startedAt: string | null;
  lastActivity: string | null;
  messageCount: number;
  agentCount: number;
  gitBranch: string | null;
  firstPrompt: string | null;
  title: string | null;
}

export type AgentStatus = "running" | "done";

export interface AgentNode {
  id: string;
  parentId: string | null;
  agentType: string;
  description: string | null;
  toolUseId: string | null;
  spawnDepth: number;
  status: AgentStatus;
  startedAt: string | null;
  lastActivity: string | null;
  messageCount: number;
  model: string | null;
}

export interface SessionTree {
  sessionId: string;
  root: AgentNode;
  agents: AgentNode[];
}

export type TurnBlock =
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "thinking"; text: string; truncated: boolean }
  | {
      kind: "tool_use";
      toolUseId: string;
      name: string;
      summary: string;
      /** Raw input object — optional forward-compat (rail detail fetch owns it). */
      input?: unknown;
    }
  | {
      kind: "tool_result";
      toolUseId: string;
      text: string;
      isError: boolean;
      truncated: boolean;
    };

export interface ConversationTurn {
  uuid: string;
  role: "user" | "assistant";
  timestamp: string | null;
  model: string | null;
  blocks: TurnBlock[];
}

/**
 * A WINDOW of one agent's conversation (paginated backend). Default (no
 * `before`) = the TAIL of `limit` turns; `before=<uuid>` = the `limit` turns
 * immediately before that turn. `total`/`hasMore`/`oldestUuid` drive
 * "load earlier". The pre-pagination backend returns the FULL conversation
 * with these fields absent — {@link fetchAgentWindow} normalises that to
 * `total: turns.length, hasMore: false`.
 */
export interface AgentConversation {
  sessionId: string;
  agentId: string;
  agentType: string;
  description: string | null;
  /** Last assistant model of the FULL conversation (null on legacy backend). */
  model: string | null;
  turns: ConversationTurn[];
  total: number;
  hasMore: boolean;
  oldestUuid: string | null;
}

/** Untruncated tool call detail — the tool rail's "open full result". */
export interface ToolResultDetail {
  toolUseId: string;
  name: string;
  input: unknown;
  result: { text: string; isError: boolean; truncated: false };
}

export interface SearchMatch {
  agentId: string;
  agentLabel: string;
  turnUuid: string;
  role: "user" | "assistant";
  blockType: "text" | "thinking" | "tool_use" | "tool_result";
  snippet: string;
}

export interface SessionSearchResult {
  q: string;
  matches: SearchMatch[];
  capped?: boolean;
}

// ── HTTP helper (same shape as api/analytics.ts) ──────────────────────────────

async function getJson<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError(
      `Could not reach the Console server (${path}). Is it running?`,
    );
  }
  if (!res.ok) {
    throw new ApiError(
      `Request to ${path} failed with ${res.status} ${res.statusText}`,
      res.status,
    );
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(`Malformed JSON from ${path}`, res.status);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function fetchSessions(): Promise<SessionSummary[]> {
  return getJson<SessionSummary[]>("/api/sessions");
}

export function fetchSessionTree(sessionId: string): Promise<SessionTree> {
  return getJson<SessionTree>(
    `/api/sessions/${encodeURIComponent(sessionId)}/tree`,
  );
}

/** Default window size for a conversation fetch (matches the server default). */
export const CONVERSATION_WINDOW = 200;

/**
 * Fetch one window of an agent's conversation.
 * - no `before` → the TAIL (last `limit` turns) — open-at-the-end behaviour;
 * - `before=<turnUuid>` → the `limit` turns before it ("load earlier").
 *
 * Tolerates the pre-pagination backend (full conversation, no total/hasMore):
 * the response is normalised so callers can treat both shapes identically.
 */
export async function fetchAgentWindow(
  sessionId: string,
  agentId: string,
  opts?: { before?: string; limit?: number },
): Promise<AgentConversation> {
  const params = new URLSearchParams();
  if (opts?.before) params.set("before", opts.before);
  params.set("limit", String(opts?.limit ?? CONVERSATION_WINDOW));
  const raw = await getJson<Partial<AgentConversation>>(
    `/api/sessions/${encodeURIComponent(sessionId)}/agents/${encodeURIComponent(agentId)}?${params}`,
  );
  const turns = Array.isArray(raw.turns) ? raw.turns : [];
  return {
    sessionId: raw.sessionId ?? sessionId,
    agentId: raw.agentId ?? agentId,
    agentType: raw.agentType ?? "unknown",
    description: raw.description ?? null,
    model: raw.model ?? null,
    turns,
    total: typeof raw.total === "number" ? raw.total : turns.length,
    hasMore: raw.hasMore === true,
    oldestUuid: raw.oldestUuid ?? (turns.length > 0 ? turns[0].uuid : null),
  };
}

/**
 * Fetch the full, untruncated result of one tool call. Rejects with an
 * ApiError (status 404) on the pre-pagination backend — callers surface
 * "full result not available yet" rather than failing the rail.
 */
export function fetchToolResult(
  sessionId: string,
  toolUseId: string,
): Promise<ToolResultDetail> {
  return getJson<ToolResultDetail>(
    `/api/sessions/${encodeURIComponent(sessionId)}/tools/${encodeURIComponent(toolUseId)}`,
  );
}

/**
 * Search every agent transcript of a session. Rejects with ApiError 404 on
 * the pre-pagination backend — the SearchOverlay falls back to searching the
 * loaded window locally.
 */
export function searchSession(
  sessionId: string,
  q: string,
): Promise<SessionSearchResult> {
  return getJson<SessionSearchResult>(
    `/api/sessions/${encodeURIComponent(sessionId)}/search?q=${encodeURIComponent(q)}`,
  );
}

/**
 * Subscribe to a session's transcript-change stream. Returns an unsubscribe
 * function; call it in a useEffect cleanup. No-ops (returns a no-op unsub)
 * where EventSource is unavailable (jsdom / SSR), matching api/events.ts.
 */
export function subscribeToSession(
  sessionId: string,
  onChange: () => void,
): () => void {
  if (typeof EventSource === "undefined") return () => {};
  const source = new EventSource(
    `/api/sessions/${encodeURIComponent(sessionId)}/stream`,
  );
  source.addEventListener("change", () => {
    try {
      onChange();
    } catch {
      // isolate listener errors
    }
  });
  source.addEventListener("error", () => {
    // Browser EventSource auto-reconnects; nothing to do.
  });
  return () => source.close();
}
