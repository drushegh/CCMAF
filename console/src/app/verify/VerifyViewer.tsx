import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react";
import { Save, RotateCcw, Check, CheckCheck } from "lucide-react";
import {
  severityApplies,
  type Severity,
  type Verdict,
  type VerdictPatch,
  type VerifyFile,
  type VerifyItem,
} from "../api/verify";
import { ProgressRollup } from "./ProgressRollup";
import { VerifyItemRow } from "./VerifyItem";
import "../../styles/verify.css";

type SaveState =
  | { phase: "idle" }
  | { phase: "saving" }
  | { phase: "saved" }
  | { phase: "error"; message: string };

interface VerifyViewerProps {
  file: VerifyFile;
  /**
   * Persist the verdicts. Resolves with the reconciled file from the server.
   * Optional so the viewer can be rendered read-only / in fixtures without a
   * live backend.
   */
  onSave?: (patches: VerdictPatch[]) => Promise<VerifyFile>;
  /** Notifies the parent when the unsaved-edits state changes (drives nav guards). */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Raise a BUG for a failing use case (the iterative loop). Resolves with the
   * new BUG id. When provided, each failing item shows a "Flag as bug" action;
   * on success the viewer records `bugId` on the item and persists immediately.
   */
  onCreateBug?: (item: VerifyItem) => Promise<string>;
  /**
   * Accept the whole story → move the task to Done. When provided, an
   * "Accept & Done" button shows, enabled only when every use case is `pass`
   * and there are no unsaved edits.
   */
  onAccept?: () => Promise<void>;
}

/** Imperative handle so a parent nav guard can read `dirty` and trigger a save. */
export interface VerifyViewerHandle {
  dirty: boolean;
  save: () => Promise<void>;
}

/** Build the canonical patch for one item, enforcing the severity business rule. */
function toPatch(item: VerifyItem): VerdictPatch {
  return {
    id: item.id,
    verdict: item.verdict,
    severity: severityApplies(item.verdict) ? item.severity ?? null : null,
    notes: item.notes ?? "",
    bugId: item.bugId ?? null,
  };
}

function itemsEqual(a: VerifyItem, b: VerifyItem): boolean {
  return (
    a.verdict === b.verdict &&
    (a.severity ?? null) === (b.severity ?? null) &&
    (a.notes ?? "") === (b.notes ?? "") &&
    (a.bugId ?? null) === (b.bugId ?? null)
  );
}

/**
 * The reusable verify viewer (US2). Renders ANY VerifyFile: per item a verdict
 * segmented control, a severity selector (enabled only for fail/warn), and a
 * notes field, with a live progress rollup. Save sends VerdictPatch[] via the
 * injected onSave (PUT /api/verify/:task + X-Console-Token).
 *
 * Draft edits live in component state only (DEC-002: transient client state is
 * allowed; the file on disk stays the source of truth until Save).
 */
