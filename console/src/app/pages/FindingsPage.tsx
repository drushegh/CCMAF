/**
 * FindingsPage.tsx — Review + test findings (TASK-027; DocPage pattern TASK-106 §5.1)
 *
 * The dashboard shows only a Quality Gate badge; this page shows the parsed
 * summary (verdict / open criticals / last test run) PLUS the full text of
 * .claude/review-findings.md and .claude/test-findings.md.
 *
 * v2 §5.1: both docs render through the shared DocPage pieces — one combined
 * TOC rail (each doc is a top-level entry; its h2 sections nest beneath),
 * collapsible h2 section cards, and a per-doc `Last updated · bytes · FILE`
 * meta row. §5.2: first load = skeleton, SSE refetch keeps last data,
 * error = retry.
 */

import { useCallback, useMemo } from "react";
import {
  ClipboardCheck,
  CheckCircle,
  AlertTriangle,
  XCircle,
  FlaskConical,
} from "lucide-react";
import { PageLayout } from "../components/PageLayout";
import {
  DocLayout,
  DocMeta,
  DocSectionCard,
  splitMarkdownSections,
  useSectionCollapse,
  byteLength,
  type DocSplit,
  type TocEntry,
} from "../components/DocPage";
import { SkeletonGroup, SkeletonCard } from "../components/Skeleton";
import { fetchFindings, fetchStateDoc, type StateDoc } from "../api/analytics";
import { useAsync, useLastReady, ErrorState, Markdown } from "./lib";
import "../../styles/pages.css";

