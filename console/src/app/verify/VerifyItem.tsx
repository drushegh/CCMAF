import { useLayoutEffect, useRef } from "react";
import { History, RotateCw, Bug, Loader2 } from "lucide-react";
import {
  severityApplies,
  type Severity,
  type Verdict,
  type VerifyItem as VerifyItemModel,
} from "../api/verify";
import { VerdictControl } from "./VerdictControl";
import { SeveritySelect } from "./SeveritySelect";

interface VerifyItemRowProps {
  item: VerifyItemModel;
  onVerdictChange: (id: string, verdict: Verdict) => void;
  onSeverityChange: (id: string, severity: Severity | null) => void;
  onNotesChange: (id: string, notes: string) => void;
  /** Raise a BUG for this failing use case (the iterative-loop "flag as bug"). */
  onFlagBug?: (id: string) => void;
  /** True while this item's flag-as-bug request is in flight. */
  flagging?: boolean;
}

/**
 * One decision record (use case). Top-aligned verdict + severity controls, the
 * claim (subject) / expected pair, per-round notes, and the iterative-loop
 * affordances: a retest badge when the use case came back after a bug fix, the
 * prior rounds' notes (read-only), and a flag-as-bug action while it's failing.
 */
export function VerifyItemRow({
  item,
  onVerdictChange,
  onSeverityChange,
  onNotesChange,
  onFlagBug,
  flagging,
}: VerifyItemRowProps) {
  const sevEnabled = severityApplies(item.verdict);

  // Auto-size the notes field to its content so an existing note is shown in
  // full on load (and as you type), instead of a fixed 2-row box with a
  // scrollbar. CSS max-height caps the growth (then it scrolls).
  const notesRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const ta = notesRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [item.notes]);

  // Iterative-loop state. `round` defaults to 1; prior rounds (earlier than the
  // current one, with a non-empty note) are shown read-only above the editable
  // current note so the bug→fix→retest history is preserved on screen.
  const lastNoteRound = item.noteRounds?.length
    ? item.noteRounds[item.noteRounds.length - 1]
    : undefined;
  const currentRound = item.round ?? lastNoteRound?.round ?? 1;
  const priorRounds = (item.noteRounds ?? []).filter(
    (nr) => nr.round < currentRound && nr.note.trim().length > 0
  );
  const isRetest = currentRound > 1;
  const isFailing = item.verdict === "fail" || item.verdict === "blocked";
  const canFlag = onFlagBug !== undefined && isFailing && !item.bugId;

  return (
    <article
      className={`vv-item vv-item--${item.verdict}`}
      data-testid={`item-${item.id}`}
    >
      <div className="vv-item-main">
        <div className="vv-item-head">
          <code className="vv-item-id">{item.id}</code>
          {item.group && <span className="vv-item-group">{item.group}</span>}
          {isRetest && (
            <span
              className="vv-item-retest"
              title="Returned for a retest after its bug was fixed"
            >
              <RotateCw size={11} />
              Retest · round {currentRound}
            </span>
          )}
          {item.bugId && (
            <span className="vv-item-bug" title={`Open bug for this use case`}>
              <Bug size={11} />
              {item.bugId}
            </span>
          )}
          {item.changed && (
            <span className="vv-item-changed" title="Regenerated since your last verdict">
              <History size={11} />
              Changed
            </span>
          )}
        </div>

        <h3 className="vv-item-title">{item.title}</h3>

        {item.subject && (
          <div className="vv-item-field">
            <span className="vv-item-field-label">Subject</span>
            <p className="vv-item-field-text">{item.subject}</p>
          </div>
        )}
        {item.expected && (
          <div className="vv-item-field">
            <span className="vv-item-field-label">Expected</span>
            <p className="vv-item-field-text">{item.expected}</p>
          </div>
        )}

        {priorRounds.length > 0 && (
          <div className="vv-item-rounds" data-testid={`rounds-${item.id}`}>
            <span className="vv-item-field-label">Earlier rounds</span>
            {priorRounds.map((nr) => (
              <div key={nr.round} className="vv-item-round">
                <span className="vv-item-round-tag">Round {nr.round}</span>
                <p className="vv-item-round-note">{nr.note}</p>
              </div>
            ))}
          </div>
        )}

        <label className="vv-item-notes">
          <span className="vv-item-field-label">
            {isRetest ? `Notes · round ${currentRound}` : "Notes"}
          </span>
          <textarea
            ref={notesRef}
            className="vv-item-notes-input"
            data-testid={`notes-${item.id}`}
            placeholder="Add a note for the fix worklist (optional)…"
            rows={2}
            value={item.notes ?? ""}
            onChange={(e) => onNotesChange(item.id, e.target.value)}
          />
        </label>

        {(canFlag || item.bugId) && (
          <div className="vv-item-actions">
            {item.bugId ? (
              <span className="vv-item-flagged" data-testid={`flagged-${item.id}`}>
                <Bug size={13} />
                Bug raised — {item.bugId}. This use case reopens for a retest once
                the bug is Done.
              </span>
            ) : (
              <button
                type="button"
                className="vv-btn vv-btn--flag"
                data-testid={`flag-${item.id}`}
                onClick={() => onFlagBug?.(item.id)}
                disabled={flagging}
                title="Create a BUG for this failing use case and keep the story open until it's fixed"
              >
                {flagging ? <Loader2 size={13} className="vv-spinner" /> : <Bug size={13} />}
                {flagging ? "Raising bug…" : "Flag as bug"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="vv-item-controls">
        <VerdictControl
          itemId={item.id}
          value={item.verdict}
          onChange={(v) => onVerdictChange(item.id, v)}
        />
        <SeveritySelect
          itemId={item.id}
          value={item.severity}
          enabled={sevEnabled}
          onChange={(s) => onSeverityChange(item.id, s)}
        />
      </div>
    </article>
  );
}