export const VerifyViewer = forwardRef<VerifyViewerHandle, VerifyViewerProps>(
  function VerifyViewer({ file, onSave, onDirtyChange, onCreateBug, onAccept }, ref) {
  const [items, setItems] = useState<VerifyItem[]>(file.items);
  const [flaggingId, setFlaggingId] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  // The last-known *server* state, used as the dirty-comparison baseline. Seeded
  // from the prop, but updated on Save to the reconciled response — the parent
  // does NOT re-fetch the file prop after a write (it only refreshes the queue),
  // so the viewer must own its baseline or it would stay "dirty" forever after
  // a successful save (the unsaved-changes nav guard would then fire post-save).
  const [baseline, setBaseline] = useState<VerifyItem[]>(file.items);
  const [saveState, setSaveState] = useState<SaveState>({ phase: "idle" });

  // CRITICAL fix #1: resync local items + baseline and reset saveState when the
  // file identity changes (e.g. live-refresh re-fetch, Retry with a new file).
  // We gate on file.task as the stable identity key; a new task means a
  // wholly different file, so any unsaved edits are legitimately discarded.
  useEffect(() => {
    setItems(file.items);
    setBaseline(file.items);
    setSaveState({ phase: "idle" });
  }, [file.task]); // eslint-disable-line react-hooks/exhaustive-deps

  // WARNING fix #3: compare by item id, not by array index, so that a
  // reordered but otherwise-unchanged list is not treated as dirty. Compared
  // against `baseline` (last-known server state), not the prop.
  const serverById = useMemo(
    () => new Map(baseline.map((it) => [it.id, it])),
    [baseline]
  );

  const dirty = useMemo(
    () =>
      items.some((it) => {
        const server = serverById.get(it.id);
        return server === undefined || !itemsEqual(it, server);
      }),
    [items, serverById]
  );

  // Report dirty state up for the parent's unsaved-changes nav guard.
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  // Expose dirty + save to a parent nav guard. No deps array → the handle is
  // refreshed each render so `save` always closes over the latest items.
  useImperativeHandle(ref, () => ({ dirty, save: handleSave }));

  function patchItem(id: string, patch: Partial<VerifyItem>): void {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
    // WARNING fix #4: use updater form to avoid reading stale closure value.
    setSaveState((prev) => (prev.phase !== "idle" ? { phase: "idle" } : prev));
  }

  function handleVerdict(id: string, verdict: Verdict): void {
    // Clear severity when leaving fail/warn — contract: severity non-null
    // ONLY on fail/warn.
    const patch: Partial<VerifyItem> = severityApplies(verdict)
      ? { verdict }
      : { verdict, severity: null };
    patchItem(id, patch);
  }

  function handleSeverity(id: string, severity: Severity | null): void {
    patchItem(id, { severity });
  }

  function handleNotes(id: string, notes: string): void {
    patchItem(id, { notes });
  }

  function handleReset(): void {
    // Reset to the last-known server state (baseline), which may differ from the
    // now-stale prop after a save.
    setItems(baseline);
    setSaveState({ phase: "idle" });
  }

  // Persist a given item list (used by Save AND flag-as-bug, which must record
  // the new bugId immediately). Adopts the reconciled response as the new
  // baseline → dirty drops to false. Throws on failure (callers may react).
  async function persist(nextItems: VerifyItem[]): Promise<void> {
    if (!onSave) return;
    setSaveState({ phase: "saving" });
    try {
      const updated = await onSave(nextItems.map(toPatch));
      setItems(updated.items);
      setBaseline(updated.items);
      setSaveState({ phase: "saved" });
    } catch (err) {
      setSaveState({
        phase: "error",
        message: err instanceof Error ? err.message : "Save failed",
      });
      throw err;
    }
  }

  async function handleSave(): Promise<void> {
    try {
      await persist(items);
    } catch {
      /* error surfaced via saveState */
    }
  }

  // Flag a failing use case as a bug: create the BUG, link its id onto the item,
  // and persist at once so the link survives (the bug exists server-side now).
  async function handleFlagBug(id: string): Promise<void> {
    if (!onCreateBug) return;
    const item = items.find((it) => it.id === id);
    if (!item) return;
    setFlaggingId(id);
    try {
      const bugId = await onCreateBug(item);
      const next = items.map((it) => (it.id === id ? { ...it, bugId } : it));
      setItems(next);
      await persist(next);
    } catch (err) {
      setSaveState({
        phase: "error",
        message: err instanceof Error ? err.message : "Could not raise the bug",
      });
    } finally {
      setFlaggingId(null);
    }
  }

  async function handleAccept(): Promise<void> {
    if (!onAccept) return;
    setAccepting(true);
    try {
      await onAccept();
    } catch (err) {
      setSaveState({
        phase: "error",
        message: err instanceof Error ? err.message : "Could not accept",
      });
    } finally {
      setAccepting(false);
    }
  }

  // Accept gating: the story can be accepted (→ Done) only when EVERY use case
  // passes. The button additionally requires a clean save state so the verdicts
  // on disk match what's accepted.
  const allPass = items.length > 0 && items.every((it) => it.verdict === "pass");

  // Preserve item order but cluster by group for readability.
  const groups = useMemo(() => groupItems(items), [items]);

  return (
    <div className="vv-viewer" data-testid="verify-viewer">
      {/* Transient save confirmation — a fixed top-right toast so it never
          reflows the toolbar buttons. Fades itself out, then clears the state
          on animation end (no timer to drift). */}
      {saveState.phase === "saved" && !dirty && (
        <div
          className="vv-saved-toast"
          role="status"
          onAnimationEnd={() => setSaveState({ phase: "idle" })}
        >
          <Check size={13} /> Saved
        </div>
      )}

      <div className="vv-toolbar">
        <div className="vv-toolbar-meta">
          <code className="vv-toolbar-task">{file.task}</code>
          {file.branch && (
            <span className="vv-toolbar-branch">{file.branch}</span>
          )}
          {file.build && (
            <span className="vv-toolbar-build">build {file.build}</span>
          )}
          <span className={`vv-toolbar-status vv-toolbar-status--${file.status}`}>
            {file.status}
          </span>
        </div>

        <div className="vv-toolbar-actions">
          {saveState.phase === "error" && (
            <span className="vv-save-msg vv-save-msg--error" role="alert">
              {saveState.message}
            </span>
          )}
          <button
            type="button"
            className="vv-btn vv-btn--ghost"
            onClick={handleReset}
            disabled={!dirty || saveState.phase === "saving"}
          >
            <RotateCcw size={14} />
            Reset
          </button>
          <button
            type="button"
            className="vv-btn vv-btn--primary"
            onClick={handleSave}
            disabled={!onSave || !dirty || saveState.phase === "saving"}
            data-testid="save-btn"
          >
            <Save size={14} />
            {saveState.phase === "saving" ? "Saving…" : "Save verdicts"}
          </button>
          {onAccept && (
            <button
              type="button"
              className="vv-btn vv-btn--accept"
              onClick={() => void handleAccept()}
              disabled={!allPass || dirty || saveState.phase === "saving" || accepting}
              data-testid="accept-btn"
              title={
                !allPass
                  ? "Every use case must pass before you can accept"
                  : dirty
                    ? "Save your verdicts first"
                    : "Accept this story and move it to Done"
              }
            >
              <CheckCheck size={14} />
              {accepting ? "Accepting…" : "Accept & Done"}
            </button>
          )}
        </div>
      </div>

      <ProgressRollup items={items} />

      <div className="vv-items">
        {groups.map((g) => (
          <section key={g.name ?? "__ungrouped"} className="vv-group">
            {g.name && <h2 className="vv-group-title">{g.name}</h2>}
            <div className="vv-group-items">
              {g.items.map((item) => (
                <VerifyItemRow
                  key={item.id}
                  item={item}
                  onVerdictChange={handleVerdict}
                  onSeverityChange={handleSeverity}
                  onNotesChange={handleNotes}
                  onFlagBug={onCreateBug ? handleFlagBug : undefined}
                  flagging={flaggingId === item.id}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
});

interface ItemGroup {
  name?: string;
  items: VerifyItem[];
}

/** Cluster items by `group`, preserving first-seen order of both groups and items. */
function groupItems(items: VerifyItem[]): ItemGroup[] {
  const order: (string | undefined)[] = [];
  const byGroup = new Map<string | undefined, VerifyItem[]>();
  for (const item of items) {
    const key = item.group;
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      order.push(key);
    }
    byGroup.get(key)!.push(item);
  }
  return order.map((name) => ({ name, items: byGroup.get(name)! }));
}
