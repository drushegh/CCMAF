# The Review Workflow

A repeatable process beats ad-hoc scanning. The order matters: design
problems found *after* you've left forty line comments mean forty wasted
comments.

## 1. Gather context before reading code

- Read the change **description** and the linked ticket/issue. What is
  the author trying to achieve, and why now?
- Establish the **blast radius**: which systems, callers, data and users
  does this touch? A three-line change to an auth path deserves more
  scrutiny than three hundred lines of new isolated code.
- If there is no usable description, that is the first finding — ask for
  one (`author-side.md`). You cannot review intent you can't see.

## 2. Broad pass — design first

Before any line-level nitpicking, answer the big questions:

- Does this change **belong here**? Should it be in a library, a
  different layer, or not built at all yet?
- Is the **overall approach** sound, and does it integrate with the rest
  of the system?
- Is this a good time to add it, or is it speculative
  (`what-to-look-for.md` — over-engineering)?

If the approach is wrong, **say so now**, kindly and with reasoning, and
hold the detailed pass. Re-architecting after you've micro-reviewed the
old approach wastes everyone's time.

## 3. Detailed passes — every assigned line, in context

- Look at **every line** you were asked to review. You may scan
  generated files, vendored code or large data blobs, but never skim a
  human-written function and assume it's fine.
- View **whole files**, not just the diff hunks. The classic miss: four
  added lines look fine, but in the full file they sit inside a 50-line
  method that now needs breaking up. Tools show you a keyhole; open the
  door.
- Think like a **user** (end-user and the next developer to call this
  code) and actively look for edge cases, failure paths and the defect
  classes in `defect-hunting.md`.
- If you can't understand a piece, that is a finding — ask for
  clarification rather than guessing or waving it through.

## 4. Verify behaviour where reading isn't enough

Mostly you trust that the author tested it, but pull and run the change
(or ask for a demo) when:

- it has **user-facing/UI** impact you can't judge from code;
- there is **concurrency** — races and deadlocks rarely show up by
  reading, and often by running either; reason through them explicitly.

## 5. Speed and cadence

- **Respond within ~one business day.** Fast review is a team
  multiplier; slow review blocks a person and pushes them toward huge
  batched changes. If you can't do a full review now, an early
  high-level reply ("approach looks right, detailed pass this
  afternoon") keeps things moving.
- **Small changes review fast and well.** Empirically, defect-finding
  drops sharply once a change is large or a sitting exceeds ~an hour —
  another reason to push back on mega-changes (`author-side.md`).
- Prefer **approve-with-comments** (trusting the author to address nits)
  over another full round-trip, when nothing blocking remains.

## 6. When you're one of several reviewers

- It's fine to review only certain files or only one aspect (security,
  design, a subsystem). **Say which parts you reviewed** in a comment so
  coverage is clear.
- Don't assume "someone else will catch it." Confirm the qualified
  reviewer exists for specialised concerns (security, concurrency,
  privacy, accessibility, i18n) rather than each reviewer assuming
  another has it.

## 7. Reach a decision

Close every review with an explicit outcome and a one-line summary of
why (`severity-and-prioritisation.md`): approve, approve-with-nits, or
request changes with a concrete path forward. Re-review promptly when
the author responds — the cadence rule applies to follow-ups too.
