/**
 * StatusPage.tsx — Render .claude/STATUS.md (TASK-027; DocPage pattern TASK-106 §5.1)
 *
 * The dashboard surfaces only the sprint-goal line; this page shows the full
 * project status (sprint goal, active work, recently completed, blockers, test
 * status, next-up). Rendered through the shared DocPage pattern: 72ch column,
 * sticky TOC rail from the doc's h2/h3s, collapsible section cards, and a
 * `Last updated · bytes · STATUS.md` meta row. Read-only, live-refreshes via
 * SSE — refetches keep the last data on screen (§5.2).
 */

import { Activity } from "lucide-react";
import { PageLayout, EmptyState } from "../components/PageLayout";
import { DocPage } from "../components/DocPage";
import { SkeletonGroup, SkeletonCard } from "../components/Skeleton";
import { fetchStateDoc } from "../api/analytics";
import { useAsync, useLastReady, ErrorState } from "./lib";
import "../../styles/pages.css";

export function StatusPage() {
  const { phase, data, error, reload } = useAsync(
    () => fetchStateDoc("status"),
    [],
  );
  // §5.2: first load = skeleton; SSE refetch = keep last data; error = retry.
  const doc = useLastReady(phase, data);

  return (
    <PageLayout
      title="Status"
      subtitle="Rendered from .claude/STATUS.md — read-only"
      badge="STATUS.md"
    >
      {!doc && phase === "loading" && (
        <SkeletonGroup label="Loading status">
          <SkeletonCard lines={5} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={4} />
        </SkeletonGroup>
      )}
      {!doc && phase === "error" && (
        <ErrorState error={error} onRetry={reload} />
      )}
      {doc &&
        (!doc.exists || doc.markdown.trim() === "" ? (
          <EmptyState
            icon={<Activity size={22} />}
            title="No STATUS.md found"
            description="This project has no .claude/STATUS.md (or it is empty). When one exists it is rendered here. The page degrades gracefully when the file is absent."
          />
        ) : (
          <DocPage
            markdown={doc.markdown}
            file="STATUS.md"
            mtimeMs={doc.mtimeMs}
            page="status"
          />
        ))}
    </PageLayout>
  );
}
