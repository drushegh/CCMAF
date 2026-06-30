import { useEffect, useState } from "react";
import { ScrollText } from "lucide-react";
import { PageLayout, EmptyState } from "../components/PageLayout";
import { fetchSpecs, fetchSpec } from "../api/state";
import { useAsync, LoadingState, ErrorState, Markdown } from "./lib";
import "../../styles/pages.css";

function SpecContent({ name }: { name: string }) {
  const { phase, data, error, reload } = useAsync(() => fetchSpec(name), [name]);
  if (phase === "loading") return <LoadingState label={`Loading ${name}…`} />;
  if (phase === "error") return <ErrorState error={error} onRetry={reload} />;
  return (
    <div className="spec-doc">
      <Markdown source={data.markdown} />
    </div>
  );
}

export function SpecPage() {
  const { phase, data, error, reload } = useAsync(fetchSpecs, []);
  const [selected, setSelected] = useState<string | null>(null);

  // Auto-select the first spec once the list loads (or if the list changes).
  useEffect(() => {
    if (phase === "ready" && data.length > 0) {
      setSelected((cur) =>
        cur && data.some((s) => s.name === cur) ? cur : data[0].name,
      );
    } else if (phase === "ready") {
      setSelected(null);
    }
  }, [phase, data]);

  return (
    <PageLayout
      title="Spec"
      subtitle="Rendered from framework/docs/specs/*.md — read-only"
      badge="specs/*.md"
    >
      {phase === "loading" && <LoadingState label="Loading spec list…" />}
      {phase === "error" && <ErrorState error={error} onRetry={reload} />}
      {phase === "ready" &&
        (data.length === 0 ? (
          <EmptyState
            icon={<ScrollText size={22} />}
            title="No spec documents found"
            description="No markdown files were found under framework/docs/specs/. Spec documents render here once they exist."
          />
        ) : (
          <div className="spec-layout">
            <aside className="spec-sidebar" aria-label="Spec documents">
              {data.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  className={`spec-sidebar-item ${selected === s.name ? "is-active" : ""}`}
                  onClick={() => setSelected(s.name)}
                >
                  <ScrollText size={13} aria-hidden="true" />
                  <span className="spec-sidebar-name">{s.name}</span>
                </button>
              ))}
            </aside>
            <section className="spec-content">
              {selected && <SpecContent name={selected} />}
            </section>
          </div>
        ))}
    </PageLayout>
  );
}
