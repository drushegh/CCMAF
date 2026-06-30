/**
 * GotchasPage.tsx — Structured view of .claude/GOTCHAS.md (TASK-027)
 *
 * The dashboard tiles only the gotcha COUNT; this page renders each lesson:
 * grouped by category, with a confidence badge (Verified / Working theory /
 * Hypothesis), encounter count, first-seen date, and the problem→fix body.
 * All from the existing `/api/gotchas` (gotchas-parser, now carrying `body`).
 */

import { Lightbulb, ShieldCheck, FlaskConical, HelpCircle } from "lucide-react";
import { PageLayout, EmptyState } from "../components/PageLayout";
import { fetchGotchas } from "../api/analytics";
import type { GotchaEntry } from "../api/analytics";
import { useAsync, LoadingState, ErrorState, Markdown } from "./lib";
import "../../styles/pages.css";

type ConfidenceTone = "ok" | "warn" | "info";

/** Classify a confidence string (e.g. "Verified (…)") into a tone + icon. */
function confidenceMeta(confidence: string): {
  tone: ConfidenceTone;
  icon: React.ReactNode;
} {
  const c = confidence.toLowerCase();
  if (c.startsWith("verified"))
    return { tone: "ok", icon: <ShieldCheck size={11} /> };
  if (c.startsWith("working"))
    return { tone: "warn", icon: <FlaskConical size={11} /> };
  return { tone: "info", icon: <HelpCircle size={11} /> };
}

function GotchaCard({ gotcha }: { gotcha: GotchaEntry }) {
  const { tone, icon } = confidenceMeta(gotcha.confidence);
  // The confidence string carries its detail after a `(`, an em/en-dash, or a
  // colon — e.g. "Verified (root cause …)" OR the framework's house style
  // "Verified — reproduced this session". Keep just the lead word in the badge
  // (so it can't overflow) and show the rest as muted context (BUG-013).
  const lead = gotcha.confidence.split(/\s*[(—–:]/)[0].trim() || "—";
  const detail = gotcha.confidence.slice(lead.length).trim();

  return (
    <article className="gotcha-card">
      <header className="gotcha-card-head">
        <h3 className="gotcha-card-title">{gotcha.title}</h3>
        <div className="gotcha-card-meta">
          <span className={`gotcha-badge gotcha-badge--${tone}`}>
            {icon}
            {lead}
          </span>
          {gotcha.count > 0 && (
            <span className="gotcha-count" title="Encounter count">
              ×{gotcha.count}
            </span>
          )}
        </div>
      </header>
      {detail && <p className="gotcha-confidence-detail">{detail}</p>}
      {gotcha.body && (
        <div className="gotcha-card-body">
          <Markdown source={gotcha.body} />
        </div>
      )}
      {gotcha.firstSeen && (
        <div className="gotcha-card-foot">First seen {gotcha.firstSeen}</div>
      )}
    </article>
  );
}

export function GotchasPage() {
  const { phase, data, error, reload } = useAsync(fetchGotchas, []);

  return (
    <PageLayout
      title="Gotchas"
      subtitle="Lessons learned — rendered from .claude/GOTCHAS.md"
      badge="GOTCHAS.md"
    >
      {phase === "loading" && <LoadingState label="Loading gotchas…" />}
      {phase === "error" && <ErrorState error={error} onRetry={reload} />}
      {phase === "ready" &&
        (data.length === 0 ? (
          <EmptyState
            icon={<Lightbulb size={22} />}
            title="No gotchas logged"
            description="No lessons have been recorded in .claude/GOTCHAS.md yet. As agents hit non-obvious behaviours they log them here, and they'll appear grouped by category."
          />
        ) : (
          <GotchasList gotchas={data} />
        ))}
    </PageLayout>
  );
}

function GotchasList({ gotchas }: { gotchas: GotchaEntry[] }) {
  // Group by category, preserving first-encounter order of categories.
  const groups: { category: string; items: GotchaEntry[] }[] = [];
  for (const g of gotchas) {
    const cat = g.category || "Uncategorised";
    let group = groups.find((x) => x.category === cat);
    if (!group) {
      group = { category: cat, items: [] };
      groups.push(group);
    }
    group.items.push(g);
  }

  return (
    <div className="gotchas-page">
      <div className="gotchas-summary">
        <Lightbulb size={14} />
        <span>
          {gotchas.length} lesson{gotchas.length === 1 ? "" : "s"} across{" "}
          {groups.length} categor{groups.length === 1 ? "y" : "ies"}
        </span>
      </div>
      {groups.map((group) => (
        <section key={group.category} className="gotcha-group">
          <h2 className="gotcha-group-title">
            {group.category}
            <span className="gotcha-group-count">{group.items.length}</span>
          </h2>
          <div className="gotcha-group-list">
            {group.items.map((g) => (
              <GotchaCard key={`${group.category}:${g.title}`} gotcha={g} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
