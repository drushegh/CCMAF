/**
 * FindingsPage.tsx — Review + test findings (TASK-027)
 *
 * The dashboard shows only a Quality Gate badge; this page shows the parsed
 * summary (verdict / open criticals / last test run) PLUS the full text of
 * .claude/review-findings.md and .claude/test-findings.md rendered as markdown.
 * Summary from /api/findings; bodies from /api/statedoc/{review,test}-findings.
 */

import {
  ClipboardCheck,
  CheckCircle,
  AlertTriangle,
  XCircle,
  FlaskConical,
} from "lucide-react";
import { PageLayout } from "../components/PageLayout";
import { fetchFindings, fetchStateDoc } from "../api/analytics";
import { useAsync, LoadingState, ErrorState, Markdown } from "./lib";
import "../../styles/pages.css";

function FindingsSummaryStrip() {
  const { phase, data } = useAsync(fetchFindings, []);
  if (phase !== "ready") return null;

  const isApproved =
    data.review.latestVerdict === "APPROVE" ||
    data.review.latestVerdict === "APPROVED";

  return (
    <div className="findings-summary">
      <div
        className={`findings-stat findings-stat--${
          isApproved ? "ok" : data.review.latestVerdict ? "warn" : "neutral"
        }`}
      >
        <span className="findings-stat-label">Latest review verdict</span>
        <span className="findings-stat-value">
          {isApproved ? (
            <CheckCircle size={13} />
          ) : data.review.latestVerdict ? (
            <AlertTriangle size={13} />
          ) : null}
          {data.review.latestVerdict ?? "—"}
        </span>
      </div>
      <div
        className={`findings-stat findings-stat--${
          data.review.openCriticals > 0 ? "danger" : "ok"
        }`}
      >
        <span className="findings-stat-label">Open criticals</span>
        <span className="findings-stat-value">
          {data.review.openCriticals > 0 && <XCircle size={13} />}
          {data.review.openCriticals}
        </span>
      </div>
      <div className="findings-stat findings-stat--neutral">
        <span className="findings-stat-label">Last test run</span>
        <span className="findings-stat-value findings-stat-value--mono">
          {data.test.lastRun ?? "—"}
          {data.test.pass != null && (
            <span className="findings-stat-sub">
              {" "}
              {data.test.pass}✓
              {data.test.fail != null && data.test.fail > 0
                ? ` ${data.test.fail}✗`
                : ""}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function FindingsDoc({
  docKey,
  title,
  icon,
  emptyLabel,
}: {
  docKey: string;
  title: string;
  icon: React.ReactNode;
  emptyLabel: string;
}) {
  const { phase, data, error, reload } = useAsync(
    () => fetchStateDoc(docKey),
    [docKey]
  );

  return (
    <section className="findings-section">
      <h2 className="findings-section-title">
        {icon}
        {title}
      </h2>
      {phase === "loading" && <LoadingState label={`Loading ${title}…`} />}
      {phase === "error" && <ErrorState error={error} onRetry={reload} />}
      {phase === "ready" &&
        (!data.exists || data.markdown.trim() === "" ? (
          <p className="findings-empty">{emptyLabel}</p>
        ) : (
          <div className="readme-doc findings-doc">
            <Markdown source={data.markdown} />
          </div>
        ))}
    </section>
  );
}

export function FindingsPage() {
  return (
    <PageLayout
      title="Findings"
      subtitle="Review & test findings — read-only"
      badge="findings"
    >
      <div className="findings-page">
        <FindingsSummaryStrip />
        <FindingsDoc
          docKey="review-findings"
          title="Review findings"
          icon={<ClipboardCheck size={14} />}
          emptyLabel="No review findings recorded (.claude/review-findings.md is absent or empty)."
        />
        <FindingsDoc
          docKey="test-findings"
          title="Test findings"
          icon={<FlaskConical size={14} />}
          emptyLabel="No test findings recorded (.claude/test-findings.md is absent or empty)."
        />
      </div>
    </PageLayout>
  );
}
