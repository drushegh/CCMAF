import { PageLayout, EmptyState } from "../components/PageLayout";
import { fetchDecisions, type DecisionEntry } from "../api/state";
import { useAsync, LoadingState, ErrorState, Markdown } from "./lib";
import "../../styles/pages.css";

function DecisionCard({ entry }: { entry: DecisionEntry }) {
  const { id, date, status, title, body } = entry;
  return (
    <article className="decision-card">
      <div className="decision-card-header">
        <div className="decision-card-meta">
          <code className="decision-card-id">{id}</code>
          {date && <span className="decision-card-date">{date}</span>}
          {status && (
            <span className={`decision-card-status decision-card-status--${status}`}>
              {status}
            </span>
          )}
        </div>
        <h3 className="decision-card-title">{title}</h3>
      </div>
      {body && (
        <div className="decision-card-body">
          <Markdown source={body} />
        </div>
      )}
    </article>
  );
}

export function DecisionsPage() {
  const { phase, data, error, reload } = useAsync(fetchDecisions, []);

  return (
    <PageLayout
      title="Decisions"
      subtitle="Parsed from .claude/DECISIONS.md — newest first"
      badge="DECISIONS.md"
    >
      {phase === "loading" && <LoadingState label="Loading decision log…" />}
      {phase === "error" && <ErrorState error={error} onRetry={reload} />}
      {phase === "ready" &&
        (data.length === 0 ? (
          <EmptyState
            title="No decisions yet"
            description="No entries were parsed from .claude/DECISIONS.md. Recorded decisions appear here, newest first."
          />
        ) : (
          <div className="decisions-list">
            {data.map((d) => (
              <DecisionCard key={d.id} entry={d} />
            ))}
          </div>
        ))}
    </PageLayout>
  );
}
