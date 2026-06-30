# The critique loop

Capturing an image is worthless unless you **look at it and judge it**. This is
the heart of the skill: convert the rendered pixels into located, fixable
findings, then iterate.

## Look first, with fresh eyes

Before checklists, react to the image as a user would for ~2 seconds:

- **Squint / blur test** — does the most important thing still stand out? If
  everything is equal weight, hierarchy has failed.
- **First fixation** — where did your eye actually land? Is it the primary
  action/message, or a logo, or noise?
- **Gut "off" feeling** — cramped, cluttered, lopsided, sterile? Name it, then
  diagnose it with the rubric below.

## The structured visual-review checklist

Go through the rendered screen against `ux-design`:

- **Hierarchy** — clear first/second/third? One prominent primary action?
- **Grouping & spacing** — does spacing match meaning (Gestalt)? Consistent
  rhythm, or random gaps? Anything cramped or floating?
- **Alignment** — is everything on a grid, or are there ragged edges?
- **Targets & reach** — are interactive elements large enough (per the
  `ux-design` / `accessibility-development` target-size rule) and, on mobile, in
  the thumb zone? Are tap targets crowded?
- **Focus state** — screenshot with a control `:focus-visible`: is the focus
  ring present and clearly visible? (A visual concern this skill owns; the
  semantics/contrast of focus → `accessibility-development`.)
- **Contrast & legibility** — is text readable on its background? (formal
  contrast → `accessibility-development`).
- **Overflow & truncation** — long names, big numbers, long translations: do
  they wrap, truncate cleanly, or break the layout?
- **State correctness** — is the captured state (empty/loading/error) actually
  designed, or a blank/raw dump?
- **Responsive** — at this viewport, does it reflow sensibly, or is it a shrunk
  desktop with tiny targets / horizontal scroll?
- **Consistency** — do like things look alike vs the rest of the product?
- **Convention** — anything that violates user expectations (Jakob)?

## Produce located findings

For each issue, write: **what** you see, **where** (which element/region),
**which** principle/heuristic it breaks, and a **concrete fix** — e.g.:

> "On mobile (390 px), the 'Pay' button is in the top-right corner (hard to
> reach one-handed — Fitts/thumb-zone) and only ~28 px tall (below the 44 px
> target). Move it to a full-width bottom bar and increase height."

Vague findings ("make it nicer") don't survive to a fix. Severity-rate them
(`ux-design` heuristics rubric) and prioritise.

## Iterate

Fix the located issues → **re-render → re-view**. Don't assume the fix worked;
the new screenshot is the proof. Repeat until the screen holds across viewports
and states. Two or three loops usually beats one big guess.

## Before/after comparison

When changing existing UI, capture **before** and **after** at the same viewport
and view them side by side — it surfaces unintended shifts (spacing creep,
broken alignment, regressed states) that you'd miss looking at "after" alone.
For ongoing protection, promote this to an automated baseline
(`visual-regression.md`).

## Honesty about a still image

A screenshot proves **layout and appearance**, not **behaviour or feel**. It
won't tell you if the hover is janky, the transition is abrupt, focus order is
wrong, or a control is laggy. Pair the visual review with interaction/e2e checks
(`testing-development`), keyboard/AT checks (`accessibility-development`), and —
for motion and games — frame sequences plus a human (`3d-and-non-web.md`).
