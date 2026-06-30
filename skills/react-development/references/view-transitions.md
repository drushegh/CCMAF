# View Transitions

Native-feeling animations via React's `<ViewTransition>` component over
the browser View Transition API. **Experimental**: needs `react@canary`
standalone, or Next.js App Router (bundles canary — don't install canary
there) plus `experimental.viewTransition: true`. Unsupported browsers
skip animations gracefully (Chromium 111+, Firefox 144+, Safari 18.2+).

## Principles

- Every `<ViewTransition>` must communicate something — spatial
  relationship or continuity. Can't articulate it? Don't add it.
- React assigns `view-transition-name` and calls
  `document.startViewTransition` — **never call it yourself**.
- Only `startTransition`, `useDeferredValue`, or Suspense reveals
  activate VTs — plain `setState` doesn't animate.
- **`default="none"` liberally** — otherwise every VT cross-fades on
  every transition (Suspense resolves, revalidations).
- Implement in priority order: shared element morph → Suspense reveal →
  list identity → enter/exit → route change.

## Placement Rule

`<ViewTransition>` only fires enter/exit when it sits **before any DOM
node** — a wrapper `<div>` between the boundary and the VT suppresses it:

```tsx
// ✅ works — VT is the outermost node
const works = (
  <ViewTransition enter="auto">
    <div>Content</div>
  </ViewTransition>
);

// ❌ broken — wrapper div suppresses enter/exit
const broken = (
  <div>
    <ViewTransition enter="auto">
      <div>Content</div>
    </ViewTransition>
  </div>
);
```

## Styling

Props take `"auto"` (browser cross-fade), `"none"`, a CSS class name, or
a type-keyed object. Style via pseudo-elements:

```css
::view-transition-old(.slide-out) { animation: slide-out 0.25s ease-in; }
::view-transition-new(.slide-in)  { animation: slide-in 0.25s ease-out; }

/* Always include reduced-motion opt-out */
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; }
}
```

## Directional Navigation

Tag the transition, key the animation per type:

```tsx
startTransition(() => {
  addTransitionType("nav-forward");
  router.push("/detail/1");
});

<ViewTransition
  enter={{ "nav-forward": "slide-from-right", "nav-back": "slide-from-left", default: "none" }}
  exit={{ "nav-forward": "slide-to-left", "nav-back": "slide-to-right", default: "none" }}
  default="none"
>
  <Page />
</ViewTransition>
```

Directional slides are for hierarchy (list → detail) and ordered
sequences (prev/next) only — lateral tab navigation gets a plain fade.
Next.js `next/link` accepts a `transitionTypes` prop. **`router.back()`
and the browser back button do not trigger VTs** (popstate is
synchronous) — use `router.push()` for animated back-navigation.

## Shared Element Morphs

Same `name` on an unmounting and a mounting VT creates a morph:

```tsx
// List item
const listItem = (
  <ViewTransition name={`photo-${id}`}>
    <img src={thumb} />
  </ViewTransition>
);

// Detail page — same name on the mounting VT creates the morph
const detail = (
  <ViewTransition name={`photo-${id}`}>
    <img src={full} />
  </ViewTransition>
);
```

- Names must be unique among mounted VTs (`photo-${id}`); a reusable
  component rendered twice (page + modal) with the same name breaks the
  morph.
- `share` beats `enter`/`exit` when a pair forms; when no pair forms,
  enter/exit fires — give those paths a fallback.
- Never pair a fade-out exit with shared morphs — use directional slides.

## Common Patterns

```tsx
// List reorder — per-item identity (trigger inside startTransition)
const list = items.map(item => (
  <ViewTransition key={item.id}><ItemCard item={item} /></ViewTransition>
));

// List item containing a shared element: two nested boundaries —
// outer = list identity, inner = cross-route morph
const listItemWithMorph = (
  <ViewTransition key={item.id}>
    <Link href={`/items/${item.id}`}>
      <ViewTransition name={`item-image-${item.id}`} share="morph">
        <Image src={item.image} />
      </ViewTransition>
    </Link>
  </ViewTransition>
);

// Suspense reveal (no type available — use simple string props)
const reveal = (
  <Suspense fallback={<ViewTransition exit="slide-down"><Skeleton /></ViewTransition>}>
    <ViewTransition enter="slide-up" default="none"><Content /></ViewTransition>
  </Suspense>
);

// Force re-enter on filter change (careful: remounts Suspense inside)
const reEnter = (
  <ViewTransition key={searchParams.toString()} enter="slide-up" default="none">
    <ResultsGrid />
  </ViewTransition>
);
```

## Coexistence and Limits

Directional page VTs (type-keyed, fire on navigation) and Suspense-reveal
VTs (string props, fire on data load) coexist — different transitions,
`default="none"` on both prevents crossfire. Types are not available
during later Suspense reveals. Nested VTs don't fire their own enter/exit
when the parent exits — only the outermost animates (no per-item stagger
on page navigation today). Isolate persistent elements (headers, navs)
with their own named VT so page transitions don't drag them along.
