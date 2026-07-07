/**
 * VirtualList.tsx — small, dependency-free windowed list for the Sessions view.
 *
 * Why not a library: the need is narrow (variable-height rows, prepend-anchor
 * preservation for "load earlier", follow-the-tail mode, scroll-to-key) and
 * the Console avoids heavy deps. ~200 lines beats a new package.
 *
 * Mechanics:
 *  - Each row has an ESTIMATED height (by caller) refined by a ResizeObserver
 *    measurement once rendered (guarded — jsdom has no ResizeObserver and
 *    estimates alone keep tests deterministic).
 *  - Offsets are a lazily-recomputed prefix-sum; visible range found by
 *    binary search; overscan rows either side; top/bottom spacer divs.
 *  - PREPEND detection: if the previous first key reappears at index n>0, the
 *    scrollTop is advanced by the height of the n new rows, so "load earlier"
 *    injects history above WITHOUT moving what you were reading.
 *  - Height-correction anchoring: when rows ABOVE the viewport re-measure,
 *    scrollTop is adjusted by the delta (expanding a chip above you doesn't
 *    shove your reading position).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

export interface VirtualItem {
  key: string;
}

export interface VirtualListHandle {
  /** Scroll a row into view. align "center" | "start" | "end" (default center). */
  scrollToKey: (key: string, align?: "center" | "start" | "end") => void;
  scrollToBottom: (smooth?: boolean) => void;
  /** The scrollable element (for focus / scroll-state queries). */
  element: () => HTMLDivElement | null;
}

interface VirtualListProps<T extends VirtualItem> {
  items: T[];
  estimateHeight: (item: T) => number;
  renderRow: (item: T, index: number) => ReactNode;
  /** Fired when the "pinned to bottom" state changes (follow mode). */
  onAtBottomChange?: (atBottom: boolean) => void;
  /**
   * While true, the list re-glues itself to the bottom whenever CONTENT
   * grows/re-measures (live follow + open-at-the-end). User scrolling is
   * never fought: a height-neutral scroll flips atBottom → the owner drops
   * this flag before the next content change.
   */
  pinToBottom?: boolean;
  /** Extra rows rendered either side of the viewport. */
  overscan?: number;
  className?: string;
  /** Accessible list semantics (role=list on the scroller). */
  "aria-label"?: string;
  style?: CSSProperties;
}

/** Viewport fallback when clientHeight is 0 (jsdom / first paint). */
const FALLBACK_VIEWPORT = 800;
const AT_BOTTOM_SLACK = 48;

