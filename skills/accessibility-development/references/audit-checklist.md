# Auditing an Existing UI — Checklist and Reporting

For agents asked to "review/audit this UI for accessibility". Method
distilled from AccessLint's audit skills + cskiro's severity rubric
(both in Reference skills) + WCAG-EM sampling logic.

## 0. Scope first

State explicitly: which pages/components/journeys, which standard
(default WCAG 2.2 AA), rendered DOM or source, which states (logged
in/out, error states, modals). No-arguments audits of whole codebases
are rarely actionable — narrow before starting. Sample like WCAG-EM:
common pages + key journeys + distinct templates + randomised extras.

## 1. Automated sweep

axe-core against the **rendered DOM** (not source) per page/state;
compact output; record rule IDs. Then de-duplicate: group by rule ×
component family — one root cause, one finding, instance count noted.

## 2. Structural review

- Landmarks (`main`, `nav`, `header`, `footer`) present and unique;
  skip link.
- Heading outline: one `h1`, no skipped levels used for styling.
- Reading order = DOM order = visual order.
- Page `title` and `lang`; iframe titles.
- Images: meaningful vs decorative alt decisions sensible.

## 3. Keyboard pass

Full journey keyboard-only (see `testing-tooling.md` script): focus
visible/ordered/never trapped/never obscured; all functionality
reachable; overlays trap+restore; drag operations have alternatives;
target sizes ≥24px.

## 4. Forms and errors

Labels programmatic; groups fieldset/legend; errors textual,
associated, focus-managed; autocomplete attributes; no placeholder-
as-label; redundant entry and authentication checks (3.3.7/3.3.8).

## 5. Custom widgets

For each non-native widget: name/role/value in the accessibility
tree; APG keyboard model; state changes announced. Modals, comboboxes
and tabs are the usual failures.

## 6. Content and visual

Contrast (text 4.5:1, UI/graphics 3:1) incl. states and charts;
colour-only encoding; zoom 200%/reflow 320px; text spacing; motion
(pause/reduce); link text out of context; consistent help (3.2.6).

## 7. Screen reader spot-pass

NVDA (or platform SR) over the highest-risk journeys found above —
confirms real-world impact and catches announcement-quality issues
automation can't.

## Severity rubric (impact × likelihood)

| | Encountered by most users of the journey | Encountered sometimes | Edge case |
|---|---|---|---|
| **Blocks task completion for an AT/keyboard user** | Critical | Critical | Serious |
| **Major degradation (workaround exists, painful)** | Serious | Moderate | Moderate |
| **Friction/annoyance** | Moderate | Minor | Minor |

Critical examples: unlabelled primary action, keyboard trap in
checkout, modal focus loss, form errors invisible to SR. Many minor
violations of one rule often = one moderate root-cause fix.

## Report format

```
# Accessibility audit — <scope>
Standard: WCAG 2.2 AA | Date | Method (tools + manual passes)

## Summary
- N critical / M serious / K moderate / J minor (deduplicated patterns)
- Top 3 most impactful patterns, one line each

## Findings (by severity, then pattern)
### <Pattern title> — <Severity>
- SC: <e.g. 4.1.2 Name, Role, Value> | Instances: <n> | Where: <components/pages>
- Issue: <what happens to whom>
- Evidence: <selector/screenshot/announcement transcript>
- Fix: <concrete remediation, code-level where possible>

## Out of automated reach (manual judgement applied)
<content clarity, announcement quality, cognitive load notes>

## Remediation plan
<ordered by severity & shared root cause; quick wins flagged>
```

Map to EN 301 549/VPAT and feed the accessibility statement where the
engagement is statutory (`eu-legal-framework.md`). Never inflate: a
clean automated sweep plus partial manual pass is reported as exactly
that.
