/**
 * DocPage.tsx — the shared "document page" pattern (Console v2 §5.1, TASK-106).
 *
 * Replaces the raw wall-of-<Markdown> rendering on the most-read state pages
 * (Status, Findings; Decisions adopts the rail) with one composed pattern:
 *
 *   - content column capped at 72ch, so STATUS.md prose stops running 1400px wide
 *   - a sticky right TOC rail built from the doc's h2/h3 headings, scroll-spy
 *     highlighted; below 1100px it collapses behind a "≡ On this page" popover
 *   - each h2 section renders as a collapsible card (default expanded, chevron
 *     in the heading row; collapsed state kept per page in sessionStorage —
 *     a working-set gesture, not a preference, so a fresh tab starts expanded)
 *   - a header meta row: `Last updated <ago> · <bytes> · <FILE>` (mtime comes
 *     from the StateDoc payload — state-routes.ts)
 *
 * Composition over configuration: `DocPage` is the whole pattern for a single
 * markdown doc; pages with their own body structure (Decisions' parsed entries,
 * Findings' two docs) reuse the exported pieces — DocLayout (rail + popover +
 * scroll-spy), DocSectionCard (collapsible card), DocMeta, useSectionCollapse,
 * splitMarkdownSections — and keep their own content rendering.
 *
 * jsdom guards: IntersectionObserver, matchMedia and scrollIntoView are all
 * feature-detected — tests exercise structure and collapse behaviour; the spy
 * simply stays inert where the platform APIs are absent.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, List } from "lucide-react";
import { Markdown } from "../pages/lib";
import "../../styles/docpage.css";

/* ══════════════════════════════════════════════════════════════════════
   Markdown sectioning (pure — exported for tests)
   ══════════════════════════════════════════════════════════════════════ */

export interface DocHeading {
  id: string;
  title: string;
}

export interface DocSection extends DocHeading {
  /** Markdown body of the section, INCLUDING its h3 sub-headings (not the h2 line). */
  body: string;
  /** h3 sub-headings inside this section, in order. */
  h3s: DocHeading[];
}

export interface DocSplit {
  /** Content before the first h2 (often the h1 title + intro). "" when none. */
  preamble: string;
  sections: DocSection[];
}

export interface TocEntry {
  id: string;
  title: string;
  level: 2 | 3;
}

/** Strip inline markdown noise from a heading for display/slugging. */
function cleanHeading(raw: string): string {
  return raw
    .replace(/\s+#+\s*$/, "") // trailing ATX closer:  "## Title ##"
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/__([^_]*)__/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) → text
    .trim();
}

/** GitHub-ish slug: lowercase, alphanumerics keep, runs of anything else → "-". */
function slugify(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "section";
}

/**
 * Split markdown into h2 sections (fence-aware: a `## ` inside a ``` / ~~~
 * code block is content, not a heading). h3s inside each section are collected
 * for the TOC. Ids are `<idPrefix>--<slug>` with duplicate slugs numbered, so
 * two docs on one page (Findings) can't collide.
 */
export function splitMarkdownSections(
  source: string,
  idPrefix: string,
): DocSplit {
  const lines = source.split(/\r?\n/);
  const seen = new Map<string, number>();
  const uniqueId = (title: string): string => {
    const base = `${idPrefix}--${slugify(title)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };

  const preambleLines: string[] = [];
  const sections: DocSection[] = [];
  let current: {
    title: string;
    id: string;
    lines: string[];
    h3s: DocHeading[];
  } | null = null;
  let fence: string | null = null; // the opening fence marker while inside a block

  for (const line of lines) {
    // Fence tracking (``` or ~~~, up to 3 leading spaces, per CommonMark).
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      if (fence === null) {
        fence = fenceMatch[1];
      } else if (
        fenceMatch[1][0] === fence[0] &&
        fenceMatch[1].length >= fence.length
      ) {
        fence = null;
      }
      (current ? current.lines : preambleLines).push(line);
      continue;
    }

    if (fence === null) {
      const h2 = /^##\s+(.+)$/.exec(line);
      if (h2 && !line.startsWith("###")) {
        if (current) {
          sections.push({
            id: current.id,
            title: current.title,
            body: current.lines.join("\n").trim(),
            h3s: current.h3s,
          });
        }
        const title = cleanHeading(h2[1]);
        current = { title, id: uniqueId(title), lines: [], h3s: [] };
        continue;
      }
      const h3 = /^###\s+(.+)$/.exec(line);
      if (h3 && !line.startsWith("####") && current) {
        const title = cleanHeading(h3[1]);
        current.h3s.push({ id: uniqueId(title), title });
        // falls through — the h3 line stays part of the section body
      }
    }

    (current ? current.lines : preambleLines).push(line);
  }

  if (current) {
    sections.push({
      id: current.id,
      title: current.title,
      body: current.lines.join("\n").trim(),
      h3s: current.h3s,
    });
  }

  return { preamble: preambleLines.join("\n").trim(), sections };
}