function VirtualListInner<T extends VirtualItem>(
  {
    items,
    estimateHeight,
    renderRow,
    onAtBottomChange,
    pinToBottom = false,
    overscan = 6,
    className,
    style,
    "aria-label": ariaLabel,
  }: VirtualListProps<T>,
  ref: React.Ref<VirtualListHandle>,
) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const heightsRef = useRef(new Map<string, number>());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(FALLBACK_VIEWPORT);
  const atBottomRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  // Bumps a re-render (and the offsets memo) when measurements change.
  const [measureNonce, setMeasureNonce] = useState(0);

  const heightOf = useCallback(
    (item: T): number =>
      heightsRef.current.get(item.key) ?? estimateHeight(item),
    [estimateHeight],
  );

  // Prefix-sum offsets. offsets[i] = top of row i; offsets[n] = total height.
  const offsets = useMemo(() => {
    const out = new Array<number>(items.length + 1);
    out[0] = 0;
    for (let i = 0; i < items.length; i++)
      out[i + 1] = out[i] + heightOf(items[i]);
    return out;
    // measureNonce pulls fresh heightsRef data into the memo after ResizeObserver
    // updates — without it, measured heights would never reach the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, heightOf, measureNonce]);

  const totalHeight = offsets[items.length] ?? 0;

  /** Index of the first row whose bottom edge is below `y`. */
  const indexAt = useCallback(
    (y: number): number => {
      let lo = 0;
      let hi = items.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offsets[mid + 1] <= y) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
    [items.length, offsets],
  );

  const first =
    items.length === 0 ? 0 : Math.max(0, indexAt(scrollTop) - overscan);
  const last =
    items.length === 0
      ? -1
      : Math.min(items.length - 1, indexAt(scrollTop + viewportH) + overscan);

  /* ── Scroll handling ── */
  const readScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    const vh = el.clientHeight || FALLBACK_VIEWPORT;
    setViewportH(vh);
    const atBottom = el.scrollHeight - el.scrollTop - vh < AT_BOTTOM_SLACK;
    if (atBottom !== atBottomRef.current) {
      atBottomRef.current = atBottom;
      onAtBottomChange?.(atBottom);
    }
  }, [onAtBottomChange]);

  const onScroll = useCallback(() => {
    if (rafRef.current !== null) return;
    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) =>
            setTimeout(() => cb(0), 16) as unknown as number;
    rafRef.current = raf(() => {
      rafRef.current = null;
      readScroll();
    }) as unknown as number;
  }, [readScroll]);

  useEffect(
    () => () => {
      if (
        rafRef.current !== null &&
        typeof cancelAnimationFrame === "function"
      ) {
        cancelAnimationFrame(rafRef.current);
      }
    },
    [],
  );

  /* ── Prepend anchoring ──
     Track the first REAL row (synthetic rows like "load-earlier" keep index 0
     across a prepend, which would defeat a first-key check). When that row's
     index GROWS, rows were inserted above — advance scrollTop by their height
     so the reading position doesn't move. Index checks (not offset deltas)
     keep measurement-only updates from triggering this. */
  const anchorRef = useRef<{
    key: string;
    index: number;
    offset: number;
  } | null>(null);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const anchor = anchorRef.current;
    if (el && anchor) {
      const idx = items.findIndex((it) => it.key === anchor.key);
      if (idx > anchor.index) {
        el.scrollTop += offsets[idx] - anchor.offset;
        setScrollTop(el.scrollTop);
      }
    }
    const fi = items.findIndex((it) => it.key !== "load-earlier");
    anchorRef.current =
      fi === -1 ? null : { key: items[fi].key, index: fi, offset: offsets[fi] };
  }, [items, offsets]);

  /* ── Bottom pinning (open-at-the-end + live follow) ──
     Re-glue ONLY when the content's height/shape changed — a user scroll is
     height-neutral, so scrolling up never fights the pin (atBottom flips and
     the owner clears pinToBottom before the next content change). */
  const lastPinShapeRef = useRef<string>("");
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const shape = `${items.length}:${Math.round(totalHeight)}`;
    if (pinToBottom && shape !== lastPinShapeRef.current) {
      el.scrollTop = el.scrollHeight;
      readScroll();
    }
    lastPinShapeRef.current = shape;
  });

  /* ── Row measurement (ResizeObserver, guarded for jsdom) ──
     ONE observer for the component's lifetime — recreating it per render
     would silently drop the observations of already-mounted rows (callback
     refs only run on mount). The callback reads the CURRENT layout via refs. */
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const estimateRef = useRef(estimateHeight);
  estimateRef.current = estimateHeight;

  const roRef = useRef<ResizeObserver | null>(null);
  const keyOfEl = useRef(new WeakMap<Element, string>());
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const el = scrollerRef.current;
      const curItems = itemsRef.current;
      const curOffsets = offsetsRef.current;
      let dirty = false;
      let aboveDelta = 0;
      for (const entry of entries) {
        const key = keyOfEl.current.get(entry.target);
        if (!key) continue;
        const h = entry.target.getBoundingClientRect().height;
        if (h <= 0) continue;
        const prev = heightsRef.current.get(key);
        if (prev === undefined || Math.abs(prev - h) > 0.5) {
          heightsRef.current.set(key, h);
          dirty = true;
          // If this row sits fully above the viewport, keep the reading
          // position anchored by compensating scrollTop.
          if (el) {
            const idx = curItems.findIndex((it) => it.key === key);
            if (idx !== -1 && curOffsets[idx + 1] <= el.scrollTop) {
              aboveDelta += h - (prev ?? estimateRef.current(curItems[idx]));
            }
          }
        }
      }
      if (aboveDelta !== 0 && el) {
        el.scrollTop += aboveDelta;
      }
      if (dirty) setMeasureNonce((n) => n + 1);
    });
    roRef.current = ro;
    return () => {
      ro.disconnect();
      roRef.current = null;
    };
  }, []);

  const measureRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const key = el.dataset.vkey;
    if (!key) return;
    keyOfEl.current.set(el, key);
    roRef.current?.observe(el);
  }, []);

  /* ── Imperative API ── */
  useImperativeHandle(
    ref,
    (): VirtualListHandle => ({
      scrollToKey: (key, align = "center") => {
        const el = scrollerRef.current;
        if (!el) return;
        const idx = items.findIndex((it) => it.key === key);
        if (idx === -1) return;
        const vh = el.clientHeight || FALLBACK_VIEWPORT;
        let top = offsets[idx];
        if (align === "center")
          top -= Math.max(0, (vh - heightOf(items[idx])) / 2);
        if (align === "end") top -= Math.max(0, vh - heightOf(items[idx]));
        el.scrollTop = Math.max(0, top);
        readScroll();
      },
      scrollToBottom: (smooth = false) => {
        const el = scrollerRef.current;
        if (!el) return;
        const prefersReduced =
          typeof matchMedia === "function" &&
          matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (smooth && !prefersReduced && typeof el.scrollTo === "function") {
          el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
        } else {
          el.scrollTop = el.scrollHeight;
        }
        readScroll();
      },
      element: () => scrollerRef.current,
    }),
    [items, offsets, heightOf, readScroll],
  );

  /* ── Initial viewport read ── */
  useLayoutEffect(() => {
    readScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topPad = first > 0 ? offsets[first] : 0;
  const bottomPad = last >= 0 ? totalHeight - offsets[last + 1] : 0;

  const slice: ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    const item = items[i];
    slice.push(
      <div key={item.key} data-vkey={item.key} ref={measureRef} role="listitem">
        {renderRow(item, i)}
      </div>,
    );
  }

  return (
    <div
      ref={scrollerRef}
      className={className}
      style={style}
      onScroll={onScroll}
      role="list"
      aria-label={ariaLabel}
      tabIndex={-1}
    >
      <div style={{ height: topPad }} aria-hidden="true" />
      {slice}
      <div style={{ height: bottomPad }} aria-hidden="true" />
    </div>
  );
}

export const VirtualList = forwardRef(VirtualListInner) as <
  T extends VirtualItem,
>(
  props: VirtualListProps<T> & { ref?: React.Ref<VirtualListHandle> },
) => ReturnType<typeof VirtualListInner>;
