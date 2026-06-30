# HIG and Accessibility

Apple reviews against these; users feel them. Treat this as the quality
floor, not polish.

## Layout

- Touch targets ≥ **44pt** (both dimensions, including tap padding).
- Content inside safe areas — `.ignoresSafeArea()` only for backgrounds.
- 8pt spacing grid (8/16/24/32/40/48).
- Primary actions in the thumb zone (bottom half); destructive actions
  away from habitual tap positions.
- Flexible layouts from iPhone SE (375pt) to Pro Max (430pt) and
  landscape where supported — no hardcoded widths.

## Typography and Dynamic Type

- System text styles (`.largeTitle` … `.caption2`) — they scale free.
  UIKit: `preferredFont(forTextStyle:)` +
  `adjustsFontForContentSizeCategory = true`.
- Custom fonts must scale: `Font.custom(_:size:relativeTo:)` /
  `UIFontMetrics`.
- Support up through accessibility sizes — layouts reflow (stack
  horizontally→vertically via `@Environment(\.dynamicTypeSize)`), text
  never truncates the meaning away. Minimum 11pt.
- Hierarchy via weight and size, not colour alone; SF Symbols scale with
  text (`.imageScale`, symbol text styles).

## Colour and Dark Mode

- Semantic system colours: `.primary`/`.secondary` text,
  `Color(.systemBackground)` hierarchy
  (`systemBackground → secondary → tertiary` for layering).
- Custom colours: asset catalog with Any/Dark variants (and
  high-contrast variants for key surfaces) — dark mode is designed, not
  inverted.
- Contrast ≥ 4.5:1 normal text, 3:1 large text and UI components.
- One accent colour for interactive elements — interactivity stays
  recognisable.
- **Never colour-only information** — pair with icons, text, or shape.

## VoiceOver and Assistive Tech

- `.accessibilityLabel()` on every icon-only control; `.accessibilityHint`
  where the result isn't obvious; `.accessibilityValue` for adjustable
  state.
- Group related elements (`.accessibilityElement(children: .combine)`);
  order with `.accessibilitySortPriority` when reading order ≠ visual
  order.
- Hide decorative images (`.accessibilityHidden(true)`).
- Honour system preferences: Reduce Motion
  (`@Environment(\.accessibilityReduceMotion)` disables decorative
  animation), Bold Text, Increase Contrast.
- Every gesture has an alternative path (swipe actions also in a context
  menu; drag also via buttons). Works with Switch Control and Full
  Keyboard Access.

## Gestures

Standard gestures with standard meanings; custom gestures are
discoverable extras, never the only path. **System gestures are sacred**:
edge back-swipe, home indicator, notification/control-centre pulls.

## Navigation Conventions

Tab bar for 3–5 sections, visible throughout drill-down (no hiding on
push). No hamburger/drawer menus. Large titles on primary screens,
inline on detail. Modality is for focused, completable tasks — not a
navigation substitute.

## Permissions and Privacy UX

- Request **in context**: the camera prompt appears when the user taps
  the camera feature, never in onboarding.
- Pre-permission explanation (your own UI) before the one-shot system
  dialog; usage-description strings in Info.plist are specific and
  honest.
- ATT (tracking) prompt only when there's real value to explain; denial
  fully respected — features don't degrade out of spite (review
  rejection territory).
- Sign in with Apple offered alongside third-party logins (required when
  you offer social login); core features usable without an account where
  feasible.
- One-shot location: `LocationButton`/`CLLocationButton` over a
  standing permission.

## Pre-Ship Checklist

- [ ] 44pt targets; safe areas; 8pt grid; SE→Pro Max + landscape
- [ ] Dynamic Type to accessibility sizes; no truncated meaning
- [ ] Dark mode intentional; contrast passes; no colour-only info
- [ ] VoiceOver labels/order; Reduce Motion/Bold Text honoured
- [ ] Gestures have alternatives; system gestures untouched
- [ ] Tab/navigation conventions; state preserved across tabs
- [ ] Permissions contextual with explanations; ATT denial respected