/** TOC entries (h2 + nested h3) for a split doc. */
export function splitToToc(split: DocSplit): TocEntry[] {
  return split.sections.flatMap((s): TocEntry[] => [
    { id: s.id, title: s.title, level: 2 },
    ...s.h3s.map((h): TocEntry => ({ id: h.id, title: h.title, level: 3 })),
  ]);
}

/* ══════════════════════════════════════════════════════════════════════
   Meta-row helpers (pure — exported for tests)
   ══════════════════════════════════════════════════════════════════════ */

/** Compact "ago" phrasing for the meta row. Falls back to a plain date. */
export function timeAgo(thenMs: number, nowMs: number = Date.now()): string {
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(thenMs).toISOString().slice(0, 10);
}

/** UTF-8 byte length of the doc (what's actually on disk, not JS chars). */
export function byteLength(s: string): number {
  return typeof TextEncoder !== "undefined"
    ? new TextEncoder().encode(s).length
    : s.length;
}

/** "812 B" / "12.4 KB" / "1.2 MB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** The header meta row: `Last updated <ago> · <bytes> · <FILE>`. */
export function DocMeta({
  file,
  mtimeMs,
  bytes,
}: {
  file: string;
  mtimeMs?: number | null;
  bytes?: number;
}) {
  return (
    <div className="docpage-meta">
      {mtimeMs != null && (
        <>
          <span title={new Date(mtimeMs).toLocaleString()}>
            Last updated {timeAgo(mtimeMs)}
          </span>
          <span className="docpage-meta-sep" aria-hidden="true">
            ·
          </span>
        </>
      )}
      {bytes != null && (
        <>
          <span>{formatBytes(bytes)}</span>
          <span className="docpage-meta-sep" aria-hidden="true">
            ·
          </span>
        </>
      )}
      <code className="docpage-meta-file">{file}</code>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Collapse state — per-page overrides in sessionStorage
   ══════════════════════════════════════════════════════════════════════ */

function storageKeyFor(page: string): string {
  return `docpage-collapsed:${page}`;
}

function readOverrides(page: string): Record<string, boolean> {
  try {
    const raw = sessionStorage.getItem(storageKeyFor(page));
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "boolean") out[k] = v;
        }
        return out;
      }
    }
  } catch {
    /* storage unavailable / corrupt — start from defaults */
  }
  return {};
}

/**
 * Per-page section collapse state (Console v2 §5.1). Sections default to
 * expanded unless the caller says otherwise (`defaultCollapsed` — Decisions
 * collapses entries beyond the newest 10); explicit user toggles are stored
 * as overrides in sessionStorage, so they survive tab navigation but a fresh
 * tab starts from the defaults again.
 */
export function useSectionCollapse(page: string) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>(() =>
    readOverrides(page),
  );

  const isCollapsed = useCallback(
    (id: string, defaultCollapsed = false): boolean =>
      overrides[id] ?? defaultCollapsed,
    [overrides],
  );

  const setCollapsed = useCallback(
    (id: string, collapsed: boolean) => {
      setOverrides((prev) => {
        const next = { ...prev, [id]: collapsed };
        try {
          sessionStorage.setItem(storageKeyFor(page), JSON.stringify(next));
        } catch {
          /* persistence is best-effort */
        }
        return next;
      });
    },
    [page],
  );

  const toggle = useCallback(
    (id: string, defaultCollapsed = false) => {
      setCollapsed(id, !(overrides[id] ?? defaultCollapsed));
    },
    [overrides, setCollapsed],
  );

  return { isCollapsed, toggle, setCollapsed };
}

