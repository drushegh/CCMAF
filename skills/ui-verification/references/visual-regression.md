# Visual regression

Manual look-and-critique catches issues *now*; visual regression stops UI you've
already approved from silently breaking *later*. It captures a baseline image and
fails the build when a future render differs beyond a threshold.

## Playwright `toHaveScreenshot`

The built-in option — no extra service. First run writes the baseline; later
runs compare and produce a diff on mismatch.

```javascript
import { test, expect } from '@playwright/test';

test('checkout page', async ({ page }) => {
  await page.goto('/checkout');
  await expect(page).toHaveScreenshot('checkout.png', {
    fullPage: true,
    animations: 'disabled',
    maxDiffPixelRatio: 0.002,  // tiny tolerance for sub-pixel noise — keep it
                               // small: a % of a full page is a large area and
                               // can hide a missing component. Prefer masking.
    mask: [page.locator('[data-dynamic]')], // hide volatile regions
  });
});
```

Key options: `maxDiffPixels` / `maxDiffPixelRatio` (allowed difference),
`threshold` (per-pixel colour sensitivity), `animations: 'disabled'`, and
`mask` (paint over dynamic regions). `expect(locator).toHaveScreenshot()` does a
tight component-level baseline.

## Flakiness is the enemy — control the environment

Rendering varies by OS, browser version, fonts and GPU/anti-aliasing. A baseline
made on your machine will diff endlessly against CI. Rules:

- **Generate and compare baselines in the same environment** — pin a container
  image / the Playwright Docker image and run baselines there, commit those.
  Never bless a baseline taken on a dev laptop for a Linux CI.
- **Disable animations** and wait for fonts/content (`render-and-capture.md`).
- **Pin font rendering** — bundle/self-host the exact fonts (don't rely on
  system fonts that differ across machines); font substitution and hinting
  differences are a top cause of cross-environment diffs.
- **Mask the dynamic** — timestamps, avatars, ads, random IDs, anything
  non-deterministic.
- **Allow a small tolerance** (`maxDiffPixelRatio`) for sub-pixel noise, but not
  so much it hides real regressions.
- Treat a failed diff as **review-then-update**, not reflexive `--update-snapshots`.
  Blind baseline updates are how regressions sail through.

## Tooling choices

- **Playwright `toHaveScreenshot`** — free, in-repo, full control; you manage
  baselines and the environment. Good default.
- **Hosted (Percy, Chromatic, Applitools, Lost Pixel)** — manage baselines,
  cross-browser rendering, review UI, and "smart" diffing that ignores
  anti-aliasing/animation noise. Worth it at scale or for a design system;
  Chromatic pairs with Storybook for per-component baselines.
- **Storybook + a visual runner** — captures every component story as a baseline;
  excellent coverage of states if you maintain stories.

## What to baseline (and what not to)

- **Do**: stable, high-value surfaces — design-system components, key pages,
  each important state. Component-level baselines are less flaky than full pages.
- **Don't**: highly dynamic dashboards, or every trivial view — the maintenance
  and false-positive cost outweighs the protection. Mask or skip the volatile.

## Where it fits

Visual regression is the *automated* end of this skill; it runs in CI as part of
the suite (harness, sharding, reporting → `testing-development`). It complements,
not replaces, the build-time **render-and-view** loop (`the-critique-loop.md`):
the loop catches that the design is *wrong*; regression catches that it
*changed*.
