# Forms and input

Forms are where users do the work and where they abandon. Every field is a cost
(Hick/Tesler); the craft is asking the least, in the clearest way, with the
gentlest possible error handling.

## Reduce the ask

- **Cut fields ruthlessly.** Do you need it *now*? Can you infer it (derive
  city from postcode, country from locale), default it, or ask later? The
  shortest form that does the job wins.
- **Smart defaults** for the common case; pre-fill what you know. A good default
  is complexity the product absorbs, not the user (Tesler).
- **Stage long forms** (steps with progress — Goal-Gradient) rather than one
  intimidating wall; group related fields (Gestalt) under clear headings.

## Layout and labelling

- **Labels always visible** — top-aligned labels scan fastest and wrap well on
  mobile. **Placeholder text is not a label** (it vanishes on input, hurts
  recall and accessibility).
- **One column.** Multi-column forms break the vertical scan and cause skipped
  fields.
- **Match field size to expected input** (a postcode field shouldn't be as wide
  as an address); it signals the expected length.
- **Right input type** — correct mobile keyboard (`email`, `tel`, numeric),
  native pickers for dates, autocomplete attributes; let the platform help.

## Validation and errors

- **Validate at the right time** — inline, *after* the user leaves a field
  (on blur), not on every keystroke (which nags) and not only on submit (which
  surprises). Confirm success too (a green tick) for fields with rules.
- **Error messages**: specific, adjacent, and actionable — "Enter a date in the
  future", not "Invalid". Mark the field, keep the message next to it, and
  **never clear the user's input** on error.
- **Forgive formatting** (Postel) — accept spaces in card/phone numbers, any
  reasonable date format, trailing spaces; normalise silently instead of
  rejecting.
- **Summarise on submit** if multiple errors: list them, link each to its
  field, and move focus to the first.

## Buttons and submission

- **Primary action is obvious and singular** — "Create account" styled as the
  one primary button; secondary/cancel visibly lighter. Label the action, not
  "Submit/OK".
- **On submit**: disable the button and show progress/loading so users don't
  double-submit; re-enable on error with the message shown. Keep the action in
  the thumb zone on mobile.
- **Don't gate prematurely** — let users attempt submit and show all issues,
  rather than disabling submit with no explanation of why.

## Accessibility and touch

Every field needs a programmatically-associated label, visible focus, and
adequate target size (→ `mobile-touch-ergonomics.md`,
`accessibility-development`). Forms are the highest-stakes place for a11y —
get keyboard order, labels, and error association right.

## Empty, loading and edge states

Design the form's non-ideal states: disabled until prerequisites met (with a
reason), loading on async validation (e.g. "checking availability…"), success
confirmation, and what a returning user with saved data sees. A field that
silently does nothing on a slow network is a common abandonment cause —
verify it by actually exercising it (`ui-verification`).