/* ══════════════════════════════════════════════════════════════════════
   Scroll-spy + navigation
   ══════════════════════════════════════════════════════════════════════ */

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Scroll a heading/section into view, honouring reduced-motion. */
function scrollToId(id: string): void {
  const el = document.getElementById(id);
  el?.scrollIntoView?.({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
}

/**
 * Track which TOC target is currently "read" — the intersecting heading
 * deepest in TOC order within the top band of the viewport. Inert (returns
 * only manual choices) when IntersectionObserver is unavailable (jsdom).
 */
function useScrollSpy(ids: string[]): [string | null, (id: string) => void] {
  const [active, setActive] = useState<string | null>(null);
  const visibleRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined" || ids.length === 0) return;
    visibleRef.current = new Set();

    const pickActive = () => {
      // Deepest visible entry in TOC order = where the reader actually is.
      for (let i = ids.length - 1; i >= 0; i--) {
        if (visibleRef.current.has(ids[i])) {
          setActive(ids[i]);
          return;
        }
      }
      // Nothing in the band (e.g. between long sections): keep the last active.
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.spyId;
          if (!id) continue;
          if (entry.isIntersecting) visibleRef.current.add(id);
          else visibleRef.current.delete(id);
        }
        pickActive();
      },
      // Active band = top 30% of the viewport — a heading is "current" while
      // its section occupies the reading position.
      { rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );

    const observed: Element[] = [];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) continue;
      // For a section card, observe its heading row (the card can be very
      // tall); for a plain heading (h3), observe the element itself.
      const target = (el.querySelector(":scope > .docpage-card-head") ??
        el) as HTMLElement;
      target.dataset.spyId = id;
      observer.observe(target);
      observed.push(target);
    }

    return () => {
      observer.disconnect();
      for (const t of observed) delete (t as HTMLElement).dataset.spyId;
    };
  }, [ids]);

  return [active, setActive];
}

/* ══════════════════════════════════════════════════════════════════════
   Layout: 72ch content column + sticky TOC rail + narrow popover
   ══════════════════════════════════════════════════════════════════════ */

