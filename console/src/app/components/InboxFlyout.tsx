/**
 * InboxFlyout — the header's Needs-you inbox (TASK-109; CONSOLE-V2-DESIGN.md §2.9).
 *
 * A bell icon-button (beside the AccentPicker) with a count badge; clicking it
 * opens a right-anchored flyout of ranked "needs a human" items from
 * GET /api/attention (S3). Rows: severity glyph (colour + icon — never colour
 * alone), kind chip, title, and an age chip when the item has waited > 24h.
 * Clicking a row deep-links to its in-project route and closes the flyout.
 * Empty state is a positive: "Nothing needs you".
 *
 * The flyout is rendered in a PORTAL to <body>, positioned `fixed` under the
 * trigger — the same placement mechanics as AccentPicker: the header sets
 * `backdrop-filter`, which creates a stacking context that paints BELOW the
 * page content, so an in-header absolutely-positioned panel would be trapped
 * there (real clicks land on the content behind it). Portalling out of that
 * context is the fix; the outside-click handler checks BOTH the trigger root
 * and the portaled panel.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Check,
  ClipboardCheck,
  Download,
  Flag,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  fetchAttention,
  type AttentionItem,
  type AttentionKind,
} from "../api/attention";

/** Background refresh cadence — the feed is cheap (small file reads). */
const REFRESH_MS = 60_000;

/** Per-kind glyph + tone. Colour is ALWAYS paired with a distinct icon shape. */
const KIND_GLYPHS: Record<
  AttentionKind,
  { icon: React.ReactNode; tone: "danger" | "warn" | "accent" | "info" }
> = {
  bug: { icon: <XCircle size={14} />, tone: "danger" },
  doctor: { icon: <AlertTriangle size={14} />, tone: "warn" },
  verify: { icon: <ClipboardCheck size={14} />, tone: "accent" },
  decision: { icon: <Flag size={14} />, tone: "info" },
  review: { icon: <ShieldAlert size={14} />, tone: "warn" },
  update: { icon: <Download size={14} />, tone: "info" },
};

/** Kind chip label; bugs carry their severity (rank 0 = P0, rank 3 = P1). */
function chipLabel(item: AttentionItem): string {
  if (item.kind === "bug") return item.rank === 0 ? "P0 BUG" : "P1 BUG";
  return item.kind.toUpperCase();
}

/** Whole days an item has waited; 0 when < 24h or no timestamp. */
function ageDays(since: string | null, now: number): number {
  if (!since) return 0;
  const t = Date.parse(since);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

export function InboxFlyout() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AttentionItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => {
    fetchAttention()
      .then((list) => {
        setItems(list);
        setFailed(false);
      })
      .catch(() => setFailed(true)); // keep the last good list; badge stays honest
  }, []);

  // Fetch on mount + a slow background cadence (the bell is furniture, not a
  // live stream); each OPEN also refetches so the panel is fresh when read.
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Anchor the fixed panel under the trigger (right-aligned) — AccentPicker's
  // placement mechanics (see the header comment for why it must portal).
  const place = () => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    setPos({
      top: Math.round(r.bottom + 8),
      right: Math.round(window.innerWidth - r.right),
    });
  };
  const openPanel = () => {
    place();
    refresh();
    setOpen(true);
  };

  // Reposition while open if the layout shifts; close on scroll (the fixed
  // panel would otherwise detach from the trigger).
  useLayoutEffect(() => {
    if (!open) return;
    const onResize = () => place();
    const onScroll = () => setOpen(false);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Close on outside click (pointerdown so it beats focus shifts). The panel
  // is portaled out of rootRef, so check it explicitly too.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !popRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Focus the first row (or the panel itself) when opening.
  useEffect(() => {
    if (!open) return;
    const first =
      popRef.current?.querySelector<HTMLButtonElement>(".console-inbox-row");
    (first ?? popRef.current)?.focus();
  }, [open]);

  const close = (refocusTrigger: boolean) => {
    setOpen(false);
    if (refocusTrigger) triggerRef.current?.focus();
  };

  const go = (item: AttentionItem) => {
    setOpen(false);
    navigate(item.link);
  };

  const count = items?.length ?? 0;
  const now = Date.now();

  return (
    <div className="console-inbox" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="console-theme-toggle console-inbox-bell"
        aria-label={
          count > 0
            ? `Needs-you inbox: ${count} item${count === 1 ? "" : "s"}`
            : "Needs-you inbox: nothing needs you"
        }
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Needs-you inbox"
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openPanel();
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            close(true);
          }
        }}
      >
        <Bell size={16} />
        {count > 0 && (
          <span className="console-inbox-badge" aria-hidden="true">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            role="dialog"
            aria-label="Needs-you inbox"
            className="console-inbox-pop"
            ref={popRef}
            tabIndex={-1}
            style={{ position: "fixed", top: pos.top, right: pos.right }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close(true);
              }
            }}
          >
            <div className="console-inbox-head">
              Needs you{count > 0 ? ` (${count})` : ""}
            </div>

            {failed && items === null ? (
              <div className="console-inbox-empty">
                Couldn’t load the attention feed
              </div>
            ) : count === 0 ? (
              <div className="console-inbox-empty is-positive">
                <Check size={14} /> Nothing needs you
              </div>
            ) : (
              <ul className="console-inbox-list" role="list">
                {(items ?? []).map((item, i) => {
                  const glyph = KIND_GLYPHS[item.kind];
                  const days = ageDays(item.since, now);
                  return (
                    <li key={`${item.kind}:${item.link}:${i}`}>
                      <button
                        type="button"
                        className="console-inbox-row"
                        title={item.detail}
                        onClick={() => go(item)}
                      >
                        <span
                          className={`console-inbox-glyph is-${glyph.tone}`}
                          aria-hidden="true"
                        >
                          {glyph.icon}
                        </span>
                        <span className={`console-inbox-kind is-${glyph.tone}`}>
                          {chipLabel(item)}
                        </span>
                        <span className="console-inbox-title">
                          {item.title}
                        </span>
                        {item.count !== undefined && (
                          <span
                            className="console-inbox-count"
                            aria-label={`${item.count} items`}
                          >
                            {item.count}
                          </span>
                        )}
                        {days >= 1 && (
                          <span
                            className="console-inbox-age"
                            title={
                              item.since
                                ? `waiting since ${new Date(item.since).toLocaleString()}`
                                : undefined
                            }
                          >
                            {days}d
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
