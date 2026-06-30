# Accessible Forms, Tables and Data Visualisation

## Forms

- **Every control has a programmatic label**: `<label for>` (or
  wrapping label). Placeholder is never the label (disappears, low
  contrast, not reliably announced). Visually-hidden labels are
  acceptable where design demands, but visible labels are better
  (2.5.3, cognitive load).
- **Group related controls**: `fieldset` + `legend` for radio/checkbox
  groups; the legend is announced with each option.
- **Identify input purpose** (1.3.5): `autocomplete="name|email|tel|
  postal-code|…"` on personal-data fields — enables autofill and
  user-agent assistance, and satisfies WCAG 2.2's redundant-entry
  direction of travel.
- **Errors** (3.3.1–3.3.4): identified in text (not colour/icon
  alone), associated via `aria-describedby`, `aria-invalid` set, and
  an error summary with links to fields for long forms; move focus to
  the summary on failed submit. Provide suggestions where known.
  Legal/financial/data-deletion submissions need reversal,
  verification or confirmation (3.3.4).
- **Don't ask twice** (3.3.7, new 2.2): within a process, previously
  entered data is auto-populated or selectable.
- **Authentication** (3.3.8, new 2.2): no memorise/transcribe-only
  logins — allow paste and password managers; offer non-cognitive
  alternatives to puzzle CAPTCHAs (object recognition is permitted at
  AA, but prefer better).
- Required fields: native `required` plus visible indication that
  isn't colour-only; mark optional rather than required when most
  fields are required.
- Never auto-submit on selection change (3.2.2) and never move focus
  unexpectedly while typing.

## Data tables

- One table = one purpose. Layout tables are extinct; use CSS.
- `caption` describes the table; `th` with `scope="col|row"` for
  simple tables; `headers`/`id` associations only for genuinely
  complex matrices (consider splitting instead).
- Sortable columns: the header contains a `button` with
  `aria-sort="ascending|descending|none"` on the `th`.
- Responsive behaviour: reflow (1.4.10) without losing header
  context — sticky headers, per-row stacked labels, or an explicit
  alternative view; horizontal scroll within the table region with
  keyboard access is acceptable.
- Pagination/filters are part of the table's accessible UX: announce
  result-count changes via `role="status"`.

## Charts and data visualisation

Principles: a chart is content, not decoration — it needs a text
equivalent proportional to its information density.

1. **Text alternative ladder**: short `alt`/accessible name stating
   the takeaway → adjacent text summary of the trend/key values →
   full data table (visible or disclosure) for dense charts. The
   underlying data table is the most robust equivalent.
2. **Never colour-only encoding** (1.4.1): add direct labels,
   patterns/shapes, or line styles; series must be distinguishable in
   greyscale. Contrast 3:1 for chart graphical elements (1.4.11).
3. **Interactive charts**: every interaction (tooltip values, zoom,
   filter) needs a keyboard path and the data needs a non-hover
   route; SVG charts get `role="img"` + name for simple cases, or a
   structured table fallback for exploration.
4. **Dashboards**: reading order through widgets must be logical;
   each widget needs a heading; auto-refreshing numbers use polite
   live regions sparingly (or a manual refresh affordance).
5. Library reality: most charting libraries are not accessible by
   default — budget for the table fallback and text summaries rather
   than fighting tooltip DOM. (Power BI specifics →
   `microsoft-stack-a11y.md`.)

## Documents in the service journey

Forms/letters shipped as PDFs or Office docs fall under EN 301 549
clause 10 — tagged PDFs, real headings, label-associated form fields,
reading order. Prefer HTML over PDF where possible. Deep document
remediation: see the Community-Access reference repo (pdf/word/excel
specialist agents).
