import { SEVERITIES, type Severity } from "../api/verify";

interface SeveritySelectProps {
  value: Severity | null | undefined;
  onChange: (severity: Severity | null) => void;
  /** When false, the control is shown but inert (verdict is not fail/warn). */
  enabled: boolean;
  itemId: string;
}

/**
 * Severity picker (P0–P3). Per contract:console-verify-file, severity is only
 * meaningful when the verdict is fail or warn, so it is disabled otherwise.
 * Disabled state still renders (so the row layout is stable) but cannot be set.
 *
 * WARNING fix #5 + #6: the wrapping <label> provides the accessible name for
 * the <select> (scoped to the item via aria-labelledby on the group). The
 * redundant aria-label was removed from the <select> — a wrapping label is
 * the single accessible name source; two competing names confuse AT.
 */
export function SeveritySelect({
  value,
  onChange,
  enabled,
  itemId,
}: SeveritySelectProps) {
  return (
    <label
      className={`vv-severity ${enabled ? "" : "is-disabled"}`}
      aria-label={`Severity for ${itemId}`}
    >
      <span className="vv-severity-label">Severity</span>
      <select
        className="vv-severity-select"
        data-testid={`severity-${itemId}`}
        disabled={!enabled}
        value={value ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? null : (v as Severity));
        }}
      >
        <option value="">—</option>
        {SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}
