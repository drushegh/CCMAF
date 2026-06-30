# Performance: Bundle, Re-renders, Rendering

## Bundle Size (CRITICAL — directly hits TTI/LCP)

- **Dynamic-import heavy components**:
  `const Editor = dynamic(() => import("./monaco-editor").then(m => m.MonacoEditor), { ssr: false })`
  — keeps ~300KB out of the main chunk; `ssr: false` also keeps
  browser-only libraries out of the server bundle.
- **Barrel imports**: icon/component libraries (`lucide-react`,
  `@mui/material`, `react-icons`, `date-fns`, `lodash`) load thousands of
  modules through their index — 200–800ms import cost. Next.js 13.5+
  `optimizePackageImports` transforms named imports automatically (keep
  the ergonomic import); otherwise import from the concrete path
  (`@mui/material/Button`) — but check the subpath ships types.
- **Defer third-party scripts** (analytics, logging) until after
  hydration with `dynamic(..., { ssr: false })`.
- **Conditional loading**: `import()` large data/modules when the feature
  activates, guarded with `typeof window !== "undefined"` to keep it out
  of the server bundle.
- **Preload on intent**: `onMouseEnter={() => void import("./editor")}` —
  perceived latency drops without bloating the initial load.
- **Statically analysable paths**: bundlers can't narrow
  `import(SOME_MAP[name])` or `path.join(cwd, variable)` — use explicit
  maps of `() => import("./literal")` and literal paths, or builds widen,
  traces bloat, and cold starts slow.

## Re-render Optimisation (MEDIUM — measure first)

**React Compiler note: when enabled, skip manual `memo`/`useMemo`/
`useCallback` work — the compiler handles it. The correctness rules
(functional setState, derive-don't-sync) still apply.**

- Subscribe to **derived state**: `useMediaQuery("(max-width: 767px)")`
  re-renders on the boolean flip, `useWindowWidth() < 768` re-renders
  every pixel.
- Narrow effect deps to primitives: `[user.id]` not `[user]`; hoist the
  comparison (`const isMobile = width < 768`) so the effect fires on the
  transition, not every change.
- Split combined `useMemo`/`useEffect` bodies with independent deps —
  one combined hook recomputes everything when anything changes.
- Extract expensive subtrees into `memo()` components so parents can
  early-return before the work; memoised components with non-primitive
  default props need the default hoisted to a constant
  (`const NOOP = () => {}`) or memoisation silently breaks.
- Don't `useMemo` trivial expressions with primitive results — the hook
  costs more than the expression.
- `useDeferredValue` for expensive renders driven by typing (wrap the
  computation in `useMemo` over the deferred value, show staleness with
  opacity); `startTransition` for non-urgent frequent updates (scroll
  trackers); `useTransition` over manual `isLoading` state for
  actions.
- Refs for transient values (mouse position, interval counters) — update
  DOM directly, no re-render.
- `useEffectEvent` for callbacks used inside effects — stable
  subscription, latest values, and never put the effect-event function in
  the dependency array.
- App-wide one-time init: module-level guard (`let didInit = false`), not
  bare `useEffect([])` — effects re-run on remount and double-fire in dev.

## Rendering (MEDIUM)

- `content-visibility: auto` + `contain-intrinsic-size` on long-list
  items — browser skips layout/paint for off-screen rows (~10× faster
  initial render for 1,000 rows).
- `<Activity mode={visible ? "visible" : "hidden"}>` to show/hide
  expensive components while preserving state and DOM.
- Resource hints from `react-dom`: `preconnect`/`prefetchDNS` for
  third-party origins, `preload` for critical fonts,
  `preloadModule` on hover for likely navigation.
- Scripts: `next/script` with a `strategy` (or `defer`/`async`) — bare
  `<script>` blocks parsing.
- Hydration: client-only data (theme from localStorage) without flicker →
  inline synchronous script that sets the DOM before hydration; expected
  mismatches (timestamps, locale formatting) → `suppressHydrationWarning`
  on the specific element, sparingly.
- Animate a wrapper `<div>`, not the SVG element (hardware acceleration);
  hoist large static JSX/SVG to module scope (unnecessary under React
  Compiler).

## JavaScript Micro-Optimisations (LOW — hot paths only)

- `Set`/`Map` for membership and keyed lookups; build an index Map before
  a loop of `.find()`s (1M ops → 2K).
- Combine multiple `.filter()`/`.map()` passes into one loop; `flatMap`
  to map+filter in one pass; early return/length-check before expensive
  comparisons; single loop for min/max instead of sort
  (`Math.min(...arr)` overflows the stack on very large arrays).
- Hoist RegExp construction out of render/loops (beware `/g` regex
  mutable `lastIndex`).
- Cache synchronous storage reads (`localStorage`, `document.cookie`) in
  a module Map — invalidate on the `storage` event and tab visibility.
- Batch DOM writes, then read layout once — interleaved read/write forces
  synchronous reflows (layout thrashing). Prefer toggling CSS classes.
- `requestIdleCallback` (with `setTimeout` fallback) for analytics,
  prefetching, non-urgent processing; chunk big tasks against
  `deadline.timeRemaining()`.
