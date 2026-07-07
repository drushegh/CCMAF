/**
 * SearchOverlay.tsx — `/` search-in-session for the Sessions view.
 *
 * Queries GET /api/sessions/:id/search (every agent transcript, server-side).
 * On the pre-pagination backend (404) it falls back to searching the LOADED
 * window of the current agent locally and says so. Results jump to the
 * matched turn (cross-agent matches navigate to that agent with ?turn=).
 */

import { useEffect, useRef, useState } from "react";
import { Bot, CornerDownLeft, Loader2, Search, User, X } from "lucide-react";
import { searchSession, type SearchMatch } from "../api/sessions";
import { ApiError } from "../api/state";
import type { ConversationTurn } from "../api/sessions";
import { searchLoadedTurns } from "./rows";

export interface SearchOverlayProps {
  sessionId: string;
  /** Current agent (local-fallback scope + labelling). */
  agentId: string;
  agentLabel: string;
  loadedTurns: ConversationTurn[];
  onPick: (match: SearchMatch) => void;
  onClose: () => void;
}

const DEBOUNCE_MS = 250;

export function SearchOverlay({
  sessionId,
  agentId,
  agentLabel,
  loadedTurns,
  onPick,
  onClose,
}: SearchOverlayProps) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [phase, setPhase] = useState<"idle" | "searching" | "done">("idle");
  const [scope, setScope] = useState<"session" | "loaded">("session");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const genRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const gen = ++genRef.current;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setMatches([]);
      setPhase("idle");
      return;
    }
    setPhase("searching");
    timerRef.current = setTimeout(async () => {
      try {
        const res = await searchSession(sessionId, trimmed);
        if (genRef.current !== gen) return;
        setScope("session");
        setMatches(res.matches);
        setPhase("done");
        setActiveIdx(0);
      } catch (err) {
        if (genRef.current !== gen) return;
        if (err instanceof ApiError && err.status === 404) {
          // Pre-pagination backend — search what we have, and say so.
          const local = searchLoadedTurns(loadedTurns, trimmed);
          setScope("loaded");
          setMatches(
            local.map((m) => ({
              agentId,
              agentLabel,
              turnUuid: m.turnUuid,
              role: m.role,
              blockType: m.blockType,
              snippet: m.snippet,
            })),
          );
          setPhase("done");
          setActiveIdx(0);
        } else {
          setMatches([]);
          setPhase("done");
        }
      }
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [q, sessionId, agentId, agentLabel, loadedTurns]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && matches[activeIdx]) {
      e.preventDefault();
      onPick(matches[activeIdx]);
    }
  };

  return (
    <div className="sess-search-backdrop" onClick={onClose} role="presentation">
      <div
        className="sess-search"
        role="dialog"
        aria-modal="true"
        aria-label="Search in session"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="sess-search-inputrow">
          <Search size={14} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="sess-search-input"
            placeholder="Search this session…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search query"
          />
          {phase === "searching" && (
            <Loader2 size={13} className="sess-spin" aria-hidden="true" />
          )}
          <button
            type="button"
            className="sess-search-close"
            onClick={onClose}
            aria-label="Close search"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {scope === "loaded" && phase === "done" && (
          <div className="sess-search-scopenote">
            Server search unavailable — searching the loaded turns of{" "}
            <strong>{agentLabel}</strong> only.
          </div>
        )}

        {phase === "done" && matches.length === 0 && q.trim().length >= 2 && (
          <div className="sess-search-none">No matches.</div>
        )}

        {matches.length > 0 && (
          <ul
            className="sess-search-results"
            role="listbox"
            aria-label="Matches"
          >
            {matches.slice(0, 50).map((m, i) => (
              <li key={`${m.agentId}:${m.turnUuid}:${i}`} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={i === activeIdx ? "true" : "false"}
                  className={`sess-search-hit${i === activeIdx ? " is-active" : ""}`}
                  onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => onPick(m)}
                >
                  <span className="sess-search-hit-agent">
                    {m.agentId === "root" ? (
                      <User size={10} aria-hidden="true" />
                    ) : (
                      <Bot size={10} aria-hidden="true" />
                    )}
                    {m.agentLabel}
                  </span>
                  <span className="sess-search-hit-kind">{m.blockType}</span>
                  <span className="sess-search-hit-snippet">{m.snippet}</span>
                  <CornerDownLeft
                    size={11}
                    className="sess-search-hit-enter"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
