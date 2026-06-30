# Accessibility Testing and Tooling

Automated tooling finds roughly 30–50% of WCAG issues (axe's own
positioning). A credible conformance claim = automated sweep + manual
keyboard pass + screen reader pass + judgment on content quality.

## Automated layer

- **axe-core** — the de facto rules engine. In CI via
  `@axe-core/playwright`, `jest-axe`/`vitest-axe` for components,
  browser extension for ad-hoc checks. Zero false-positive philosophy
  — it under-reports rather than over-reports; treat a clean axe run
  as "no machine-detectable issues", nothing more.
- **Playwright a11y integration**:

```javascript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('dashboard has no detectable a11y violations', async ({ page }) => {
  await page.goto('/dashboard');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .exclude('#third-party-widget')
    .analyze();
  expect(results.violations).toEqual([]);
});
```

  Also test states, not just pages: open the modal, expand the menu,
  trigger the error summary, then scan. Playwright can additionally
  assert focus (`toBeFocused()`), keyboard journeys
  (`page.keyboard.press('Tab')` sequences) and the accessibility tree
  snapshot.
- **Lighthouse** a11y category for quick triage (it embeds axe);
  **pa11y/pa11y-ci** for URL-list sweeps; **eslint-plugin-jsx-a11y**
  for React static lint.
- Audit-at-scale discipline (from the AccessLint reference skills):
  scope explicitly; group findings by rule + component family rather
  than listing every instance; prefer live-DOM audits over source
  reading; >50 violations in one sweep → stop and re-scope.

## Manual keyboard pass (every release)

1. Unplug the mouse. Tab through the full journey.
2. Verify: visible focus everywhere; order matches reading order; no
   traps; skip link works; sticky chrome never obscures focus
   (2.4.11); all functionality reachable (menus, tooltips, drag
   alternatives 2.5.7).
3. Esc closes overlays and returns focus; Enter/Space activate
   consistently; arrow keys work inside composite widgets per APG.

## Screen reader pass

| SR | Pair with | Notes |
|----|-----------|-------|
| **NVDA** (free) | Chrome/Firefox, Windows | Primary test target in most enterprise accessibility work |
| **JAWS** | Chrome/Edge, Windows | Where the client base uses it |
| **VoiceOver** | Safari, macOS/iOS | The mobile Safari pass matters for public services |
| **TalkBack** | Chrome, Android | Mobile apps/web |

Test script: page title and landmarks announced; headings outline
sensible (H key navigation); forms — labels, groups, errors announced;
dynamic updates announced (live regions); custom widgets speak
name/role/state and respond to the APG keyboard model; tables navigate
with header context.

## Beyond functional checks

- **Zoom/reflow**: 200% zoom and 320 px reflow (responsive mode) — no
  loss, no 2-D scrolling (1.4.4/1.4.10); text-spacing bookmarklet for
  1.4.12.
- **Contrast**: tooling (axe/devtools) catches text; manually check
  UI components, charts, focus indicators (1.4.11) and text over
  imagery.
- **Reduced motion**: `prefers-reduced-motion` honoured; nothing
  flashes >3/s (2.3.1).
- **Cognitive review**: plain language, consistent help placement
  (3.2.6), clear error recovery — no tool checks this.

## CI wiring

Component-level axe tests on PRs (fast, scoped), journey-level
Playwright + axe on main, full manual pass per release/major UI
change, and a periodic audit cycle (`audit-checklist.md`) feeding the
accessibility statement (`eu-legal-framework.md`). Pipeline mechanics
→ `devops-development`.
