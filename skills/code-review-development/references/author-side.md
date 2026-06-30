# The Author Side — Being Reviewed Well

Review is a two-party act. Half the speed and quality comes from how the
change is *offered*. A reviewer-skill is incomplete without this, and an
agent that raises changes for human review must do all of it.

## Make the change small and focused

- **One purpose per change.** A reviewer can deeply review a few hundred
  lines; they cannot meaningfully review thousands. Defect-finding
  collapses as size grows. Split by concern, stack dependent changes, or
  land behind a flag.
- **Separate refactor from behaviour change.** Never mix a large
  reformat or rename with a functional change — it hides the real diff
  and complicates rollback. Send the mechanical change first, the
  behavioural change second.
- **Keep it coherent.** Everything in the change should serve its one
  stated purpose. "While I was here" edits belong elsewhere.

## Write a description the reviewer can use

A good change description states:

- **What** changed, in one line a future reader (or `git log`
  archaeologist) will understand.
- **Why** — the problem, ticket, or motivation. This is the part code
  can never recover later.
- **How to test / what was tested**, and any **risk or rollout** note
  (flag, migration order, blast radius).

"Fix bug" is not a description. The why is the single most valuable
thing you leave behind.

## Self-review before you request review

Read your own diff, line by line, as if it were someone else's, before
asking a human. You will catch the leftover debug print, the commented
code, the unhandled case, the missing test — cheaply, and without
spending a reviewer's attention. **Arrive green:** lint, format, type
check and tests passing in CI, so review is about judgement not mechanics
(`automation-tooling-and-ai.md`).

## Respond to review well

- **Address every comment** — fix it, or reply why not. Don't silently
  resolve threads the reviewer opened; let them confirm.
- **Don't take it personally.** Comments are about the code. Assume good
  intent; the reviewer is trying to improve the system with you.
- **Push back with facts, not feelings.** If you think the reviewer is
  wrong, say so with data or a principle (`the-standard.md`) — the
  principles cut both ways, and a reviewer holding a preference should
  yield to a demonstrated-equally-valid choice. If you're shown to be
  wrong, concede quickly.
- **Re-request review clearly** once you've responded, and note what
  changed since last pass so the reviewer isn't re-reading everything.

## Don't let it rot

If you and the reviewer are stuck, don't disappear and don't dig in —
escalate the process (a quick call, then a tech lead) so the change
moves. A change that sits for a week helps no one
(`the-standard.md` — resolving conflict).

## For an agent author

The same rules, made explicit: produce a focused diff, write the
what/why/test description yourself, run the full check suite and report
the results, self-review and list what you verified and what you
couldn't, and surface risks plainly. The point of a clean,
well-described, green change is to spend the reviewer's scarce attention
on the things only judgement can catch.
