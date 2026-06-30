/**
 * TaskFilterBar — a controlled filter/sort bar shown above task lists
 * (Kanban board + Verify queue). Presentational: it owns no state; the parent
 * holds a FilterState and re-renders its list through filterAndSortTasks.
 *
 * Controls: a search box, an optional "Show archived" checkbox (off by default),
 * a sort-key select, and an asc/desc toggle.
 */

import { Search, X, ArrowUp, ArrowDown } from "lucide-react";
import type { FilterState, SortKey } from "../lib/taskFilter";
import "../../styles/filter-bar.css";

const SORT_LABELS: Record<SortKey, string> = {
  id: "ID",
  status: "Status",
  title: "Title",
};

interface TaskFilterBarProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  /** Show the "Show archived" checkbox (default true). Off for the Verify queue. */
  showArchivedToggle?: boolean;
  /** Which sort keys to offer (default id/status/title). */
  sortKeys?: SortKey[];
  /** Optional "N shown" label on the right. */
  resultLabel?: string;
  /** Placeholder for the search input. */
  searchPlaceholder?: string;
}

export function TaskFilterBar({
  value,
  onChange,
  showArchivedToggle = true,
  sortKeys = ["id", "status", "title"],
  resultLabel,
  searchPlaceholder = "Filter by ID or title…",
}: TaskFilterBarProps) {
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="task-filter-bar" role="search">
      <div className="tfb-search">
        <Search size={14} className="tfb-search-icon" aria-hidden="true" />
        <input
          type="text"
          className="tfb-search-input"
          placeholder={searchPlaceholder}
          value={value.search}
          onChange={(e) => set({ search: e.target.value })}
          aria-label="Filter tasks"
          data-testid="task-filter-search"
        />
        {value.search && (
          <button
            type="button"
            className="tfb-search-clear"
            onClick={() => set({ search: "" })}
            aria-label="Clear filter"
          >
            <X size={13} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="tfb-controls">
        {showArchivedToggle && (
          <label className="tfb-archived">
            <input
              type="checkbox"
              checked={value.showArchived}
              onChange={(e) => set({ showArchived: e.target.checked })}
              data-testid="task-filter-archived"
            />
            Show archived
          </label>
        )}

        <div className="tfb-sort">
          <label className="tfb-sort-label" htmlFor="tfb-sort-select">
            Sort
          </label>
          <select
            id="tfb-sort-select"
            className="tfb-sort-select"
            value={value.sortKey}
            onChange={(e) => set({ sortKey: e.target.value as SortKey })}
            aria-label="Sort by"
            data-testid="task-filter-sort"
          >
            {sortKeys.map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="tfb-sort-dir"
            onClick={() => set({ sortDir: value.sortDir === "asc" ? "desc" : "asc" })}
            aria-label={
              value.sortDir === "asc"
                ? "Ascending — click for descending"
                : "Descending — click for ascending"
            }
            title={value.sortDir === "asc" ? "Ascending" : "Descending"}
            data-testid="task-filter-sortdir"
          >
            {value.sortDir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
          </button>
        </div>

        {resultLabel && <span className="tfb-result">{resultLabel}</span>}
      </div>
    </div>
  );
}
