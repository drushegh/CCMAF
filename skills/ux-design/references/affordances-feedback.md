# Affordances, feedback and navigation

How users know what they *can* do, what's *happening*, and where they *are* —
Don Norman's model plus the state/feedback and findability discipline.

## Norman's model: affordances, signifiers, mapping, feedback, constraints

- **Affordance** — what an element lets you do (a button affords pressing). In
  digital UI affordances are mostly *perceived*, so they depend on signifiers.
- **Signifier** — the perceivable cue that an affordance exists: a button looks
  raised/filled/clickable, a link is coloured/underlined, a field has a border,
  a drag handle shows grips. **If it's interactive, it must look interactive;
  if it's not, it must not.** Flat designs fail when signifiers vanish.
- **Mapping** — controls should map naturally to their effect (a volume slider
  goes up for louder; the "next" control is on the right in LTR). Spatial and
  cultural expectations matter.
- **Feedback** — every action produces a perceivable result (see below).
- **Constraints** — prevent errors by making invalid actions impossible (disable
  what can't be used, mask inputs, limit ranges) — better than catching them
  after.

## State and feedback

Every interactive element needs a full set of visible **states**, or users
can't tell what's happening:

- `default / hover / focus / active(pressed) / disabled / loading / error /
  selected`. Missing `focus` breaks keyboard use (→ `accessibility-development`);
  missing `loading`/`disabled` causes double-submits.
- **Feedback timing** (Nielsen / Doherty): **< 0.1 s** feels instant (direct
  manipulation, button press); **< 1 s** keeps flow but show a change; **> ~1 s**
  needs a spinner; **> ~10 s** needs progress and an escape. Respond visibly
  within ~400 ms or the user thinks it's broken or clicks again.
- **Optimistic UI** — for high-confidence actions, update immediately and
  reconcile in the background (with a graceful rollback on failure). Makes the
  app feel instant.

## Error prevention and recovery

- **Prevent first** (constraints): disable invalid submits, format-mask inputs,
  confirm destructive actions, separate the destructive action from the safe one.
- **When errors happen**: say *what* went wrong, *why*, and *how to fix it*, in
  plain language, **next to the thing** that's wrong — never a bare "Error" or a
  code. Preserve the user's input; never make them re-enter everything.
- **Make destructive actions recoverable** — undo beats an up-front dialog where
  possible (Gmail-style "Undo"); reserve a confirmation dialog for the truly
  irreversible.
- **Peak-End**: error recovery is a "peak" moment — a graceful recovery
  disproportionately shapes how the whole experience is remembered.

## Navigation and findability

Users constantly ask *where am I, where can I go, how do I get back*:

- **Show current location** (active nav state, breadcrumbs for deep hierarchies,
  page titles).
- **Conventional placement** (Jakob): primary nav top or left; logo top-left
  links home; account top-right. Don't hide primary navigation behind a hamburger
  on desktop without reason.
- **Findability**: provide search for large content sets; label by the user's
  words, not internal jargon; keep important destinations within a couple of
  clicks.
- **Reversibility**: always offer a clear way back/out (visible close, back,
  cancel). Don't trap users in flows.
- **Progressive disclosure**: reveal complexity only as needed (advanced
  settings behind "More options"), so the common path stays simple (Hick/Tesler).

## Microcopy

Words are UI. Buttons say what they do ("Save changes", not "OK"); empty states
explain and offer the next action; errors guide. Concise, specific,
human-voiced text removes more confusion than most visual tweaks.
