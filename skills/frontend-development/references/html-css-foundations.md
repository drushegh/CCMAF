# HTML and CSS Foundations

## Semantic HTML

Structure carries meaning for browsers, assistive tech, and search:

```html
<body>
  <header>…site header…</header>
  <nav aria-label="Main">…</nav>
  <main>
    <article>
      <h1>One h1 per page</h1>
      <section aria-labelledby="features-heading">
        <h2 id="features-heading">Headings descend in order</h2>
      </section>
    </article>
  </main>
  <footer>…</footer>
</body>
```

- Interactive = real elements: `<button>` for actions, `<a href>` for
  navigation — never `<div onclick>` (no keyboard, no focus, no
  semantics).
- Every input has a `<label for>`; groups of inputs use
  `<fieldset>`/`<legend>`.
- Every `<img>` has `alt` — descriptive for content images, `alt=""` for
  decorative ones.
- Lists are `<ul>`/`<ol>`, tabular data is `<table>` with `<th scope>` —
  not styled divs.
- Use `<dialog>`, `popover`, and `<details>` before reaching for JS
  re-implementations.

## Accessibility Floor

- **Keyboard**: everything operable by keyboard; visible
  `:focus-visible` styles (never remove outlines without replacing);
  logical tab order; skip link for long nav.
- **Contrast**: ≥ 4.5:1 body text, ≥ 3:1 large text and UI components —
  check both themes.
- **Motion**: wrap non-essential animation in
  `@media (prefers-reduced-motion: no-preference)` or disable under
  `reduce`.
- **ARIA is a last resort** — prefer native semantics; when used, keep
  state attributes (`aria-expanded`, `aria-selected`) updated, and hide
  decorative icons with `aria-hidden="true"` + provide `.sr-only` text
  for icon-only buttons.
- **Zoom**: layout survives 200% zoom and 375px-wide viewports.

## Layout: Flexbox vs Grid

- **Flexbox** — one dimension: toolbars, nav rows, centring, spacing a
  line of items (`display: flex; gap: …`).
- **Grid** — two dimensions or explicit tracks: page scaffolds, card
  grids, form layouts.

```css
/* Responsive card grid without media queries */
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1.5rem;
}
```

- Prefer `gap` over margins between siblings — no first/last special
  cases.
- Prefer intrinsic sizing (`min-height`, `fit-content`, `minmax`) over
  fixed heights — content always grows.
- Container queries size components by their container, not the viewport:

```css
.card-host { container-type: inline-size; }

@container (min-width: 24rem) {
  .card { grid-template-columns: auto 1fr; }
}
```

## Custom Properties and Fluid Type

```css
:root {
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-4: 1rem;
  /* Fluid type: scales between viewport sizes without breakpoints */
  --text-display: clamp(2.25rem, 1.5rem + 3vw, 4rem);
}

.hero h1 {
  font-size: var(--text-display);
  line-height: 1.1;
  text-wrap: balance;     /* even multi-line headlines */
}
```

`text-wrap: balance` for headings, `text-wrap: pretty` for body;
`max-width: 65ch` keeps prose measure readable.

## Specificity Discipline

Generated CSS commonly breaks through selectors cancelling each other —
e.g. `.section` padding fighting an element selector's margins.

- Keep specificity flat: single-class selectors; avoid type selectors for
  layout adjustments and IDs for styling entirely.
- One source of truth per axis: vertical rhythm between sections comes
  from the section container's `gap` or a single margin convention — not
  from both ends.
- `@layer` (or Tailwind's layers) to make override order explicit.
- Modern selectors reduce specificity wrestling: `:where()` contributes
  zero specificity; `:has()` enables parent-state styling
  (`label:has(input:invalid)`).

## Responsive Strategy

Mobile-first: base styles for small screens, `min-width` queries (or
Tailwind's `sm:`/`md:`/`lg:`) layering enhancements upward. Test at
375px, a mid tablet width, and wide desktop; verify long content, long
words (`overflow-wrap: break-word`), and empty states don't break the
layout.

## Images and Performance

- `width`/`height` (or `aspect-ratio`) on media to prevent layout shift.
- `loading="lazy"` below the fold; `srcset`/`sizes` for responsive
  images; prefer SVG for icons and logos.
- Self-host fonts with `font-display: swap`, preload the display face,
  subset where possible; system font stack is a legitimate choice.
