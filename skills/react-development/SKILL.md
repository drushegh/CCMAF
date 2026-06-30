---
name: react-development
description: >-
  React and Next.js engineering: performance (waterfalls, bundle size,
  re-renders), composition patterns, React Server Components, data fetching,
  and view transitions, with detailed topic references loaded on demand.
  Distilled from Vercel Engineering's official agent skills. Use this skill
  whenever any React or Next.js code is written, reviewed, or refactored —
  components, hooks, pages, layouts, server actions, route handlers — even
  if the user doesn't mention performance or patterns. Triggers include:
  .tsx/.jsx components, useState/useEffect/use, RSC or 'use client'/'use
  server', data fetching, SWR/TanStack Query, Suspense, hydration errors,
  slow pages or large bundles, Next.js App Router work, page/route
  animations.
---

# React Development

Consolidated React/Next.js engineering for agents. The rules in this file
always apply; load `references/` files only when the task touches that
topic. Boundaries: TypeScript language/typing standards live in
typescript-development; visual design and Tailwind live in
frontend-development. This skill owns React behaviour, data flow, and
performance.

## Component Model

**Server-first where the framework supports it** (Next.js App Router):
fetch in Server Components, keep `'use client'` islands small and at the
leaves. Client components are for interactivity — hooks, handlers, browser
APIs. The Server/Client boundary serialises props into the HTML payload:
pass only the fields the client uses, never whole entities. Details:
[references/rsc-and-nextjs.md](references/rsc-and-nextjs.md).

## Non-Negotiable Component Rules

```tsx
// 1. NEVER define components inside components — new type every render,
//    full remount: state lost, focus lost, effects re-run
function Parent({ theme }) {
  const Child = () => renderThemed(theme);   // ❌ extract and pass props
}

// 2. Derive state during render — no state+effect mirroring
const fullName = firstName + " " + lastName;        // ✅ not setState in useEffect

// 3. Functional setState when updating from current state —
//    stable callbacks, no stale closures
setItems(curr => [...curr, item]);                   // ✅ deps-free useCallback

// 4. Ternary, not &&, when the condition can be 0/NaN
count > 0 ? badgeNode : null         // ✅ {count && ...} renders "0"

// 5. Lazy-init expensive state
useState(() => buildIndex(items));                   // ✅ not useState(buildIndex(items))

// 6. Never mutate props/state — toSorted/toReversed/toSpliced over
//    sort/reverse/splice on React data

// 7. Interaction logic lives in event handlers, not state+effect chains.
//    Effects are for synchronising with external systems — nothing else.
```

## Performance Priorities (work top-down)

1. **Eliminate waterfalls — CRITICAL.** Each sequential `await` adds full
   network latency. `Promise.all` for independent ops; start promises
   early, await late; defer `await` into the branch that uses it; Suspense
   to stream non-critical sections; in RSC, sibling async components
   parallelise — sequential awaits in one component don't.
2. **Bundle size — CRITICAL.** Dynamic-import heavy components
   (`next/dynamic`, `ssr: false` for browser-only); avoid barrel-file
   imports (icon/component libraries cost 200–800ms); defer
   analytics/tracking until after hydration; preload on hover/intent.
3. **Server work — HIGH.** `React.cache()` for per-request dedup;
   module-level hoisting for static assets; never mutable module state for
   request data (concurrent renders leak across users); `after()` for
   non-blocking side effects.
4. **Re-renders — MEDIUM, measure first.** Subscribe to derived booleans
   not raw values; narrow effect deps to primitives; `useDeferredValue` /
   `startTransition` for non-urgent updates; refs for transient values.
   **If React Compiler is enabled, skip manual `memo`/`useMemo` — it does
   this automatically.**

Details: [references/performance-data.md](references/performance-data.md)
(waterfalls, server, fetching) and
[references/performance-rendering.md](references/performance-rendering.md)
(bundle, re-renders, rendering, JS micro-optimisations).

## Composition Over Configuration

Boolean props (`isThread`, `isEditing`, `showX`) multiply states and breed
conditional soup. Build compound components
(`Composer.Frame`/`Composer.Input`/`Composer.Submit`) sharing state via
context, and explicit variants (`ThreadComposer`, `EditComposer`) that
compose what they need. Lift state into providers; UI consumes a generic
`{state, actions, meta}` interface so the same components work with any
state implementation. Children over render props for static structure.
Details: [references/composition.md](references/composition.md).

## Data Fetching Decisions

| Situation | Use |
|---|---|
| Server Component, internal read | Fetch/query directly — no API layer |
| Mutation from your UI | Server Action (auth-check INSIDE the action) |
| External clients, webhooks, cacheable GET | Route Handler |
| Client-side reads | SWR or TanStack Query (dedup, cache) — not useEffect+fetch |
| Client needs initial data | Pass from Server Component as props |

**Server Actions are public endpoints** — validate input (Zod) and
authenticate inside every action, never rely on page-level guards.

## Critical Pitfalls — always check

- **Async client component** (`'use client'` + `async function`) —
  invalid; fetch in a server parent and pass data.
- **Non-serialisable props across the RSC boundary** — functions (except
  server actions), `Date`, `Map`/`Set`, class instances. Serialise first
  (`.toISOString()`, plain objects).
- **`redirect()`/`notFound()` inside try/catch** — they throw internally;
  call outside the try, or `unstable_rethrow(error)` first.
- **`useSearchParams` without a Suspense boundary** — silently makes the
  whole page client-rendered.
- **Hydration mismatches** — browser-only APIs, `new Date()`, random
  values, invalid HTML nesting. Fix with mounted-check, `useId`, or the
  inline-script pattern (no flicker); `suppressHydrationWarning` only for
  genuinely expected differences.
- **`localStorage`/listeners without care** — version stored schemas,
  wrap in try/catch (throws in private browsing), passive listeners for
  scroll/touch.

## Agent Workflow Rules

1. **Match the repo**: React version (19 drops `forwardRef`; `use()` over
   `useContext`), router (App vs Pages), data library, React Compiler
   on/off — these change what correct code looks like.
2. **Priority order for review**: waterfalls → bundle → server → re-renders
   → micro-optimisations. Never lead with micro-optimisations; never
   recommend `memo` sprinkling on cold paths.
3. **Before completion**: typecheck, lint, test (per
   typescript-development); for Next.js verify the build
   (`next build`) passes — RSC boundary violations surface at build time.
4. **Animations between UI states**: use the native View Transition API
   via React's `ViewTransition` (experimental) rather than animation
   libraries — see [references/view-transitions.md](references/view-transitions.md).

## Reference Index

| Load when the task involves... | File |
|---|---|
| Async waterfalls, server caching/dedup, server actions, client fetching | [references/performance-data.md](references/performance-data.md) |
| Bundle size, re-render optimisation, rendering, hydration, JS micro-opts | [references/performance-rendering.md](references/performance-rendering.md) |
| Component architecture: compound components, providers, variants | [references/composition.md](references/composition.md) |
| RSC boundaries, Next.js conventions, data patterns, images/fonts/metadata, errors | [references/rsc-and-nextjs.md](references/rsc-and-nextjs.md) |
| Page/route/list animations, shared element morphs | [references/view-transitions.md](references/view-transitions.md) |
