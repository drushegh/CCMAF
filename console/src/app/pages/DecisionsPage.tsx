/**
 * DecisionsPage.tsx — parsed DECISIONS.md entries, newest first (TASK-006;
 * v2 §5.1 rail adoption TASK-106).
 *
 * Keeps the parsed-entry cards, but adopts the DocPage TOC rail (every entry
 * is a TOC item — scroll-spy highlighted, popover below 1100px) and
 * default-collapses entry bodies beyond the newest 10 — matching the cold-start
 * "read the top 10 decisions" rule. Explicit expands/collapses persist per tab
 * (sessionStorage). §5.2: first load = skeleton, refetch keeps last data.
 */

import { useCallback, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { PageLayout, EmptyState } from "../components/PageLayout";
import {
  DocLayout,
  useSectionCollapse,
  type TocEntry,
} from "../components/DocPage";
import { SkeletonGroup, SkeletonCard } from "../components/Skeleton";
import { fetchDecisions, type DecisionEntry } from "../api/state";
import { useAsync, useLastReady, ErrorState, Markdown } from "./lib";
import "../../styles/pages.css";
import "../../styles/docpage.css";

/** How many newest entries start expanded — the cold-start "top 10" echo. */
const EXPANDED_BY_DEFAULT = 10;

function entryDomId(id: string): string {
  return `dec-${id.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
}

function DecisionCard({
  entry,
  collapsed,
  onToggle,
}: {
  entry: DecisionEntry;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { id, date, status, title, body } = entry;
  const domId = entryDomId(id);
  const collapsible = Boolean(body);
  return (
    <article
      id={domId}
      className={`decision-card${collapsed ? " decision-card--collapsed" : ""}`}
    >
      <div className="decision-card-header">
        <div className="decision-card-meta">
          <code className="decision-card-id">{id}</code>
          {date && <span className="decision-card-date">{date}</span>}
          {status && (
            <span
              className={`decision-card-status decision-card-status--${status}`}
            >
              {status}
            </span>
          )}
        </div>
        {collapsible ? (
          <button
            type="button"
            className="decision-card-toggle"
            aria-expanded={collapsed ? "false" : "true"}
            aria-controls={`${domId}-body`}
            onClick={onToggle}
          >
            <ChevronDown
              size={14}
              className="decision-card-chevron"
              aria-hidden="true"
            />
            <h3 className="decision-card-title">{title}</h3>
          </button>
        ) : (
          <h3 className="decision-card-title">{title}</h3>
        )}
      </div>
      {body && (
        <div
          id={`${domId}-body`}
          className="decision-card-body"
          hidden={collapsed}
        >
          <Markdown source={body} />
        </div>
      )}
    </article>
  );
}

export function DecisionsPage() {
  const { phase, data, error, reload } = useAsync(fetchDecisions, []);
  const entries = useLastReady(phase, data);

  const { isCollapsed, toggle, setCollapsed } = useSectionCollapse("decisions");

  // Entries arrive newest-first; index >= 10 defaults to collapsed.
  const defaultCollapsed = useCallback(
    (index: number) => index >= EXPANDED_BY_DEFAULT,
    [],
  );

  const toc = useMemo(
    (): TocEntry[] =>
      (entries ?? []).map((d) => ({
        id: entryDomId(d.id),
        title: `${d.id} — ${d.title}`,
        level: 2,
      })),
    [entries],
  );

  const indexOf = useMemo(() => {
    const map = new Map<string, number>();
    (entries ?? []).forEach((d, i) => map.set(entryDomId(d.id), i));
    return map;
  }, [entries]);

  // A TOC jump to a collapsed entry expands it so the body is actually there.
  const expandForNavigate = useCallback(
    (domId: string) => {
      const i = indexOf.get(domId);
      if (i !== undefined && isCollapsed(domId, defaultCollapsed(i))) {
        setCollapsed(domId, false);
      }
    },
    [indexOf, isCollapsed, defaultCollapsed, setCollapsed],
  );

  return (
    <PageLayout
      title="Decisions"
      subtitle="Parsed from .claude/DECISIONS.md — newest first"
      badge="DECISIONS.md"
    >
      {!entries && phase === "loading" && (
        <SkeletonGroup label="Loading decision log">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
        </SkeletonGroup>
      )}
      {!entries && phase === "error" && (
        <ErrorState error={error} onRetry={reload} />
      )}
      {entries &&
        (entries.length === 0 ? (
          <EmptyState
            title="No decisions yet"
            description="No entries were parsed from .claude/DECISIONS.md. Recorded decisions appear here, newest first."
          />
        ) : (
          <DocLayout toc={toc} onBeforeNavigate={expandForNavigate}>
            <div className="decisions-list">
              {entries.map((d, i) => {
                const domId = entryDomId(d.id);
                const def = defaultCollapsed(i);
                return (
                  <DecisionCard
                    key={d.id}
                    entry={d}
                    collapsed={isCollapsed(domId, def)}
                    onToggle={() => toggle(domId, def)}
                  />
                );
              })}
            </div>
          </DocLayout>
        ))}
    </PageLayout>
  );
}