function FindingsSummaryStrip() {
  const { phase, data } = useAsync(fetchFindings, []);
  const summary = useLastReady(phase, data);
  if (!summary) return null;

  const isApproved =
    summary.review.latestVerdict === "APPROVE" ||
    summary.review.latestVerdict === "APPROVED";

  return (
    <div className="findings-summary">
      <div
        className={`findings-stat findings-stat--${
          isApproved ? "ok" : summary.review.latestVerdict ? "warn" : "neutral"
        }`}
      >
        <span className="findings-stat-label">Latest review verdict</span>
        <span className="findings-stat-value">
          {isApproved ? (
            <CheckCircle size={13} />
          ) : summary.review.latestVerdict ? (
            <AlertTriangle size={13} />
          ) : null}
          {summary.review.latestVerdict ?? "—"}
        </span>
      </div>
      <div
        className={`findings-stat findings-stat--${
          summary.review.openCriticals > 0 ? "danger" : "ok"
        }`}
      >
        <span className="findings-stat-label">Open criticals</span>
        <span className="findings-stat-value">
          {summary.review.openCriticals > 0 && <XCircle size={13} />}
          {summary.review.openCriticals}
        </span>
      </div>
      <div className="findings-stat findings-stat--neutral">
        <span className="findings-stat-label">Last test run</span>
        <span className="findings-stat-value findings-stat-value--mono">
          {summary.test.lastRun ?? "—"}
          {summary.test.pass != null && (
            <span className="findings-stat-sub">
              {" "}
              {summary.test.pass}✓
              {summary.test.fail != null && summary.test.fail > 0
                ? ` ${summary.test.fail}✗`
                : ""}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

/** One findings doc: title row + meta + its h2 sections as collapsible cards. */
function FindingsDocSections({
  docId,
  title,
  icon,
  file,
  doc,
  split,
  emptyLabel,
  phase,
  error,
  reload,
  isCollapsed,
  toggle,
}: {
  docId: string;
  title: string;
  icon: React.ReactNode;
  file: string;
  doc: StateDoc | undefined;
  split: DocSplit | null;
  emptyLabel: string;
  phase: string;
  error: Error | undefined;
  reload: () => void;
  isCollapsed: (id: string) => boolean;
  toggle: (id: string) => void;
}) {
  return (
    <section className="findings-section" id={docId}>
      <h2 className="findings-section-title">
        {icon}
        {title}
      </h2>
      {!doc && phase === "loading" && (
        <SkeletonGroup label={`Loading ${title}`}>
          <SkeletonCard lines={4} />
        </SkeletonGroup>
      )}
      {!doc && phase === "error" && error && (
        <ErrorState error={error} onRetry={reload} />
      )}
      {doc &&
        (!doc.exists || doc.markdown.trim() === "" ? (
          <p className="findings-empty">{emptyLabel}</p>
        ) : (
          <>
            <DocMeta
              file={file}
              mtimeMs={doc.mtimeMs}
              bytes={byteLength(doc.markdown)}
            />
            {split?.preamble && (
              <div className="docpage-preamble">
                <Markdown source={split.preamble} />
              </div>
            )}
            {split?.sections.map((s) => (
              <DocSectionCard
                key={s.id}
                id={s.id}
                title={s.title}
                collapsed={isCollapsed(s.id)}
                onToggle={() => toggle(s.id)}
              >
                <Markdown source={s.body} />
              </DocSectionCard>
            ))}
          </>
        ))}
    </section>
  );
}

const DOCS = [
  {
    key: "review-findings",
    docId: "doc-review-findings",
    title: "Review findings",
    file: "review-findings.md",
    emptyLabel:
      "No review findings recorded (.claude/review-findings.md is absent or empty).",
  },
  {
    key: "test-findings",
    docId: "doc-test-findings",
    title: "Test findings",
    file: "test-findings.md",
    emptyLabel:
      "No test findings recorded (.claude/test-findings.md is absent or empty).",
  },
] as const;

export function FindingsPage() {
  // Both docs are fetched here (not in the child) so the combined TOC can be
  // built once across the pair.
  const review = useAsync(() => fetchStateDoc("review-findings"), []);
  const test = useAsync(() => fetchStateDoc("test-findings"), []);
  const reviewDoc = useLastReady(review.phase, review.data);
  const testDoc = useLastReady(test.phase, test.data);

  const splits = useMemo(() => {
    const make = (doc: StateDoc | undefined, key: string): DocSplit | null =>
      doc && doc.exists && doc.markdown.trim() !== ""
        ? splitMarkdownSections(doc.markdown, key)
        : null;
    return {
      "review-findings": make(reviewDoc, "review-findings"),
      "test-findings": make(testDoc, "test-findings"),
    } as Record<string, DocSplit | null>;
  }, [reviewDoc, testDoc]);

  // Combined TOC: each doc is a level-2 entry; its h2 sections nest as level-3.
  // (The docs' own h3s stay out of the rail — two docs deep is enough.)
  const toc = useMemo(() => {
    const entries: TocEntry[] = [];
    for (const d of DOCS) {
      entries.push({ id: d.docId, title: d.title, level: 2 });
      const split = splits[d.key];
      if (split) {
        for (const s of split.sections) {
          entries.push({ id: s.id, title: s.title, level: 3 });
        }
      }
    }
    return entries;
  }, [splits]);

  const { isCollapsed, toggle, setCollapsed } = useSectionCollapse("findings");

  // A TOC jump into a collapsed section card expands it first.
  const expandForNavigate = useCallback(
    (id: string) => {
      if (isCollapsed(id)) setCollapsed(id, false);
    },
    [isCollapsed, setCollapsed],
  );

  const states = { "review-findings": review, "test-findings": test } as const;
  const docs = {
    "review-findings": reviewDoc,
    "test-findings": testDoc,
  } as const;

  return (
    <PageLayout
      title="Findings"
      subtitle="Review & test findings — read-only"
      badge="findings"
    >
      <div className="findings-page">
        <FindingsSummaryStrip />
        <DocLayout toc={toc} onBeforeNavigate={expandForNavigate}>
          {DOCS.map((d) => {
            const state = states[d.key];
            return (
              <FindingsDocSections
                key={d.key}
                docId={d.docId}
                title={d.title}
                icon={
                  d.key === "review-findings" ? (
                    <ClipboardCheck size={14} />
                  ) : (
                    <FlaskConical size={14} />
                  )
                }
                file={d.file}
                doc={docs[d.key]}
                split={splits[d.key]}
                emptyLabel={d.emptyLabel}
                phase={state.phase}
                error={state.error}
                reload={state.reload}
                isCollapsed={isCollapsed}
                toggle={toggle}
              />
            );
          })}
        </DocLayout>
      </div>
    </PageLayout>
  );
}
