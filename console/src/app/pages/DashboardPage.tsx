/**
 * DashboardPage.tsx — Real-data dashboard (TASK-007, reworked TASK-025/026)
 *
 * Fetches data from:
 *   GET /api/dashboard  → DashboardSummary (handback queue, tasks, contracts, decisions)
 *   GET /api/telemetry  → TelemetrySummary (hook activity, drift, last session)
 *   GET /api/findings   → FindingsSummary (review verdict, test results)
 *   GET /api/gotchas    → GotchaEntry[] (gotchas count + flag)
 *   GET /api/framework  → FrameworkHealth (version, update, healthcheck, doctor)
 *   GET /api/suggestions → SuggestionEntry[] (framework backlog)
 *
 * All use useAsync + SSE live-refresh. Each card gracefully handles absent data.
 *
 * Design note (TASK-026, buckets 1+2 of the cockpit visual pass): every number,
 * label, badge, %, and bar on this page is DERIVED FROM REAL `.claude/` STATE —
 * no fabricated owners, due dates, or invented metrics. The per-hook "health %"
 * is the share of NON-ADVERSE outcomes (see ADVERSE_OUTCOME), a defined metric,
 * not a guess.
 */

import { Link } from "react-router-dom";
import {
  Activity,
  Kanban,
  FileText,
  BookOpen,
  CheckSquare,
  CheckCircle2,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  TrendingUp,
  ArrowUp,
  List,
  Hourglass,
  Eye,
  FlaskConical,
  Bug,
  ScrollText,
  Lightbulb,
  Flame,
  Inbox,
  ShieldCheck,
  Layers,
  Compass,
  GitBranch,
  Target,
} from "lucide-react";

import { useAsync, useLastReady, ErrorState } from "./lib.js";
import {
  SkeletonGroup,
  SkeletonTile,
  SkeletonCard,
  SkeletonLine,
} from "../components/Skeleton.js";
import { fetchDashboard } from "../api/dashboard.js";
import type { DashboardSummary, VerifyRef } from "../api/dashboard.js";
import {
  fetchTelemetry,
  fetchFindings,
  fetchGotchas,
  fetchFrameworkHealth,
  fetchSuggestions,
} from "../api/analytics.js";
import type {
  TelemetrySummary,
  FindingsSummary,
  GotchaEntry,
  FrameworkHealth,
  SuggestionEntry,
} from "../api/analytics.js";

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * An outcome key counts as "adverse" if it signals a hook caught/blocked
 * something or a check failed — as opposed to the hook doing its normal job
 * (filtering, skipping, passing through). Used to derive an honest per-hook
 * health %: filtering test output or skipping a no-op format is NOT a problem,
 * so those don't count against a hook. Only real adverse signals do.
 */
const ADVERSE_OUTCOME =
  /block|fail|error|flag|reject|drift-detected|stop_blocked/i;

interface HookHealth {
  pct: number;
  status: "OK" | "WARN" | "ALERT";
  adverse: number;
  total: number;
}

function hookHealth(
  outcomes: Record<string, number>,
  declaredTotal: number,
): HookHealth {
  const adverse = Object.entries(outcomes).reduce(
    (s, [k, v]) => (ADVERSE_OUTCOME.test(k) ? s + v : s),
    0,
  );
  const total =
    declaredTotal || Object.values(outcomes).reduce((a, b) => a + b, 0) || 1;
  const pct = Math.round(((total - adverse) / total) * 100);
  const status = pct >= 90 ? "OK" : pct >= 50 ? "WARN" : "ALERT";
  return { pct, status, adverse, total };
}

type Tone = "accent" | "ok" | "warn" | "danger" | "info";

// ── Vitals tile ───────────────────────────────────────────────────────────────

interface TileProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  status?: string;
  tone?: Tone;
  to?: string;
}

function Tile({ label, value, icon, status, tone, to }: TileProps) {
  const inner = (
    <div className={`stat-card${tone ? ` stat-card--${tone}` : ""}`}>
      <span className="stat-card-icon">{icon}</span>
      <span className="stat-card-value">{value}</span>
      <span className="stat-card-label">{label}</span>
      {status && <span className="stat-card-status">{status}</span>}
    </div>
  );
  if (to) {
    return (
      <Link to={to} className="stat-card-link">
        {inner}
      </Link>
    );
  }
  return inner;
}

// ── Section shell ─────────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  icon?: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

