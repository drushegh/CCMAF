---
name: accessibility-development
description: >-
  Digital accessibility engineering and auditing: WCAG 2.2 AA as the
  working standard, EU/Irish statutory framing (EN 301 549, Web
  Accessibility Directive, European Accessibility Act), ARIA patterns,
  keyboard and focus management, accessible forms/tables/charts, testing
  tooling (axe-core, Playwright, screen readers) and a structured audit
  checklist. Use for ANY work involving accessibility, a11y, WCAG,
  ARIA, screen readers, keyboard navigation, accessibility audits or
  statements, EN 301 549, EAA compliance, or making UIs usable by
  people with disabilities — including reviewing existing UIs.
---

# Accessibility Development

Standards for building and auditing accessible digital services.
Sources: W3C (WCAG 2.2, ARIA APG), official EU/Irish materials, plus
three saved reference repos (Community-Access 80-agent suite incl.
compliance mapping; AccessLint audit skills; cskiro severity rubric).

## Working standard

**WCAG 2.2 Level AA** is the default conformance target for all new
work. Rationale: it is the current W3C recommendation, EN 301 549's
next revision (4.1.1, expected 2026) incorporates it, and building to
2.1 AA today guarantees rework. Where a contract specifies EN 301 549
v3.2.1 (= WCAG 2.1 AA + extra clauses), 2.2 AA is a superset on the
web side — meet it anyway.

## Statutory context (public sector bodies)

Date-stamped June 2026; engineering framing, not legal advice — full
detail in `references/eu-legal-framework.md`:

- **Web Accessibility Directive** (2016/2102): public sector websites
  and mobile apps must meet the harmonised standard (EN 301 549) and
  publish an **accessibility statement** with feedback mechanism.
  Monitored in Ireland by the National Disability Authority.
- **EN 301 549 v3.2.1** (2021): the harmonised standard — WCAG 2.1 AA
  for web PLUS clauses beyond WCAG (non-web software, documents,
  hardware, support services). Compliance claims citing only WCAG miss
  the non-web clauses.
- **European Accessibility Act**: in force for in-scope products and
  services since **28 June 2025**, transposed into Irish law — extends
  accessibility duties to the private sector (e-commerce, banking,
  transport, e-books). Changes the client conversation: accessibility
  is now a legal exposure, not a nice-to-have.

## Non-negotiables

1. **Semantic HTML first; ARIA second.** Native elements (`button`,
   `nav`, `label`, `dialog`) ship semantics, keyboard behaviour and AT
   support for free. The first rule of ARIA: don't use ARIA when a
   native element exists. No ARIA beats bad ARIA.
2. **Everything operable by keyboard alone** — visible focus, logical
   order, no traps, skip link. If you can't complete the journey
   without a mouse, it fails (2.1.1/2.4.3/2.4.7 and WCAG 2.2's focus-
   not-obscured 2.4.11).
3. **Accessible name for every interactive element** — from content,
   `label`, or `aria-label(ledby)`. Icon-only buttons without names
   are the most common critical failure.
4. **Contrast**: 4.5:1 normal text, 3:1 large text and UI components/
   graphical objects (1.4.3, 1.4.11). Check states (hover/focus/
   disabled conveys-info) and text over images.
5. **Forms**: programmatic labels, grouped radios/checkboxes
   (`fieldset`/`legend`), errors identified in text and associated to
   fields, no placeholder-as-label, honour WCAG 2.2's redundant-entry
   (3.3.7) and accessible-authentication (3.3.8).
6. **Announce dynamic changes**: live regions for async updates, focus
   management on route changes/modals; status messages (4.1.3) without
   focus theft.
7. **Automated testing catches ~30–50% of issues** — axe-core in CI is
   the floor, never the claim. Manual keyboard + screen reader passes
   are required before asserting conformance
   (`references/testing-tooling.md`).
8. **Never claim compliance without evidence.** Audit findings map to
   specific success criteria with severity; conformance claims state
   standard + version + scope. No vague "fully accessible" language —
   in a formal compliance statement this is checkable and falsifiable.

## Workflow

- **Building**: design tokens with compliant contrast → semantic
  structure (landmarks, headings) → keyboard/focus design → ARIA only
  where needed (`references/aria-keyboard.md`) → axe in CI → manual
  pass per release (`references/testing-tooling.md`).
- **Auditing an existing UI**: scope explicitly → automated sweep →
  keyboard pass → screen reader pass → group findings by pattern
  (not 30 copies of one bug), prioritise by impact × likelihood →
  remediation plan. Full procedure:
  `references/audit-checklist.md`.
- **Compliance work**: map findings to EN 301 549 clauses and
  WAD obligations; draft/review accessibility statements
  (`references/eu-legal-framework.md`).

## High-frequency pitfalls

- `div`/`span` click handlers (no role, no keyboard, no name).
- Focus outline removed globally for aesthetics.
- Modals: focus not moved in, not trapped, not restored on close;
  background not inert.
- SPAs: route changes without focus/title management — silent to AT.
- `aria-hidden="true"` on focusable content; redundant/conflicting
  roles.
- Auto-playing carousels/motion without pause (2.2.2) and no
  `prefers-reduced-motion` handling.
- Data tables without header associations; charts with colour-only
  encoding and no text alternative.
- Target size under 24×24 CSS px (2.5.8, new in 2.2) on mobile-dense
  UIs.

## References

| File | Load when |
|------|-----------|
| `references/wcag-2-2.md` | Success criteria detail, what's new in 2.2, conformance levels |
| `references/eu-legal-framework.md` | EN 301 549, WAD, EAA, Irish context, accessibility statements |
| `references/aria-keyboard.md` | ARIA patterns, keyboard interaction, focus management |
| `references/forms-tables-charts.md` | Accessible forms, data tables, data visualisation |
| `references/testing-tooling.md` | axe-core, Playwright, Lighthouse, screen reader testing |
| `references/audit-checklist.md` | Structured audit of an existing UI, severity rubric, reporting |
| `references/microsoft-stack-a11y.md` | Power Apps, Power Pages, SPFx/Teams accessibility specifics |

## Boundaries with sibling skills

- Visual design craft, Tailwind, component styling →
  `frontend-development` (this skill owns the a11y acceptance bar).
- React implementation patterns → `react-development`.
- Power Apps/Pages build detail → `power-platform-development` /
  `power-pages-development` (short a11y specifics stay here in
  `microsoft-stack-a11y.md`).
- Document accessibility (PDF/Office) is covered only at awareness
  level — the Community-Access reference repo has dedicated document
  agents if needed.
