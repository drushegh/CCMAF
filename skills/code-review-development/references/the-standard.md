# The Standard of Code Review

The philosophy that makes every other decision in this skill fall out
cleanly. Distilled from Google's engineering practices, which remain the
clearest articulation of why review exists.

## The purpose: code health over time

The primary purpose of code review is to ensure the **overall health of
the codebase improves over time**. Every tool, rule and habit serves
that end. Two forces must be balanced:

- **Progress.** Developers must be able to ship. If a reviewer makes any
  change painful to land, people stop improving things — and the
  codebase rots from neglect.
- **Quality.** Each change must leave the system no less healthy. Most
  codebases degrade not through one bad change but through many small
  accepted compromises under time pressure.

The resolving rule:

> **Reviewers should favour approving a change once it definitely
> improves the overall code health of the system, even if it isn't
> perfect.**

This is *the* senior principle. There is no perfect code — only better
code. A change that improves maintainability, readability and
understandability should not be held for days because it isn't flawless.
Seek **continuous improvement**, not perfection.

The one hard limit: nothing justifies landing a change that *worsens*
overall code health — except a genuine, time-critical emergency (and
then with a tracked follow-up). A reviewer may also decline a
well-written change whose feature simply doesn't belong in the system.

## Mentoring

Review is one of the best teaching surfaces an organisation has — a
language feature, a framework idiom, a design principle. Always feel
free to share knowledge; it raises code health over time. But if a
comment is *educational rather than required* by the standard, mark it
as non-mandatory (a `Nit:` prefix or a non-blocking label) so the author
knows they may land without acting on it.

## Principles (how to settle "which way is right?")

- **Technical facts and data overrule opinions and personal
  preferences.** Bring evidence, not taste.
- **On style, the style guide is the absolute authority.** Any pure
  style point not in the guide is preference — keep it consistent with
  surrounding code; if there's no precedent, accept the author's choice.
- **Software design is almost never pure preference.** It rests on
  principles and should be argued on them. If the author demonstrates
  (by data or sound engineering reasoning) that several approaches are
  equally valid, defer to the author's choice.
- **Consistency as the tie-breaker.** If no other rule applies, ask for
  consistency with the existing codebase — provided that doesn't worsen
  health.

These also tell you when *you're* wrong: if the author answers your
comment with facts or solid reasoning, accept it and move on. Holding a
position on preference alone is the reviewer anti-pattern the principles
exist to stop.

## Resolving conflict

Disagreement is normal; a stalled change is the failure. Escalate the
*process*, never let it rot:

1. **Seek consensus** on the facts and these principles first.
2. If comments are going in circles, **talk** — a short call or
   face-to-face beats a 20-comment thread. Record the outcome as a
   comment so future readers see the decision.
3. If still stuck, **escalate** — team discussion, the tech lead, the
   code's maintainer, or an engineering manager. Don't let a change sit
   for weeks because two people can't agree.

## Ownership and accountability

A reviewer takes shared ownership of what they approve. Approval means
"I understand this and I'm prepared to stand behind it improving the
system." That is why "understand every line" and "never rubber-stamp"
are non-negotiable — and why an AI or agent reviewer must be explicit
about what it did and didn't verify, rather than approving to be
agreeable. The merge decision belongs to an accountable human or a
clearly-accountable agent, never to an unread "LGTM".
