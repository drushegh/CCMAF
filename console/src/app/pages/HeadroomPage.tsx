/**
 * HeadroomPage.tsx — Surface Headroom (context-compression) metrics (TASK-029)
 *
 * Aggregates + lists the normalized records from
 * .claude/telemetry/headroom-metrics.jsonl (via /api/headroom). DEC-018: every
 * number shown is a real Headroom value the file contains (or omitted) — nothing
 * invented. Empty-state until Headroom has actually run in this project.
 */

import { Zap, TrendingDown, Coins, Layers, Clock } from "lucide-react";
import { PageLayout, EmptyState } from "../components/PageLayout";
import { fetchHeadroom } from "../api/analytics";
import type { HeadroomSummary } from "../api/analytics";
import { useAsync, LoadingState, ErrorState } from "./lib";
import "../../styles/pages.css";

function num(n: number): string {
  return n.toLocaleString();
}
// Headroom's compression_ratio = tokens_saved / tokens_before — i.e. the
// FRACTION REMOVED (higher = more compression), NOT tokens_out/tokens_in. So the
// ratio IS the reduction; render it directly as a percent.
function pct(ratio: number | null): string {
  return ratio == null ? "—" : `${Math.round(ratio * 100)}%`;
}
function usd(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(4)}`;
}
function cell(n: number | null): string {
  return n == null ? "—" : n.toLocaleString();
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "ok" | "neutral";
}) {
  return (
    <div className={`findings-stat findings-stat--${tone ?? "neutral"}`}>
      <span className="findings-stat-label">
        {icon} {label}
      </span>
      <span className="findings-stat-value">{value}</span>
    </div>
  );
}

function HeadroomContent({ data }: { data: HeadroomSummary }) {
  if (!data.available) {
    return (
      <EmptyState
        icon={<Zap size={22} />}
        title="No Headroom metrics yet"
        description="Headroom hasn't run in this project. Once a session runs through it (the framework's run-with-headroom.sh proxy, then normalize-metrics.sh), records land in .claude/telemetry/headroom-metrics.jsonl and the real savings appear here."
      />
    );
  }

  return (
    <div className="findings-page">
      <div className="headroom-stats">
        <Stat
          icon={<TrendingDown size={13} />}
          label="Tokens saved"
          value={num(data.tokensSaved)}
          tone="ok"
        />
        <Stat
          icon={<Layers size={13} />}
          label="Avg reduction"
          value={pct(data.avgCompressionRatio)}
          tone="ok"
        />
        <Stat
          icon={<Layers size={13} />}
          label="Tokens in → out"
          value={`${num(data.tokensIn)} → ${num(data.tokensOut)}`}
        />
        <Stat icon={<Coins size={13} />} label="Cost (model-side)" value={usd(data.costUsd)} />
        <Stat
          icon={<Zap size={13} />}
          label="Records"
          value={num(data.recordCount)}
        />
        <Stat
          icon={<Clock size={13} />}
          label="Last run"
          value={data.lastRun ?? "—"}
        />
      </div>

      <section className="findings-section">
        <h2 className="findings-section-title">
          <Zap size={14} />
          Recent records
        </h2>
        <div className="headroom-table-wrap">
          <table className="headroom-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Model</th>
                <th className="num">In</th>
                <th className="num">Out</th>
                <th className="num">Saved</th>
                <th className="num">Ratio</th>
                <th className="num">Cost</th>
                <th className="num">ms</th>
              </tr>
            </thead>
            <tbody>
              {data.recent.map((r, i) => (
                <tr key={r.eventId ?? i}>
                  <td className="mono">{r.ts ?? "—"}</td>
                  <td className="mono">{r.model ?? "—"}</td>
                  <td className="num">{cell(r.tokensIn)}</td>
                  <td className="num">{cell(r.tokensOut)}</td>
                  <td className="num">{cell(r.tokensSaved)}</td>
                  <td className="num">{pct(r.compressionRatio)}</td>
                  <td className="num">{usd(r.costUsd)}</td>
                  <td className="num">{cell(r.latencyMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function HeadroomPage() {
  const { phase, data, error, reload } = useAsync(fetchHeadroom, []);

  return (
    <PageLayout
      title="Headroom"
      subtitle="Context-compression savings — read-only"
      badge="headroom-metrics.jsonl"
    >
      {phase === "loading" && <LoadingState label="Loading Headroom metrics…" />}
      {phase === "error" && <ErrorState error={error} onRetry={reload} />}
      {phase === "ready" && <HeadroomContent data={data} />}
    </PageLayout>
  );
}