function TocList({
  toc,
  activeId,
  onNavigate,
}: {
  toc: TocEntry[];
  activeId: string | null;
  onNavigate: (id: string) => void;
}) {
  return (
    <ul className="docpage-toc-list">
      {toc.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            className={`docpage-toc-item docpage-toc-item--h${entry.level}${
              activeId === entry.id ? " is-active" : ""
            }`}
            aria-current={activeId === entry.id ? "true" : undefined}
            onClick={() => onNavigate(entry.id)}
          >
            {entry.title}
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The DocPage frame: meta row + content column + TOC rail. Children are the
 * page's own content (section cards, decision cards, …). `onBeforeNavigate`
 * runs before scrolling to a TOC target — pages use it to expand a collapsed
 * section so the anchor actually has somewhere to land.
 */
export function DocLayout({
  toc,
  meta,
  onBeforeNavigate,
  children,
}: {
  toc: TocEntry[];
  meta?: ReactNode;
  onBeforeNavigate?: (id: string) => void;
  children: ReactNode;
}) {
  const ids = useMemo(() => toc.map((t) => t.id), [toc]);
  const [activeId, setActive] = useScrollSpy(ids);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const navigate = useCallback(
    (id: string) => {
      onBeforeNavigate?.(id);
      setActive(id);
      setPopoverOpen(false);
      // Double rAF: if the target was just expanded, let it lay out first.
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToId(id)));
    },
    [onBeforeNavigate, setActive],
  );

  // Popover dismissal: Escape or a click outside.
  useEffect(() => {
    if (!popoverOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [popoverOpen]);

  const hasToc = toc.length > 0;

  return (
    <div className={`docpage${hasToc ? "" : " docpage--no-toc"}`}>
      <div className="docpage-main">
        {(meta || hasToc) && (
          <div className="docpage-head">
            {meta}
            {hasToc && (
              <div className="docpage-popover-host" ref={popoverRef}>
                <button
                  type="button"
                  className="docpage-popover-btn"
                  aria-expanded={popoverOpen ? "true" : "false"}
                  aria-haspopup="true"
                  onClick={() => setPopoverOpen((o) => !o)}
                >
                  <List size={13} aria-hidden="true" />
                  On this page
                </button>
                {popoverOpen && (
                  <nav className="docpage-popover" aria-label="On this page">
                    <TocList
                      toc={toc}
                      activeId={activeId}
                      onNavigate={navigate}
                    />
                  </nav>
                )}
              </div>
            )}
          </div>
        )}
        <div className="docpage-content">{children}</div>
      </div>
      {hasToc && (
        <nav className="docpage-toc" aria-label="On this page">
          <span className="docpage-toc-title">On this page</span>
          <TocList toc={toc} activeId={activeId} onNavigate={navigate} />
        </nav>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Collapsible section card
   ══════════════════════════════════════════════════════════════════════ */

export function DocSectionCard({
  id,
  title,
  collapsed,
  onToggle,
  headerExtra,
  children,
}: {
  id: string;
  title: ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  /** Optional right-aligned extras in the heading row (badges, dates …). */
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`docpage-card${collapsed ? " docpage-card--collapsed" : ""}`}
    >
      <div className="docpage-card-head">
        <button
          type="button"
          className="docpage-card-toggle"
          aria-expanded={collapsed ? "false" : "true"}
          aria-controls={`${id}-body`}
          onClick={onToggle}
        >
          <ChevronDown
            size={15}
            className="docpage-card-chevron"
            aria-hidden="true"
          />
          <span className="docpage-card-title">{title}</span>
        </button>
        {headerExtra && <div className="docpage-card-extra">{headerExtra}</div>}
      </div>
      {/* Collapsed bodies stay mounted (hidden) so anchor ids keep existing —
          a TOC jump can expand + land without a re-render race. */}
      <div id={`${id}-body`} className="docpage-card-body" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   Markdown section body (assigns h3 anchor ids after render)
   ══════════════════════════════════════════════════════════════════════ */

function MarkdownSectionBody({ section }: { section: DocSection }) {
  const ref = useRef<HTMLDivElement | null>(null);

  // markdown-it gives headings no ids; zip the parsed h3 list with the
  // rendered h3 elements IN ORDER (order is the invariant — inline markdown
  // in a heading renders differently than it slugs).
  useEffect(() => {
    const el = ref.current;
    if (!el || section.h3s.length === 0) return;
    const rendered = el.querySelectorAll<HTMLElement>(".markdown-body h3");
    section.h3s.forEach((h, i) => {
      const node = rendered[i];
      if (node) node.id = h.id;
    });
  }, [section]);

  return (
    <div ref={ref}>
      <Markdown source={section.body} />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
   The composed DocPage (whole-markdown-doc pattern)
   ══════════════════════════════════════════════════════════════════════ */

export function DocPage({
  markdown,
  file,
  mtimeMs,
  page,
}: {
  /** Raw markdown source of the doc. */
  markdown: string;
  /** Display filename for the meta row, e.g. "STATUS.md". */
  file: string;
  /** File mtime (ms epoch) from the StateDoc payload; omitted → no "ago". */
  mtimeMs?: number | null;
  /** Stable per-page key for TOC ids + sessionStorage collapse state, e.g. "status". */
  page: string;
}) {
  const split = useMemo(
    () => splitMarkdownSections(markdown, page),
    [markdown, page],
  );
  const toc = useMemo(() => splitToToc(split), [split]);
  const { isCollapsed, toggle, setCollapsed } = useSectionCollapse(page);

  // h3 id → owning section id, so a TOC jump into a collapsed section expands it.
  const sectionOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of split.sections) {
      map.set(s.id, s.id);
      for (const h of s.h3s) map.set(h.id, s.id);
    }
    return map;
  }, [split]);

  const expandForNavigate = useCallback(
    (id: string) => {
      const owner = sectionOf.get(id);
      if (owner && isCollapsed(owner)) setCollapsed(owner, false);
    },
    [sectionOf, isCollapsed, setCollapsed],
  );

  return (
    <DocLayout
      toc={toc}
      meta={
        <DocMeta file={file} mtimeMs={mtimeMs} bytes={byteLength(markdown)} />
      }
      onBeforeNavigate={expandForNavigate}
    >
      {split.preamble && (
        <div className="docpage-preamble">
          <Markdown source={split.preamble} />
        </div>
      )}
      {split.sections.map((s) => (
        <DocSectionCard
          key={s.id}
          id={s.id}
          title={s.title}
          collapsed={isCollapsed(s.id)}
          onToggle={() => toggle(s.id)}
        >
          <MarkdownSectionBody section={s} />
        </DocSectionCard>
      ))}
    </DocLayout>
  );
}
