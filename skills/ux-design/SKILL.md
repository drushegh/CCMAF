---
name: ux-design
description: >-
  Interaction and perception reasoning for any user interface — websites,
  apps, tools, dashboards, game menus — independent of language or framework.
  The principles that predict how a real human will perceive, scan, and
  interact with a layout: the Laws of UX (Fitts, Hick, Miller, Jakob, Doherty
  threshold), Gestalt grouping and visual hierarchy (the "awareness of space"
  engine), affordances/signifiers/feedback (Norman), form and error-state UX,
  navigation/findability, and touch/pointer ergonomics (target sizes, thumb
  zones). Use whenever designing, building, or reviewing a UI and the question
  is "how will this actually behave for a user" — button placement, spacing,
  what the eye sees first, how many choices, where the primary action goes,
  whether an interaction will feel right. PROACTIVELY activate before laying
  out a screen or judging a design. Pair with ui-verification (render and look)
  and accessibility-development (WCAG).
---

# UX Design

Reasoning about **how a human will perceive and interact with an interface** —
the half of UI work that isn't the code or the colours, but the *implications*:
where the eye lands first, what the user will try to click, how long it takes
to find and hit it, how many decisions you've imposed, and what happens when
things go wrong. These principles are framework- and platform-agnostic by
design: the same laws govern a web page, a mobile app, a desktop tool, and a
game's menus.

This skill is the **predictive model**. It pairs with **`ui-verification`** —
render the thing and actually look — because principles tell you what to expect
and looking tells you what's true. Use both.

## The core discipline

Don't reason about the markup; reason about the **interaction**. For any
layout, ask and answer concretely:

- **Where does the eye go first?** (visual hierarchy / scan pattern)
- **What will the user try to do, and what's the primary action?** Is it the
  most prominent thing, and is it easy to acquire (big, near)?
- **What reads as grouped?** (Gestalt) — does the spacing match the meaning?
- **How many choices / fields am I imposing?** (Hick / Tesler) — what can go?
- **Does every interaction give feedback fast enough?** (Doherty under 400 ms)
- **What are the unhappy paths?** empty, loading, error, zero-results, overflow,
  long strings, slow network.

## Non-negotiables

1. **One clear primary action per view.** The most important thing a user can
   do is the most visually prominent; secondary actions are visibly secondary.
   A screen where everything shouts says nothing.
2. **Hierarchy is deliberate, not accidental.** Size, weight, colour/contrast,
   and position encode importance. The eye should be led, not left to wander.
3. **Group by meaning (Gestalt).** Related things are close; unrelated things
   are separated. **Whitespace is structure**, not wasted space — proximity and
   common region do more than borders.