function Section({
  title,
  icon,
  subtitle,
  children,
  action,
  footer,
  className,
}: SectionProps) {
  return (
    <section className={`dashboard-section${className ? ` ${className}` : ""}`}>
      <div className="dashboard-section-header">
        <div className="dashboard-section-heading">
          <span className="dashboard-section-title">
            {icon && <span className="dashboard-section-icon">{icon}</span>}
            {title}
          </span>
          {subtitle && (
            <span className="dashboard-section-subtitle">{subtitle}</span>
          )}
        </div>
        {action}
      </div>
      {children}
      {footer && <div className="dashboard-section-footer">{footer}</div>}
    </section>
  );
}

// ── Context strip (v2 §5.3, TASK-106) ─────────────────────────────────────────
// Replaces the ~230px dashboard-hero: the header already names the project, so
// the hero's only unique payload was the sprint goal. One 56px row now carries
// it plus the framework-state chips (branch / update / doctor) and the spec
// link — vitals and the handback queue rise above the fold at 800px height.
// The old hero-stats "N tasks · N contracts" pill was redundant with the tiles
// directly below and is gone. All values remain real `.claude/` state.

function ContextChip({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "ok" | "warn" | "neutral";
}) {
  return (
    <span className={`ctx-chip ctx-chip--${tone}`}>
      <span className="ctx-chip-icon">{icon}</span>
      <span className="ctx-chip-label">{label}</span>
      <span className="ctx-chip-value">{value}</span>
    </span>
  );
}

function ContextStrip({
  sprintGoal,
  currentSpec,
  health,
}: {
  sprintGoal: string | null;
  currentSpec: string | null;
  health: FrameworkHealth | null;
}) {
  const goal =
    sprintGoal && sprintGoal.length > 160
      ? sprintGoal.slice(0, 160).trimEnd() + "…"
      : sprintGoal;
  return (
    <div className="dashboard-context-strip">
      <span className="ctx-goal" title={sprintGoal ?? undefined}>
        <Target size={13} className="ctx-goal-icon" aria-hidden="true" />
        <span className={`ctx-goal-text${goal ? "" : " ctx-goal-text--empty"}`}>
          {goal ?? "No sprint goal set"}
        </span>
      </span>
      <span className="ctx-chips">
        {health?.version && (
          <ContextChip
            label="Branch"
            value={health.version}
            icon={<GitBranch size={12} />}
          />
        )}
        {health &&
          (health.updateAvailable ? (
            <ContextChip
              label="Update"
              value="available"
              icon={<ArrowUp size={12} />}
              tone="warn"
            />
          ) : (
            <ContextChip
              label="Framework"
              value="up to date"
              icon={<CheckCircle size={12} />}
              tone="ok"
            />
          ))}
        {health && (
          <ContextChip
            label="Doctor"
            value={health.doctorClean ? "clean" : "findings"}
            icon={<ShieldCheck size={12} />}
            tone={health.doctorClean ? "ok" : "warn"}
          />
        )}
        {currentSpec && (
          <Link
            to={`/spec/${encodeURIComponent(currentSpec)}`}
            className="ctx-chip ctx-chip--link"
          >
            <span className="ctx-chip-icon">
              <FileText size={12} />
            </span>
            <span className="ctx-chip-value">{currentSpec}</span>
          </Link>
        )}
      </span>
    </div>
  );
}

// ── Handback queue ────────────────────────────────────────────────────────────

