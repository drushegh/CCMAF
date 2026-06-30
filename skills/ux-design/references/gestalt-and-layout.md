# Gestalt, hierarchy and the use of space

This is the engine behind "awareness of space on a page". The eye doesn't read
a layout element by element; it perceives **groups and a hierarchy** first. If
the spatial relationships contradict the meaning, the design fights the user.

## Gestalt principles (how grouping is perceived)

The mind organises visual input into wholes, mostly from spacing and alignment —
before colour or borders:

- **Proximity** — things close together are read as a group. The single most
  powerful tool: control grouping with *space*, not lines. A label belongs to
  the field it's nearest to.
- **Common region** — elements inside a shared boundary (a card, a panel) are a
  group, even if far apart.
- **Similarity** — same colour/shape/size read as related (all primary buttons
  look alike; all links look alike).
- **Closure** — the eye completes shapes; you can imply structure without
  drawing every line.
- **Continuity** — elements on a line/curve are seen as related; alignment
  creates invisible lines that guide the eye.
- **Figure/ground** — the mind separates foreground from background; use
  contrast, elevation/shadow, and overlays to say what's "on top" (modals,
  menus).

Practical test: **does the spacing match the meaning?** If related items have
the same gap as unrelated ones, increase the *within-group* closeness and the
*between-group* separation until the groups read at a glance.

## Visual hierarchy (leading the eye)

Hierarchy is how you make some things matter more. Encoded with:

- **Size & weight** — bigger/bolder = more important. The primary heading and
  primary action should win.
- **Colour & contrast** — high-contrast and accent colour draw the eye; reserve
  the accent for the one thing that matters most (ties to Von Restorff).
- **Position** — top and left (in LTR) get attention first; "above the fold"
  still matters for the first impression and primary action.
- **Whitespace** — isolating an element with space elevates it; crowding
  demotes everything.

Aim for a clear **first, second, third**. If you squint (or blur the screen),
the most important element should still pop — a quick way to test hierarchy.

## Scan patterns

People scan, they don't read. Design for the pattern the content invites:

- **F-pattern** — text-heavy pages (articles, search results): users read the
  top, then scan down the left. Front-load key words; don't hide essentials
  mid-line.
- **Z-pattern** — sparse/landing layouts: eye sweeps top-left → top-right →
  diagonally to bottom-right. Put logo/nav top, primary CTA on the Z's
  endpoints.
- **Layer-cake** — when headings/subheads are scannable, users jump heading to
  heading; make headings carry meaning.

Put the most important content and the primary action where the relevant
pattern's attention lands first, not where the layout left a gap.

## Alignment, grid and rhythm

- **Align everything to a grid.** Misalignment reads as sloppiness and slows
  scanning; a consistent grid creates the continuity the eye follows.
- **Use a spacing scale** (e.g. 4/8-px steps) so gaps are intentional and
  consistent — uneven spacing is the commonest "looks off" cause.
- **Consistent rhythm** (repeating spacing/sizing) makes a dense screen calm and
  a sparse one feel deliberate.

## Density

Match density to context: a data table or pro tool can be dense (Fitts/scan
still apply); a marketing page or onboarding should breathe. When a screen
"feels cramped", the fix is almost always **more space between groups and fewer
elements**, not smaller text. Visual styling of all this → `frontend-development`;
this reference decides the spatial structure.
