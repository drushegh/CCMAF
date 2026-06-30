/**
 * Shared client-side primitives for the read-only render pages (TASK-006).
 *
 * Lives in pages/ (owned by the read-only-pages task). Three concerns the five
 * pages share: the async fetch lifecycle (loading / error / data), safe
 * markdown rendering, and consistent loading/error state UI. Extracted because
 * all five pages need the same lifecycle — clear duplication, not speculative.
 *
 * TASK-008: useAsync now auto-subscribes to the shared change stream and
 * debounces re-runs on disk change (~250ms).  Existing callers are unchanged —
 * the subscription is transparent and guarded behind `typeof EventSource`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MarkdownIt from "markdown-it";
import { Loader2, AlertTriangle, RefreshCw } from "lucide-react";
import { subscribe as subscribeToChanges } from "../api/events.js";

/* ── Async data lifecycle ───────────────────────────────────────────── */

export type AsyncState<T> =
  | { phase: "loading"; data: undefined; error: undefined }
  | { phase: "error"; data: undefined; error: Error }
  | { phase: "ready"; data: T; error: undefined };

/**
 * Run an async loader and track loading/error/ready. `reload` re-runs it.
 * Guards against setting state after unmount or after a superseding reload.
 *
 * `deps` controls when the loader is re-created/re-run (e.g. a route param).
 *
 * TASK-008: Automatically subscribes to the shared SSE change stream and
 * re-runs the loader (debounced ~250ms) on any disk change. The subscription
 * is guarded behind `typeof EventSource !== "undefined"` so jsdom tests and
 * SSR contexts are unaffected. Existing call-sites are backward-compatible —
 * no signature change.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[] = [],
): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({
    phase: "loading",
    data: undefined,
    error: undefined,
  });
  const [nonce, setNonce] = useState(0);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const memoLoader = useCallback(loader, deps);

  useEffect(() => {
    let live = true;
    setState({ phase: "loading", data: undefined, error: undefined });
    memoLoader()
      .then((data) => {
        if (live) setState({ phase: "ready", data, error: undefined });
      })
      .catch((err: unknown) => {
        if (!live) return;
        const error = err instanceof Error ? err : new Error(String(err));
        setState({ phase: "error", data: undefined, error });
      });
    return () => {
      live = false;
    };
  }, [memoLoader, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // ── Live-refresh: subscribe to the shared change stream (TASK-008) ──────────
  // Guard: EventSource is undefined in jsdom (vitest) and SSR — skip silently.
  // We use a ref to hold the debounce timer so it doesn't participate in deps.
  const liveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Guard for environments without EventSource (jsdom, SSR)
    if (typeof EventSource === "undefined") return;

    const unsub = subscribeToChanges(() => {
      // Debounce: coalesce rapid change events (editor saves multiple files quickly)
      if (liveDebounceRef.current !== null) {
        clearTimeout(liveDebounceRef.current);
      }
      liveDebounceRef.current = setTimeout(() => {
        liveDebounceRef.current = null;
        reload();
      }, 250);
    });

    return () => {
      unsub();
      if (liveDebounceRef.current !== null) {
        clearTimeout(liveDebounceRef.current);
        liveDebounceRef.current = null;
      }
    };
    // reload is stable (useCallback with no deps); subscribeToChanges is module-level stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ...state, reload };
}

/* ── Loading + error UI ─────────────────────────────────────────────── */

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="state-panel state-panel--loading" role="status" aria-live="polite">
      <Loader2 className="state-spinner" size={20} aria-hidden="true" />
      <span className="state-panel-text">{label}</span>
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  return (
    <div className="state-panel state-panel--error" role="alert">
      <AlertTriangle className="state-panel-icon" size={20} aria-hidden="true" />
      <div className="state-panel-body">
        <span className="state-panel-title">Could not load this view</span>
        <span className="state-panel-text">{error.message}</span>
      </div>
      <button type="button" className="state-retry-btn" onClick={onRetry}>
        <RefreshCw size={13} aria-hidden="true" />
        Retry
      </button>
    </div>
  );
}

/* ── Safe markdown ──────────────────────────────────────────────────── */

/**
 * Single shared markdown-it instance. `html: false` (the default) means raw
 * HTML embedded in markdown is ESCAPED, not emitted — so a `<script>` in a doc
 * is rendered as inert text and can never execute. `linkify` autolinks bare
 * URLs; `typographer` does light smart-quote substitution. No raw-HTML pass,
 * so no separate sanitizer is required for the XSS surface.
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
});

/**
 * Render trusted-source markdown (framework state files) to safe HTML.
 *
 * Safety: `html:false` escapes any embedded raw HTML, so user/file markdown
 * cannot inject executable nodes. We additionally harden links: any `<a>` is
 * forced to `target=_blank` + `rel=noopener noreferrer nofollow`.
 */
