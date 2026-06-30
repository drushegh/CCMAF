# Giving Feedback

A correct finding delivered badly gets ignored or breeds resentment;
the same finding delivered well gets fixed and teaches. Comment craft is
half the skill.

## Make every comment specific, reasoned and actionable

A good comment has three parts:

1. **What** — point at the exact line/behaviour, not a vague "this
   section".
2. **Why** — the reason it matters (the bug it causes, the reader it
   confuses, the principle it violates). "Because I'd do it differently"
   is not a why.
3. **What to do** — a concrete suggestion, a code proposal, or a genuine
   question. Use the platform's *suggested change* feature for small
   concrete edits so the author can apply them in one click.

Weak: "This is confusing." Strong: "This nested ternary is hard to
follow — pulling the status calculation into a named helper would make
the branch obvious. Non-blocking."

## Ask, don't just command

Phrasing a point as a question ("What happens here if `items` is
empty?") invites the author to think and often surfaces context you
lacked — they may have a good reason. It also lands as collaboration
rather than decree. Reserve flat assertions for clear blockers.

## Conventional Comments — label intent and weight

Prefixing each comment with a label and optional decoration removes
ambiguity about how seriously to take it. Format:

```
label [decoration]: subject
```

Labels: **praise**, **nitpick** (trivial, always non-blocking),
**suggestion** (propose an improvement, with reasoning),
**issue** (a problem — pair it with a suggested fix),
**question** (you need clarification), **thought** (a non-blocking
idea), **todo** (small necessary change), **chore** (a task needed
before acceptance, e.g. "add a changelog entry").

Decorations: **non-blocking** (need not be resolved to merge),
**blocking** (must be resolved), **if-minor** (resolve at your
discretion if small).

Examples:

```
praise: nice use of a parameterised query here — injection-safe by construction.
issue (blocking): this path returns before releasing the lock — leak under errors.
suggestion (non-blocking): extracting this into a named function would read better.
question: is a negative quantity reachable here, and is it valid if so?
nitpick (non-blocking): spelling — "recieve" -> "receive".
```

Even without tooling, the discipline of "label + weight + why" makes a
review instantly readable.

## Tone and psychological safety

- **Review the code, not the person.** "This function does X" not "you
  always do X". Avoid "you", "obviously", "just", "why didn't you" — and
  sarcasm entirely.
- **Praise honestly and specifically.** Reviews skew toward the
  negative; naming what's done well is high-value mentoring and keeps
  the relationship one of shared improvement.
- **Stay humble.** You miss context the author has. "I might be missing
  something, but…" costs nothing and is often true.
- **No pile-on.** If a co-reviewer already raised it, you don't need to
  +1 the criticism.

## Open with a summary

Lead the review with one or two sentences: the overall impression and
your decision, then the comments. "Solid change and good tests — one
blocking issue on the error path, a couple of non-blocking nits, then
good to go." The author should know the verdict before the line notes.

## Know when to stop typing

If a thread passes ~3 back-and-forths, you're past the point where text
helps — move to a short call or pairing and **record the conclusion as a
comment** for future readers (`the-standard.md`). Long argumentative
threads cost more than they resolve.

## For an AI/agent reviewer specifically

State what you actually checked and what you didn't; label confidence;
flag "I can't verify this without running it". Resist the pull to be
agreeable — a wrong "looks good" is worse than an honest "I'm not sure
about the concurrency here, a human should confirm". Calibration and
candour are the whole value; an agent that rubber-stamps is negative
value.