function HandbackQueue({ items }: { items: VerifyRef[] }) {
  if (items.length === 0) {
    return (
      <div className="handback-empty">
        <CheckCircle2 size={32} className="handback-empty-icon" />
        <span className="handback-empty-title">No tasks awaiting verdict</span>
        <span className="handback-empty-desc">
          Tasks in <code>Ready for Test</code> will appear here once a pass-file
          is written by the Tester.
        </span>
      </div>
    );
  }

  return (
    <ul className="handback-queue-list">
      {items.map((item) => {
        const total = Object.values(item.counts).reduce((a, b) => a + b, 0);
        const pending = item.counts["pending"] ?? 0;
        const reviewed = total - pending;
        const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0;
        const state = pct === 100 ? "done" : pct > 0 ? "active" : "idle";
        return (
          <li key={item.task} className="handback-queue-item">
            <Link to={`/verify/${item.task}`} className="handback-queue-link">
              <span
                className={`handback-queue-bar handback-queue-bar--${state}`}
              />
              <span className="handback-queue-main">
                <span className="handback-queue-toprow">
                  <span className="handback-queue-id">{item.task}</span>
                  {item.title && item.title !== item.task && (
                    <span className="handback-queue-title">{item.title}</span>
                  )}
                </span>
                <span className="handback-queue-progress">
                  <span className="handback-queue-track">
                    <span
                      className={`handback-queue-fill handback-queue-fill--${state}`}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="handback-queue-pct">{pct}%</span>
                </span>
              </span>
              <span className="handback-queue-meta">
                {pending}/{total} pending
              </span>
              <AlertCircle size={13} className="handback-queue-arrow" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

// ── Vitals strip ──────────────────────────────────────────────────────────────
// One full-width band of EXACTLY TEN uniform number tiles on a deterministic
// grid (see .vitals-strip). Each tile carries an icon, value, label, and an
// honest status descriptor derived from the value. Ten tiles → the column count
// always divides into complete rows (5×2 / 10×1 / 2×5). The two rows of five
// group naturally: row 1 = task lifecycle, row 2 = quality + framework health.

function Vitals({
  dashboard,
  telemetry,
  gotchas,
  findings,
}: {
  dashboard: DashboardSummary;
  telemetry: TelemetrySummary | null;
  gotchas: GotchaEntry[] | null;
  findings: FindingsSummary | null;
}) {
  const counts = dashboard.taskCounts;
  const sum = (pred: (c: (typeof counts)[number]) => boolean) =>
    counts.filter(pred).reduce((s, c) => s + c.n, 0);

  const inProgress = sum((c) => c.status.toLowerCase().includes("progress"));
  const readyForReview = sum((c) => c.status.toLowerCase().includes("review"));
  const readyForTest = sum(
    (c) =>
      c.status.toLowerCase().includes("test") &&
      !c.status.toLowerCase().includes("ready for review"),
  );
  const done = sum((c) => c.status.toLowerCase() === "done");
  // OPEN bugs only — a Done bug isn't "requires attention". (All-time bug count
  // including Done was misleading: it read "N bugs / Requires attention" even
  // when every bug was fixed.) DEC-018: honest derived data.
  const bugsOpen = sum(
    (c) => c.lane === "bug" && c.status.toLowerCase() !== "done",
  );

  const stable =
    dashboard.contractCounts.find((c) => c.status === "stable")?.n ?? 0;
  const draft =
    dashboard.contractCounts.find((c) => c.status === "draft")?.n ?? 0;

  const gotchaCount = gotchas?.length ?? 0;
  const totalEvents = telemetry?.total_events ?? 0;
  const sessions = telemetry?.sessions ?? 0;
  const driftFires = telemetry
    ? Object.values(telemetry.by_session).reduce(
        (s, sess) => s + sess.drift_fires,
        0,
      )
    : 0;
  const openCriticals = findings?.review.openCriticals ?? 0;

  return (
    <div className="vitals-strip">
      {/* Row 1 — task lifecycle (all → Kanban) */}
      <Tile
        label="In Progress"
        value={inProgress}
        icon={<Hourglass size={15} />}
        tone={inProgress > 0 ? "accent" : undefined}
        status={inProgress > 0 ? "Active work" : "Idle"}
        to="/kanban"
      />
      <Tile
        label="Ready for Review"
        value={readyForReview}
        icon={<Eye size={15} />}
        status={readyForReview > 0 ? "Awaiting review" : "Clear"}
        to="/kanban"
      />
      <Tile
        label="Ready for Test"
        value={readyForTest}
        icon={<FlaskConical size={15} />}
        tone={readyForTest > 0 ? "accent" : undefined}
        status={readyForTest > 0 ? "Tests waiting" : "Clear"}
        to="/kanban"
      />
      <Tile
        label="Done"
        value={done}
        icon={<CheckCircle2 size={15} />}
        tone="ok"
        status="Completed"
        to="/kanban"
      />
      <Tile
        label="Open Bugs"
        value={bugsOpen}
        icon={<Bug size={15} />}
        tone={bugsOpen > 0 ? "danger" : undefined}
        status={bugsOpen > 0 ? "Requires attention" : "None open"}
        to="/kanban?lane=bug"
      />
      {/* Row 2 — quality + framework health */}
      <Tile
        label="Contracts"
        value={stable}
        icon={<ScrollText size={15} />}
        status={`${draft} draft`}
        to="/contracts"
      />
      <Tile
        label="Open Criticals"
        value={openCriticals}
        icon={<AlertTriangle size={15} />}
        tone={openCriticals > 0 ? "danger" : undefined}
        status={openCriticals > 0 ? "High priority" : "Clear"}
        to="/findings"
      />
      <Tile
        label="Gotchas"
        value={gotchaCount}
        icon={<Lightbulb size={15} />}
        status="Lessons logged"
        to="/gotchas"
      />
      <Tile
        label="Hook Events"
        value={totalEvents.toLocaleString()}
        icon={<Activity size={15} />}
        tone="info"
        status={`${sessions} session${sessions === 1 ? "" : "s"}`}
      />
      <Tile
        label="Drift Fires"
        value={driftFires}
        icon={<Flame size={15} />}
        tone={driftFires > 0 ? "warn" : undefined}
        status={driftFires > 0 ? "Guard triggers" : "None"}
      />
    </div>
  );
}

// ── Decisions section ─────────────────────────────────────────────────────────

function LatestDecisions({
  decisions,
}: {
  decisions: { id: string; title: string; date: string; status: string }[];
}) {
  if (decisions.length === 0) {
    return <p className="dashboard-empty-text">No decisions recorded yet.</p>;
  }
  return (
    <ul className="decision-list">
      {decisions.map((d) => (
        <li key={d.id} className="decision-list-item">
          <span className="decision-list-id">{d.id}</span>
          <span className="decision-list-title">{d.title}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Framework Activity card ───────────────────────────────────────────────────

function HookBadge({ status }: { status: HookHealth["status"] }) {
  const tone = status === "OK" ? "ok" : status === "WARN" ? "warn" : "alert";
  return <span className={`hook-badge hook-badge--${tone}`}>{status}</span>;
}

function FrameworkActivityCard({ data }: { data: TelemetrySummary | null }) {
  if (!data || data.total_events === 0) {
    return (
      <p className="dashboard-empty-text">
        No telemetry data yet. Run a session with hooks enabled.
      </p>
    );
  }

  // Top hooks by total events, each with a derived health % (non-adverse share)
  // and an OK / WARN / ALERT badge. The bar length encodes the health %; its
  // colour encodes the status — a short red bar reads as "mostly adverse".
  const topHooks = Object.entries(data.by_hook)
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, 6);

  return (
    <div className="analytics-card-body">
      <div className="hook-table">
        <div className="hook-row hook-row--head">
          <span>Hook</span>
          <span className="hook-col-num">Events</span>
          <span>Outcomes</span>
          <span className="hook-col-health">Health</span>
        </div>
        {topHooks.map(([hook, stats]) => {
          const health = hookHealth(stats.outcomes, stats.total);
          return (
            <div key={hook} className="hook-row">
              <span className="hook-name">{hook}</span>
              <span className="hook-col-num hook-total">{stats.total}</span>
              <span className="hook-outcomes">
                {Object.entries(stats.outcomes)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(" ")}
              </span>
              <span className="hook-health">
                <span className="hook-bar">
                  <span
                    className={`hook-bar-fill hook-bar-fill--${health.status.toLowerCase()}`}
                    style={{ width: `${health.pct}%` }}
                  />
                </span>
                <span className="hook-pct">{health.pct}%</span>
                <HookBadge status={health.status} />
              </span>
            </div>
          );
        })}
      </div>
      {data.lastSession && (
        <div className="analytics-caption">
          Last session ·{" "}
          {data.lastSession.toolUses != null
            ? `${data.lastSession.toolUses} tool-uses`
            : "—"}
          {data.lastSession.transcriptLines != null
            ? ` · ${data.lastSession.transcriptLines} lines`
            : ""}
        </div>
      )}
    </div>
  );
}

// ── Quality Gate card ─────────────────────────────────────────────────────────

function QualityCard({ findings }: { findings: FindingsSummary | null }) {
  if (!findings) {
    return (
      <p className="dashboard-empty-text">
        No quality data yet (review/test findings absent).
      </p>
    );
  }

  const isApproved =
    findings.review.latestVerdict === "APPROVE" ||
    findings.review.latestVerdict === "APPROVED";

  return (
    <div className="analytics-card-body">
      <div className="quality-row">
        <span className="quality-row-label">Latest review verdict</span>
        <span
          className={`quality-verdict ${
            isApproved
              ? "quality-verdict--ok"
              : findings.review.latestVerdict
                ? "quality-verdict--warn"
                : ""
          }`}
        >
          {findings.review.latestVerdict ?? "—"}
          <span className="quality-verdict-badge">
            {isApproved ? (
              <CheckCircle size={14} />
            ) : findings.review.latestVerdict ? (
              <AlertTriangle size={14} />
            ) : null}
          </span>
        </span>
      </div>
      <div className="quality-row">
        <span className="quality-row-label">Last test run</span>
        <span className="quality-row-value">
          {findings.test.lastRun ?? "—"}
          {findings.test.pass != null && (
            <span className="quality-row-sub">
              {" "}
              {findings.test.pass}✓
              {findings.test.fail != null && findings.test.fail > 0
                ? ` ${findings.test.fail}✗`
                : ""}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function qualityFooter(findings: FindingsSummary | null): React.ReactNode {
  if (!findings) return null;
  const isApproved =
    findings.review.latestVerdict === "APPROVE" ||
    findings.review.latestVerdict === "APPROVED";
  const testsClean = findings.test.fail == null || findings.test.fail === 0;
  const allPassing =
    isApproved && findings.review.openCriticals === 0 && testsClean;
  return (
    <span
      className={`quality-status quality-status--${allPassing ? "ok" : "warn"}`}
    >
      <span className="quality-status-dot" />
      {allPassing ? "All quality checks passing" : "Attention needed"}
    </span>
  );
}

// ── Framework Backlog card ────────────────────────────────────────────────────

function FrameworkBacklogCard({
  suggestions,
}: {
  suggestions: SuggestionEntry[] | null;
}) {
  if (!suggestions || suggestions.length === 0) {
    return (
      <p className="dashboard-empty-text">No framework suggestions logged.</p>
    );
  }

  return (
    <ul className="suggestions-list">
      {suggestions.map((s) => (
        <li key={s.id} className="suggestions-item">
          <span className="suggestions-id">{s.id}</span>
          <span className="suggestions-title">{s.title}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

function DashboardContent({
  dashboard,
  telemetry,
  findings,
  gotchas,
  frameworkHealth,
  suggestions,
}: {
  dashboard: DashboardSummary;
  telemetry: TelemetrySummary | null;
  findings: FindingsSummary | null;
  gotchas: GotchaEntry[] | null;
  frameworkHealth: FrameworkHealth | null;
  suggestions: SuggestionEntry[] | null;
}) {
  return (
    <div className="dashboard">
      {/* ── Context strip (v2 §5.3 — replaces the ~230px hero) ── */}
      <ContextStrip
        sprintGoal={dashboard.sprintGoal}
        currentSpec={dashboard.currentSpec}
        health={frameworkHealth}
      />

      {/* ── Vitals strip (all single-number metrics; deterministic 10-tile grid) ── */}
      <Vitals
        dashboard={dashboard}
        telemetry={telemetry}
        gotchas={gotchas}
        findings={findings}
      />

      <div className="dashboard-grid">
        {/* ── Handback queue (primary action) ── */}
        <Section
          title="Handback Queue"
          icon={<Inbox size={13} />}
          subtitle="Tasks awaiting your verdict"
          className="dashboard-col-5"
          action={
            dashboard.handbackQueue.length > 0 ? (
              <Link to="/verify" className="section-link">
                View all →
              </Link>
            ) : undefined
          }
        >
          <HandbackQueue items={dashboard.handbackQueue} />
        </Section>

        {/* ── Framework Activity (hook breakdown + health) ── */}
        <Section
          title="Framework Activity"
          icon={<Activity size={13} />}
          subtitle="Hook outcomes across sessions"
          className="dashboard-col-7"
          action={
            telemetry && telemetry.total_events > 0 ? (
              <span className="section-live">
                <span className="section-live-dot" />
                Live
              </span>
            ) : undefined
          }
        >
          <FrameworkActivityCard data={telemetry} />
        </Section>

        {/* ── Quality Gate ── */}
        <Section
          title="Quality Gate"
          icon={<ShieldCheck size={13} />}
          subtitle="Review &amp; test status"
          className="dashboard-col-4"
          footer={qualityFooter(findings)}
        >
          <QualityCard findings={findings} />
        </Section>

        {/* ── Framework Backlog ── */}
        <Section
          title="Framework Backlog"
          icon={<Layers size={13} />}
          subtitle="Suggestions to relay upstream"
          className="dashboard-col-4"
          action={
            suggestions && suggestions.length > 0 ? (
              <span className="section-count">{suggestions.length}</span>
            ) : undefined
          }
        >
          <FrameworkBacklogCard suggestions={suggestions} />
        </Section>

        {/* ── Latest decisions ── */}
        <Section
          title="Latest Decisions"
          icon={<Lightbulb size={13} />}
          subtitle="Recent architectural calls"
          className="dashboard-col-4 dashboard-col-decisions"
          action={
            <Link to="/decisions" className="section-link">
              View all →
            </Link>
          }
        >
          <LatestDecisions decisions={dashboard.latestDecisions} />
        </Section>

        {/* ── Quick nav ── */}
        <Section
          title="Navigation"
          icon={<Compass size={13} />}
          subtitle="Jump to key areas"
          className="dashboard-col-12"
        >
          <div className="quick-nav">
            {[
              {
                to: "/kanban",
                icon: <Kanban size={16} />,
                label: "Kanban Board",
                desc: "Task lifecycle",
              },
              {
                to: "/verify",
                icon: <CheckSquare size={16} />,
                label: "Verify",
                desc: "Review handbacks",
              },
              {
                to: "/contracts",
                icon: <FileText size={16} />,
                label: "Contracts",
                desc: "Interface agreements",
              },
              {
                to: "/decisions",
                icon: <BookOpen size={16} />,
                label: "Decisions",
                desc: "Decision log",
              },
              {
                to: "/spec",
                icon: <List size={16} />,
                label: "Spec",
                desc: "Project spec docs",
              },
              {
                to: "/readme",
                icon: <TrendingUp size={16} />,
                label: "README",
                desc: "Project overview",
              },
            ].map((item) => (
              <Link key={item.to} to={item.to} className="quick-nav-item">
                <span className="quick-nav-icon">{item.icon}</span>
                <div className="quick-nav-text">
                  <span className="quick-nav-label">{item.label}</span>
                  <span className="quick-nav-desc">{item.desc}</span>
                </div>
              </Link>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

// First-load ghost of the page shape (v2 §5.2): context strip + the 10-tile
// vitals grid + two section cards. Refetches never show this — useLastReady
// keeps the previous data on screen.
function DashboardSkeleton() {
  return (
    <SkeletonGroup label="Loading dashboard" className="dashboard-skeleton">
      <SkeletonLine width="100%" />
      <div className="skeleton-tile-grid">
        {Array.from({ length: 10 }, (_, i) => (
          <SkeletonTile key={i} />
        ))}
      </div>
      <SkeletonCard lines={4} />
      <SkeletonCard lines={3} />
    </SkeletonGroup>
  );
}

export function DashboardPage() {
  const dashboardState = useAsync(fetchDashboard);
  const telemetryState = useAsync(fetchTelemetry);
  const findingsState = useAsync(fetchFindings);
  const gotchasState = useAsync(fetchGotchas);
  const frameworkState = useAsync(fetchFrameworkHealth);
  const suggestionsState = useAsync(fetchSuggestions);

  // §5.2: keep the last ready payloads across SSE-driven refetches so a disk
  // change never flashes the page back to its loading state.
  const dashboard = useLastReady(dashboardState.phase, dashboardState.data);
  const telemetry =
    useLastReady(telemetryState.phase, telemetryState.data) ?? null;
  const findings =
    useLastReady(findingsState.phase, findingsState.data) ?? null;
  const gotchas = useLastReady(gotchasState.phase, gotchasState.data) ?? null;
  const frameworkHealth =
    useLastReady(frameworkState.phase, frameworkState.data) ?? null;
  const suggestions =
    useLastReady(suggestionsState.phase, suggestionsState.data) ?? null;

  if (!dashboard) {
    // First load: skeleton while fetching; hard error with retry if it failed.
    // (A refetch error with stale data in hand keeps rendering the last good
    // state — that's the §5.2 rule.)
    if (dashboardState.phase === "loading") return <DashboardSkeleton />;
    return (
      <ErrorState
        error={
          dashboardState.phase === "error"
            ? dashboardState.error
            : new Error("Dashboard data unavailable")
        }
        onRetry={dashboardState.reload}
      />
    );
  }

  return (
    <DashboardContent
      dashboard={dashboard}
      telemetry={telemetry}
      findings={findings}
      gotchas={gotchas}
      frameworkHealth={frameworkHealth}
      suggestions={suggestions}
    />
  );
}