export function Markdown({
  source,
  transformImgSrc,
}: {
  source?: string;
  /**
   * Optional rewrite for `<img src>` values — used by the Docs browser to point
   * a doc's relative image references at the raw-file endpoint. Receives the raw
   * src string; return the URL to use. Absolute/data URLs are passed through.
   */
  transformImgSrc?: (src: string) => string;
}) {
  const html = useMemo(() => {
    let rendered = md.render(source ?? "");
    // Harden anchors: open externally without leaking the opener.
    rendered = rendered.replace(
      /<a\s+href=/g,
      '<a target="_blank" rel="noopener noreferrer nofollow" href=',
    );
    if (transformImgSrc) {
      rendered = rendered.replace(
        /(<img\b[^>]*?\ssrc=")([^"]*)(")/g,
        (_m, pre: string, src: string, post: string) =>
          `${pre}${transformImgSrc(src)}${post}`,
      );
    }
    return rendered;
  }, [source, transformImgSrc]);

  return (
    <div
      className="markdown-body"
      // Safe: md is configured html:false, so `html` contains no raw/embedded
      // HTML from the source — only markdown-it's own escaped element output.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/* ── README: safe centered-figure reconstruction (BUG-015) ──────────────── */

/** HTML-escape text for safe insertion into our reconstructed elements. */
function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// A GitHub-style centered block: <p|div align="center"> … </p|div>.
const CENTERED_BLOCK_RE =
  /<(p|div)\b[^>]*\balign\s*=\s*["']?center["']?[^>]*>([\s\S]*?)<\/\1>/gi;

/** Read one attribute value off a tag string ("" / null if absent). */
function attrValue(tag: string, name: string): string | null {
  const m = tag.match(
    new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i"),
  );
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

/**
 * Rebuild the GitHub centered-image idiom SAFELY (BUG-015). markdown-it stays on
 * `html:false` (arbitrary embedded HTML remains inert); for the README ONLY we
 * recognise `<p|div align="center"><img …></p|div>`, extract the FIRST `<img>`'s
 * attributes, validate each, and reconstruct a `<figure>` from a fixed template.
 * NOTHING from the source is passed through as markup — a missing/dangerous src,
 * or no <img> at all, returns null and the block is simply not rendered. So this
 * cannot be an injection vector regardless of what the source contains.
 */
export function buildCenteredFigure(
  innerHtml: string,
  resolveSrc: (src: string) => string | null,
): string | null {
  const imgMatch = innerHtml.match(/<img\b[^>]*>/i);
  if (!imgMatch) return null;
  const imgTag = imgMatch[0];
  const rawSrc = attrValue(imgTag, "src");
  if (!rawSrc) return null;
  const src = resolveSrc(rawSrc);
  if (!src) return null; // dangerous / unresolvable → drop, never emit

  const alt = escapeHtmlText(attrValue(imgTag, "alt") ?? "");
  const wRaw = attrValue(imgTag, "width");
  const hRaw = attrValue(imgTag, "height");
  const width = wRaw && /^\d{1,5}$/.test(wRaw) ? ` width="${wRaw}"` : "";
  const height = hRaw && /^\d{1,5}$/.test(hRaw) ? ` height="${hRaw}"` : "";
  // src is already an allowlisted URL (http(s) or our /api/readme/asset endpoint);
  // escape defensively so a stray quote can't break out of the attribute.
  const safeSrc = escapeHtmlText(src);
  return `<figure class="readme-figure"><img src="${safeSrc}" alt="${alt}"${width}${height} loading="lazy" /></figure>`;
}

/**
 * README renderer (BUG-015): like {@link Markdown}, but additionally reconstructs
 * the GitHub centered-image idiom that `html:false` would otherwise show as raw
 * text. The centered blocks are pulled from the RAW source and replaced with
 * placeholders BEFORE rendering (so the rest stays fully inert under html:false),
 * then the validated, freshly-built `<figure>` elements are injected back — the
 * only non-escaped HTML in the output, and each is built from validated parts.
 */
export function ReadmeMarkdown({
  source,
  transformImgSrc,
  resolveFigureSrc,
}: {
  source?: string;
  /** Rewrite for markdown `![](…)` image srcs (relative → confined endpoint). */
  transformImgSrc?: (src: string) => string;
  /** Resolve+validate a raw centered-figure `<img src>` (null → drop). */
  resolveFigureSrc: (src: string) => string | null;
}) {
  const html = useMemo(() => {
    const src = source ?? "";
    const figures: string[] = [];
    const token = (i: number) => `READMECENTEREDFIGURE${i}ENDTOKEN`;

    // 1) Lift centered figures out of the raw source → placeholders.
    const lifted = src.replace(CENTERED_BLOCK_RE, (_block, _tag, inner: string) => {
      const fig = buildCenteredFigure(inner, resolveFigureSrc);
      if (!fig) return ""; // unrenderable centered block → drop (was raw text)
      const i = figures.push(fig) - 1;
      return `\n\n${token(i)}\n\n`;
    });

    // 2) Render the rest with html:false (safe baseline), harden anchors, rewrite
    //    markdown image srcs.
    let rendered = md.render(lifted);
    rendered = rendered.replace(
      /<a\s+href=/g,
      '<a target="_blank" rel="noopener noreferrer nofollow" href=',
    );
    if (transformImgSrc) {
      rendered = rendered.replace(
        /(<img\b[^>]*?\ssrc=")([^"]*)(")/g,
        (_m, pre: string, s: string, post: string) =>
          `${pre}${transformImgSrc(s)}${post}`,
      );
    }

    // 3) Inject the reconstructed figures (the only non-escaped HTML, all from
    //    validated parts). md wraps a lone token in <p>…</p>; also cover bare.
    figures.forEach((fig, i) => {
      const t = token(i);
      rendered = rendered.split(`<p>${t}</p>`).join(fig).split(t).join(fig);
    });
    return rendered;
  }, [source, transformImgSrc, resolveFigureSrc]);

  return (
    <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
