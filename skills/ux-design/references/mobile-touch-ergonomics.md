# Touch and pointer ergonomics

Physical reality constrains interaction: fingers are blunt, thumbs have reach
limits, and pointers have travel cost. Designing for the body is not optional
on touch devices.

## Target size

A finger pad is ~16–20 mm; a target must be large enough to hit reliably:

- **WCAG 2.2 §2.5.8 Target Size (Minimum), Level AA** — interactive targets at
  least **24×24 CSS px**, *or* enough spacing that a 24-px circle doesn't
  overlap a neighbour. This is a **floor**, not a goal.
- **Platform best practice** — **iOS HIG: 44×44 pt**; **Android Material:
  48×48 dp**. Design to these, not the 24-px minimum.
- **Spacing matters as much as size** — adjacent small targets cause mis-taps;
  give space between tappable items (and between a destructive and a safe
  action especially).

When a control is visually small (an icon), expand its **hit area** beyond the
visible glyph (padding / pseudo-element) so the tappable region meets the size
even if the icon doesn't.

## Thumb zones and reachability

On a phone held one-handed, the screen has reach zones:

- **Easy** (natural thumb arc, lower-centre) → put primary, frequent actions
  here: main CTAs, bottom nav, send/submit.
- **Stretch** (upper area, far corners) → secondary/infrequent items; avoid
  primary actions in the **top corners** (hardest to reach one-handed).
- Bottom navigation and bottom sheets exist because the bottom is reachable;
  top app bars are for status and low-frequency actions.
- Account for larger phones (more of the top is unreachable) and left/right-hand
  variation.

Fitts's Law applies on touch too: bigger and within the easy zone = faster and
fewer errors.

## Gestures

- **Discoverability is the weakness** — hidden gestures (swipe to delete,
  long-press menus) have no signifier; provide a visible alternative for any
  important action, and reserve gestures as accelerators, not the only path.
- **Use platform-standard gestures** (Jakob): swipe-back, pull-to-refresh,
  pinch-zoom behave as users expect; don't override them.
- **Avoid conflicts** with system/browser gestures (edge swipes, scroll); don't
  hijack scroll.

## Pointer (desktop) ergonomics

- **Edges and corners are "infinite" targets** (the pointer stops there) — cheap
  to hit; good for global menus/docks.
- **Hover reveals** are fine on pointer devices but **must not be the only way**
  to reach something (no hover on touch); always provide a tap/click path.
- **Pointer travel** — keep contextual actions near their object; don't make the
  user cross the screen for a related control.

## Responsive density

- Re-flow for the viewport; don't just shrink a desktop layout (tiny targets,
  unreadable text). Single column, larger targets, bottom-reachable actions on
  small screens.
- Respect safe areas (notches, home indicators, rounded corners) and OS chrome.
- Test at real breakpoints by **rendering at those viewports** and looking
  (`ui-verification`) — emulated sizes catch most layout/reach problems.

Target size and focus also serve accessibility — treat
`accessibility-development` as the hard floor and these as the usability goal
above it.
