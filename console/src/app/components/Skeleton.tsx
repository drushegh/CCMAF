/**
 * Skeleton.tsx — shimmer loading placeholders (Console v2 §5.2, TASK-106).
 *
 * The empty/loading rule, applied by every page that adopts these:
 *   first load  → skeleton (these components)
 *   refetch     → keep last data (useLastReady in pages/lib.tsx)
 *   error       → <ErrorState> with retry
 *
 * Three primitive variants (skeleton-line / skeleton-card / skeleton-tile);
 * pages compose their own shapes from them (Dashboard = tile-grid ghosts,
 * Kanban = column ghosts, doc pages = a doc-card ghost). The shimmer is a CSS
 * background sweep that goes static under prefers-reduced-motion (skeleton.css).
 *
 * Accessibility: wrap a composed shape in <SkeletonGroup label="…"> — it carries
 * role="status" + a visually-hidden label so screen readers hear ONE "Loading X"
 * announcement; the individual ghost bars stay aria-hidden.
 */

import type { CSSProperties, ReactNode } from "react";
import "../../styles/skeleton.css";

/** A single ghost text line. `width` accepts any CSS width (e.g. "60%"). */
export function SkeletonLine({ width }: { width?: string }) {
  const style: CSSProperties | undefined = width ? { width } : undefined;
  return (
    <span className="skeleton skeleton-line" style={style} aria-hidden="true" />
  );
}

/** A ghost card: a title bar plus `lines` body lines of varying width. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  // Deterministic width cycle — organic-looking without Math.random() (which
  // would churn on every render and defeat snapshot/DOM assertions).
  const widths = ["92%", "78%", "85%", "64%", "88%", "71%"];
  return (
    <div className="skeleton-card" aria-hidden="true">
      <span className="skeleton skeleton-line skeleton-line--title" />
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="skeleton skeleton-line"
          style={{ width: widths[i % widths.length] }}
        />
      ))}
    </div>
  );
}

/** A ghost stat tile (icon chip + value + label) — vitals-strip shaped. */
export function SkeletonTile() {
  return (
    <div className="skeleton-tile" aria-hidden="true">
      <span className="skeleton skeleton-tile-icon" />
      <span className="skeleton skeleton-line skeleton-tile-value" />
      <span className="skeleton skeleton-line skeleton-tile-label" />
    </div>
  );
}

/**
 * Accessible wrapper for a composed skeleton shape. One announcement for the
 * whole shape; the ghosts inside are decoration.
 */
export function SkeletonGroup({
  label,
  className,
  children,
}: {
  /** Announced to screen readers, e.g. "Loading dashboard". */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={className ? `skeleton-group ${className}` : "skeleton-group"}
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
