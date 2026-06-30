import { useMemo, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { PageLayout, EmptyState } from "../components/PageLayout";
import { fetchContracts, type ContractSummary } from "../api/state";
import { useAsync, LoadingState, ErrorState } from "./lib";
import "../../styles/pages.css";

type StatusFilter = "stable" | "draft" | null;

function ContractRow({ contract }: { contract: ContractSummary }) {
  const { id, title, status } = contract;
  return (
    <div className="contract-row">
      <div className="contract-row-header">
        <code className="contract-row-id">{id}</code>
        <span className={`contract-status-badge contract-status-badge--${status}`}>
          {status === "stable" ? <CheckCircle2 size={9} /> : <Circle size={9} />}
          {status}
        </span>
      </div>
      <p className="contract-row-title">{title}</p>
    </div>
  );
}

/** A clickable counter that filters the list by its status (toggle: click the
 *  active chip again to clear). Acts as a single-select group of filter chips. */
function CountChip({
  status,
  n,
  active,
  onToggle,
}: {
  status: "stable" | "draft";
  n: number;
  active: boolean;
  onToggle: (s: "stable" | "draft") => void;
}) {
  const label = status === "stable" ? "Stable" : "Draft";
  return (
    <button
      type="button"
      className={`contracts-count-chip contracts-count-chip--${status}${active ? " is-active" : ""}`}
      aria-pressed={active ? "true" : "false"}
      title={
        active
          ? `Showing ${label} only — click to clear`
          : `Filter to ${label} contracts`
      }
      onClick={() => onToggle(status)}
    >
      <span className="contracts-count-n">{n}</span>
      <span className="contracts-count-lbl">{label}</span>
    </button>
  );
}

function CountsBar({
  contracts,
  filter,
  onToggle,
}: {
  contracts: ContractSummary[];
  filter: StatusFilter;
  onToggle: (s: "stable" | "draft") => void;
}) {
  const stable = contracts.filter((c) => c.status === "stable").length;
  const draft = contracts.filter((c) => c.status === "draft").length;
  return (
    <div className="contracts-counts-bar" role="group" aria-label="Filter by status">
      <CountChip
        status="stable"
        n={stable}
        active={filter === "stable"}
        onToggle={onToggle}
      />
      <CountChip
        status="draft"
        n={draft}
        active={filter === "draft"}
        onToggle={onToggle}
      />
    </div>
  );
}

export function ContractsPage() {
  const { phase, data, error, reload } = useAsync(fetchContracts, []);
  const [filter, setFilter] = useState<StatusFilter>(null);

  // Toggle: clicking the active status clears the filter.
  const toggle = (s: "stable" | "draft") =>
    setFilter((cur) => (cur === s ? null : s));

  const visible = useMemo(() => {
    const list = data ?? [];
    return filter ? list.filter((c) => c.status === filter) : list;
  }, [data, filter]);

  return (
    <PageLayout
      title="Contracts"
      subtitle="Parsed from .claude/ECOSYSTEM.md — read-only render"
      badge="ECOSYSTEM.md"
    >
      <div className="contracts-intro">
        Contracts are machine-readable interface agreements between agents. Each
        carries a status (<em>draft</em> = not yet stable; <em>stable</em> =
        implementable). Click a counter to filter by status.
      </div>

      {phase === "loading" && <LoadingState label="Loading contracts…" />}
      {phase === "error" && <ErrorState error={error} onRetry={reload} />}
      {phase === "ready" &&
        (data.length === 0 ? (
          <EmptyState
            title="No contracts found"
            description="No contract anchors were parsed from .claude/ECOSYSTEM.md. Contracts appear here once they are defined."
          />
        ) : (
          <>
            <CountsBar contracts={data} filter={filter} onToggle={toggle} />
            <div className="contracts-list">
              {visible.map((c) => (
                <ContractRow key={c.id} contract={c} />
              ))}
            </div>
          </>
        ))}
    </PageLayout>
  );
}
