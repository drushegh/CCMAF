/**
 * StatusPage.tsx — Render .claude/STATUS.md (TASK-027)
 *
 * The dashboard surfaces only the sprint-goal line; this page shows the full
 * project status (sprint goal, active work, recently completed, blockers, test
 * status, next-up) as rendered markdown. Read-only, live-refreshes via SSE.
 */

import { Activity } from "lucide-react";
import { PageLayout, EmptyState } from "../components/PageLayout";
import { fetchStateDoc } from "../api/analytics";
import { useAsync, LoadingState, ErrorState, Markdown } from "./lib";
import "../../styles/pages.css";

export function StatusPage() {
  const { phase, data, error, reload } = useAsync(
    () => fetchStateDoc("status"),
    []
  );

  return (
    <PageLayout
      title="Status"
      subtitle="Rendered from .claude/STATUS.md — read-only"
      badge="STATUS.md"
    >
      {phase === "loading" && <LoadingState label="Loading status…" />}
      {phase === "error" && <ErrorState error={error} onRetry={reload} />}
      {phase === "ready" &&
        (!data.exists || data.markdown.trim() === "" ? (
          <EmptyState
            icon={<Activity size={22} />}
            title="No STATUS.md found"
            description="This project has no .claude/STATUS.md (or it is empty). When one exists it is rendered here. The page degrades gracefully when the file is absent."
          />
        ) : (
          <div className="readme-doc">
            <Markdown source={data.markdown} />
          </div>
        ))}
    </PageLayout>
  );
}
