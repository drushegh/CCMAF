import { FileText } from "lucide-react";
import { PageLayout, EmptyState } from "../components/PageLayout";
import { fetchReadme, readmeAssetUrl } from "../api/state";
import { docRawUrl } from "../api/docs";
import { useAsync, LoadingState, ErrorState, ReadmeMarkdown } from "./lib";
import "../../styles/pages.css";

// The README lives at the repo root, so its image references are repo-root-
// relative — and the Console server does NOT serve arbitrary repo files. Two
// confined endpoints cover them: the Docs raw endpoint (`/api/docs/raw`, rooted
// at `01_Project/docs/`) for diagrams that live there, and the images-only
// README asset endpoint (`/api/readme/asset`, BUG-015) for everything else
// repo-relative (e.g. the GitHub `.github/assets/*` idiom). Absolute / data /
// root-relative URLs pass through unchanged.
const DOCS_ROOT_PREFIX = "01_Project/docs/";

export function readmeImgSrc(src: string): string {
  if (/^(https?:|data:|\/)/i.test(src)) return src;
  const rel = src.replace(/^\.\//, "");
  if (rel.startsWith(DOCS_ROOT_PREFIX)) {
    return docRawUrl(rel.slice(DOCS_ROOT_PREFIX.length));
  }
  return readmeAssetUrl(rel);
}

/**
 * Resolver for the raw centered-figure `<img>` srcs (BUG-015). Stricter than the
 * markdown-image path because markdown-it's `validateLink` doesn't run here:
 * only http(s) absolutes and repo-relative paths are allowed; ANY scheme
 * (`javascript:`, `data:`, `file:`, …) and protocol-relative `//host` srcs are
 * rejected (→ the figure is dropped, never emitted).
 */
export function readmeFigureSrc(src: string): string | null {
  const s = src.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s; // external image
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null; // any scheme → reject
  if (s.startsWith("//")) return null; // protocol-relative → reject
  return readmeImgSrc(s); // repo-relative → confined endpoint
}

export function ReadmePage() {
  const { phase, data, error, reload } = useAsync(fetchReadme, []);

  return (
    <PageLayout
      title="README"
      subtitle="Rendered from project root README.md — read-only"
      badge="README.md"
    >
      {phase === "loading" && <LoadingState label="Loading README…" />}
      {phase === "error" && <ErrorState error={error} onRetry={reload} />}
      {phase === "ready" &&
        (!data.exists || data.markdown.trim() === "" ? (
          <EmptyState
            icon={<FileText size={22} />}
            title="No README.md found"
            description="This project does not have a root README.md (or it is empty). When one is added it will be rendered here. The page degrades gracefully when the file is absent."
          />
        ) : (
          <div className="readme-doc">
            <ReadmeMarkdown
              source={data.markdown}
              transformImgSrc={readmeImgSrc}
              resolveFigureSrc={readmeFigureSrc}
            />
          </div>
        ))}
    </PageLayout>
  );
}