4. **Follow convention (Jakob's Law).** Users spend most of their time on
   *other* products; match established patterns (nav placement, icons, control
   behaviour) unless you have a real reason and a better alternative.
5. **Minimise choices and fields.** Every option (Hick) and every form field
   (and inherent complexity — Tesler) has a cost. Default, group, progressively
   disclose; remove before you add.
6. **Feedback within the Doherty threshold (~400 ms).** Every action gets a
   visible response fast; if work takes longer, show optimistic UI, a spinner,
   or progress. Silence reads as "broken".
7. **Targets are reachable and hittable.** Size interactive targets to the
   platform guideline — **44×44 pt** (iOS) / **48×48 dp** (Android); the WCAG
   2.2 floor is **24×24 CSS px**, a minimum not a goal. Primary actions sit in
   the thumb zone on mobile. (Units differ per platform — don't collapse them
   to one "px" number; see `mobile-touch-ergonomics.md`.)
8. **Design the unhappy paths.** Empty, loading, error, partial, and overflow
   states are part of the design, not an afterthought — most "it looks broken"
   bugs live here.
9. **Verify by looking.** Principles predict; rendering confirms. Don't ship a
   layout you (or the agent) haven't actually viewed → `ui-verification`.

## Decision tables

| Situation | Apply |
|---|---|
| Too many top-level options | Hick's Law — group, prioritise, progressive disclosure, sensible default |
| Primary action hard to find/hit | Fitts + hierarchy — make it bigger, closer, more prominent; thumb zone on mobile |
| "It feels cluttered / cramped" | Gestalt + whitespace — increase spacing between groups, align to a grid, cut elements |
| Users miss a key element | Von Restorff (make it distinct) + hierarchy + position (above the fold / first fixation) |
| Form abandoned | reduce fields, group logically, inline validation, clear errors, smart defaults |
| Action feels unresponsive | feedback under 400 ms, optimistic UI, skeletons/spinners, disable+label on submit |
| Custom control confuses users | Jakob's Law — revert to the conventional pattern |

## High-frequency pitfalls

- **No clear hierarchy** — every element the same weight; the user has to read
  everything to find anything.
- **Spacing that contradicts meaning** — equal gaps between related and
  unrelated items, so groups don't read as groups.
- **Too many choices / fields** presented at once instead of staged.
- **Invisible state** — no hover/focus/active/disabled/loading; the user can't
  tell what's interactive or what's happening.
- **Reinventing conventions** — a clever custom date picker / nav that users
  have to learn from scratch.
- **Centre-of-attention blindness** — primary action buried below the fold or
  off in a corner; destructive action right next to the safe one.
- **Designing only the happy path** — no empty/error/long-content states.
- **Tiny or crowded touch targets**; primary actions in the hard-to-reach
  top corners on mobile.
- **Decoration over communication** — aesthetic that fights legibility,
  contrast, or the scan path.

## Workflow for designing / reviewing a screen

1. State the screen's **one job** and the user's primary task.
2. Establish **hierarchy**: what's first, second, third; make the primary action
   prominent and easy to acquire.
3. **Group** by meaning with spacing/alignment (Gestalt); cut what doesn't
   serve the job (Hick/Tesler).
4. Specify **states and feedback** for every interaction (hover/focus/active/
   disabled/loading/error) within the response-time budget.
5. Specify the **unhappy paths** (empty/error/overflow/zero-results).
6. Check **reachability/target sizes** for touch and pointer; check convention
   (Jakob) and accessibility (`accessibility-development`).
7. **Render and look** (`ui-verification`) at real viewports; critique against
   this rubric; iterate.

## Reference index

Load on demand:

- `references/interaction-laws.md` — Fitts, Hick, Miller, Jakob, Doherty, Tesler, Postel, and the key cognitive biases/effects
- `references/gestalt-and-layout.md` — Gestalt grouping, visual hierarchy, scan patterns, whitespace, alignment/grid
- `references/affordances-feedback.md` — Norman's model, states, response-time thresholds, error prevention/recovery, navigation/findability
- `references/forms-and-input.md` — form design, validation, error messaging, defaults, the cost of a field
- `references/mobile-touch-ergonomics.md` — target sizes, thumb zones, reachability, gestures, responsive density
- `references/heuristics-review.md` — Nielsen's 10 heuristics as a review method, with a severity rubric

## Boundaries

- **The visual/CSS execution** (design tokens, colour systems, Tailwind, making
  it look distinctive) → `frontend-development`. This skill decides *what the
  layout should do*; that one styles it.
- **Accessibility / WCAG / ARIA / screen readers / contrast ratios** →
  `accessibility-development` (overlaps on target size, focus, and contrast —
  treat a11y as a hard constraint on every UX decision).
- **Actually rendering and critiquing the result** → `ui-verification`.
- **Game *feel*** (input responsiveness, physics, juice) → `game-feel`; this
  skill covers a game's 2D UI/menus, not its moment-to-moment control.
- **Framework specifics** (React, SwiftUI, Compose, Power Apps) → the relevant
  platform skill; the principles here apply across all of them.
