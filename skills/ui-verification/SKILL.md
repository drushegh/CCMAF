---
name: ui-verification
description: >-
  The render → view → critique → iterate loop for any UI you build or change:
  actually rendering the interface, capturing it as an image, looking at it,
  and critiquing it against UX and accessibility rubrics — instead of shipping
  a guess from the code. Covers headless rendering and screenshots (Playwright)
  at real viewports, the state×viewport×theme capture matrix, multimodal visual
  critique, automated visual-regression (toHaveScreenshot, Percy/Chromatic),
  and frame capture for canvas/3D. Use ALWAYS after building or editing a UI,
  and whenever the task is "does this actually look/behave right", "check the
  layout", "screenshot it", "review the design", "visual regression", or
  "responsive check". PROACTIVELY render and look before declaring UI work
  done. Pairs with ux-design (the rubric) and frontend/accessibility.
---

# UI Verification

The discipline of **rendering a UI and actually looking at it** before calling
it done — the antidote to reasoning about markup and shipping a layout no one
ever saw. Generating UI without viewing the result is the single biggest source
of "it looked fine in the code but it's broken/cramped/unusable" defects.

`ux-design` gives the *predictions* (where the eye goes, what's grouped, is the
target hittable); this skill **closes the loop** by producing the actual
rendered image, viewing it, and checking the predictions against reality. Do
not trust the mental model of a layout — render it.

## The core loop

For any UI built or changed:

1. **Render** it (headless browser / running app / canvas frame).
2. **Capture** an image — at the **real viewports** that matter (mobile +
   desktop at minimum), with web fonts loaded and animations settled.
3. **View** the image (multimodally — actually look at the screenshot, don't
   infer from code).
4. **Critique** against the `ux-design` rubric + accessibility + the
   state/viewport matrix.
5. **Fix and re-render.** Iterate until it holds. Then, for anything ongoing,
   lock a **visual-regression** baseline so it can't silently break later.

## Non-negotiables

1. **Never ship UI you (or the agent) haven't viewed.** "The code looks right"
   is not verification. Render it and look — every time.
2. **Capture at real viewports.** At minimum a phone width (~390 px) and a
   desktop width; add tablet and the project's breakpoints. Most layout and
   reachability bugs only appear at a specific width.
3. **Wait for the truth.** Let fonts load, images settle, and **disable
   animations** before capturing, or you screenshot a half-rendered or
   mid-transition frame and critique a lie.
4. **Cover the unhappy states, not just the happy one.** Empty, loading, error,
   long-content/overflow, zero-results — capture and view each (see
   `state-and-viewport-coverage.md`).
5. **Critique against a rubric, not vibes.** Use `ux-design` (hierarchy,
   grouping, Fitts/targets, feedback) + `accessibility-development` (contrast,
   focus, target size). Output located, fixable findings.
6. **Make regressions impossible to miss.** For UI that must stay stable, set a
   `toHaveScreenshot` baseline in CI so a future change that shifts pixels
   fails loudly (→ `testing-development`).
7. **Be honest about what you can't see.** Real-time feel, native gestures, and
   game control can't be fully judged from a still — capture frames/clips and
   bring a human in (see `3d-and-non-web.md`).

## Decision table

| Goal | Approach |
|---|---|
| "Does this screen look right?" (build-time) | Render + screenshot + **view it** + critique against ux-design rubric |
| Check responsive / reach | Screenshot at each viewport (mobile/tablet/desktop); view each |
| Check all states | Drive the UI into each state, screenshot the matrix (`state-and-viewport-coverage.md`) |
| Prevent silent visual breakage | Automated **visual regression** baseline (`visual-regression.md`) |
| Canvas / WebGL / game scene | Capture frame(s); for motion, a short sequence (`3d-and-non-web.md`) |
| Native mobile / desktop app | Simulator/emulator screenshot; human for true feel |

## High-frequency pitfalls

- **Shipping unviewed** — the root sin this skill exists to fix.
- **One viewport only** (usually desktop) — mobile layout/reach never checked.
- **Capturing too early** — before fonts/images/layout settle, or mid-animation
  → false findings and flaky baselines.
- **Happy-path only** — empty/error/overflow states never rendered.
- **Flaky visual-regression baselines** — captured in a different env (fonts,
  anti-aliasing, OS) than CI, so diffs are noise; teams then ignore red.
- **Diffing dynamic regions** (timestamps, avatars, ads) without masking → false
  failures.
- **Treating the screenshot as proof of behaviour** — a still shows layout, not
  interaction; pair with interaction/e2e checks (`testing-development`).
- **Critiquing from the DOM instead of the pixels** — defeats the purpose; the
  point is to *see* it.

## Workflow

1. Build/change the UI (`frontend-development` / the platform skill).
2. Render headless; **screenshot** at the target viewports, fonts loaded,
   animations off.
3. **View** each image and critique against the `ux-design` + a11y rubric;
   capture the state matrix.
4. Fix the located issues; re-render and re-view until clean.
5. For durable UI, commit a **visual-regression** baseline so future changes are
   diffed automatically in CI.
6. Record what was verified (viewports, states) so "done" is evidenced.

## Reference index

Load on demand:

- `references/render-and-capture.md` — headless rendering + screenshots (Playwright), viewports, waiting, element/full-page
- `references/the-critique-loop.md` — view-and-critique method + the structured visual-review checklist
- `references/state-and-viewport-coverage.md` — the state × viewport × theme × locale capture matrix
- `references/visual-regression.md` — automated pixel-diff (toHaveScreenshot, tools), baselines, flakiness control
- `references/3d-and-non-web.md` — canvas/WebGL/game frames, native app capture, and the honest limits

## Boundaries

- **The UX rubric** the critique applies → `ux-design`. **Contrast/focus/screen-
  reader checks** → `accessibility-development` (axe, etc.). This skill is the
  *act of rendering, viewing and checking*.
- **The styling being verified** → `frontend-development`.
- **Test infrastructure** (Playwright config, running specs in CI, the test
  pyramid) → `testing-development`; this skill owns the *visual* intent, that
  one owns the harness.
- **Game *feel* from motion** → `game-feel` (this skill captures the frames; that
  one judges the feel, with a human in the loop).
- **Browsing/automation for scraping** → `web-scraping-development` (shares the
  headless browser, different purpose).
