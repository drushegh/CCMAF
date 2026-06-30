# WCAG 2.2 Reference

Authoritative sources: WCAG 2.2 spec (w3.org/TR/WCAG22), Understanding
docs (w3.org/WAI/WCAG22/Understanding), Quick Reference
(w3.org/WAI/WCAG22/quickref). W3C Recommendation since October 2023.

## Structure

Four principles (POUR) → 13 guidelines → success criteria at levels
A / AA / AAA. Conformance at a level requires meeting every criterion
at that level and below, for full pages and complete processes. The
practical contracting bar is **AA**.

- **Perceivable** — text alternatives, captions/transcripts,
  adaptable structure, distinguishable (contrast, reflow, spacing).
- **Operable** — keyboard, timing, seizures, navigable, input
  modalities.
- **Understandable** — readable, predictable, input assistance.
- **Robust** — AT compatibility (name/role/value, status messages).

## New in WCAG 2.2 (vs 2.1)

| SC | Level | Requirement |
|----|-------|-------------|
| 2.4.11 Focus Not Obscured (Minimum) | AA | Focused element not entirely hidden by author content (sticky headers/footers are the usual offenders) |
| 2.4.12 Focus Not Obscured (Enhanced) | AAA | No part hidden |
| 2.4.13 Focus Appearance | AAA | Focus indicator size/contrast minimums |
| 2.5.7 Dragging Movements | AA | Any drag operation has a single-pointer alternative (sliders, kanban, reorder) |
| 2.5.8 Target Size (Minimum) | AA | Targets ≥24×24 CSS px or sufficient spacing (exceptions: inline links, equivalent control elsewhere) |
| 3.2.6 Consistent Help | A | Help mechanisms in consistent order across pages |
| 3.3.7 Redundant Entry | A | Don't ask for the same info twice in a process (auto-populate or make selectable) |
| 3.3.8 Accessible Authentication (Minimum) | AA | No cognitive function test (memorise/transcribe) without alternative — allow paste/password managers; object-recognition CAPTCHAs permitted |
| 3.3.9 Accessible Authentication (Enhanced) | AAA | Stricter — no object recognition either |

**Removed**: 4.1.1 Parsing is obsolete in 2.2 (always passes /
deleted) — don't cite it in audits.

## The AA criteria that decide most audits

- **1.1.1** Non-text content: meaningful images need alt; decorative
  get `alt=""`; complex charts need long descriptions.
- **1.3.1** Info and relationships: headings hierarchy, lists as
  lists, labels programmatically associated, tables with `th`/scope.
- **1.3.5** Identify input purpose: `autocomplete` attributes on
  personal-data fields.
- **1.4.3 / 1.4.11** Contrast: 4.5:1 text (3:1 large ≥18.66px bold or
  24px); 3:1 UI components and graphical objects.
- **1.4.4 / 1.4.10** Resize to 200% and reflow at 320 CSS px without
  loss/2-D scrolling.
- **1.4.12** Text spacing: survives user-applied spacing overrides.
- **2.1.1 / 2.1.2** Keyboard + no traps.
- **2.4.1** Bypass blocks (skip link/landmarks).
- **2.4.3** Focus order meaningful; **2.4.7** focus visible.
- **2.4.6** Headings/labels descriptive; **2.4.4** link purpose in
  context (no bare "click here").
- **2.5.3** Label in name: visible label text contained in the
  accessible name (voice-control users).
- **3.1.1/3.1.2** Page and parts language set.
- **3.2.1/3.2.2** No context change on focus/input.
- **3.3.1–3.3.4** Errors identified, labels/instructions, suggestions,
  prevention for legal/financial submissions.
- **4.1.2** Name, role, value for all UI components — where custom
  widgets live or die.
- **4.1.3** Status messages announced without focus (live regions).

## Conformance claims (how to write them)

State: standard + version (WCAG 2.2), level (AA), scope (URLs/app
areas), date, evaluation method (e.g. WCAG-EM sample + tooling), and
known exceptions. Partial conformance only where third-party content
is genuinely uncontrollable. Map to EN 301 549/VPAT where contracts
need it (`eu-legal-framework.md`).
