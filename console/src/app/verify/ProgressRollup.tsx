import { VERDICTS, type Verdict, type VerifyItem } from "../api/verify";

const VERDICT_LABEL: Record<Verdict, string> = {
  pending: "Pending",
  pass: "Pass",
  fail: "Fail",
  warn: "Warn",
  blocked: "Blocked",
};

/** Derive counts by verdict from the live item set (rollup is never source-of-truth). */
export function rollupCounts(items: VerifyItem[]): Record<Verdict, number> {
  const counts: Record<Verdict, number> = {
    pending: 0,
    pass: 0,
    fail: 0,
    warn: 0,
    blocked: 0,
  };
  for (const item of items) counts[item.verdict] += 1;
  return counts;
}

interface ProgressRollupProps {
  items: VerifyItem[];
}

/**
 * Progress rollup — counts by verdict plus a proportional bar. Recomputed from
 * the current (draft-inclusive) items on every render, so it tracks edits live.
 */
export function ProgressRollup({ items }: ProgressRollupProps) {
  const counts = rollupCounts(items);
  const total = items.length;
  const reviewed = total - counts.pending;

  return (
    <div className="vv-rollup" data-testid="rollup">
      <div className="vv-rollup-head">
        <span className="vv-rollup-title">Progress</span>
        <span className="vv-rollup-fraction" data-testid="rollup-reviewed">
          {reviewed}/{total} reviewed
        </span>
      </div>

      <div
        className="vv-rollup-bar"
        role="img"
        aria-label={`${reviewed} of ${total} items reviewed`}
      >
        {VERDICTS.map((v) =>
          counts[v] > 0 ? (
            <span
              key={v}
              className={`vv-rollup-bar-seg vv-rollup-bar--${v}`}
              style={{ flexGrow: counts[v] }}
            />
          ) : null
        )}
      </div>

      <ul className="vv-rollup-legend" role="list">
        {VERDICTS.map((v) => (
          <li key={v} className="vv-rollup-legend-item">
            <span className={`vv-rollup-dot vv-rollup-bar--${v}`} />
            <span className="vv-rollup-legend-label">{VERDICT_LABEL[v]}</span>
            <span
              className="vv-rollup-legend-n"
              data-testid={`rollup-count-${v}`}
            >
              {counts[v]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
