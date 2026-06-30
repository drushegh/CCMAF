# Severity and Prioritisation

Findings are not equal. A review that presents a security hole and a
variable-name preference with the same weight has failed the author. Rank
everything, and make blocking status unambiguous.

## The severity rubric

| Severity | Meaning | Blocks merge? |
|----------|---------|---------------|
| **Blocker** | Correctness/security/data-loss bug, or a design flaw that will harm the system | Yes |
| **Major** | Significant issue — missing tests for risky logic, real performance/maintainability problem | Usually — agree a path |
| **Minor** | Worth fixing but not important; small clarity/structure improvement | No — author's call |
| **Nit** | Pure polish/preference | No — never block |
| **Question** | You don't understand something / need intent confirmed | Until answered, maybe |
| **Praise** | Something done well | No — include them |

Map this onto whatever the platform offers (request-changes vs comment
vs approve). The rubric is the substance; the button is the mechanism.

## The approval decision

Apply the Standard (`the-standard.md`): **approve once the change
definitely improves the codebase's health, even if imperfect.** In
practice:

- **Approve** — no blockers/majors; remaining points are minors/nits you
  trust the author to weigh.
- **Approve with comments (LGTM with comments)** — you're confident it'll
  land well once the author addresses small things; you don't need
  another round. Prefer this over a needless extra cycle.
- **Request changes** — there's a blocker or an unresolved major. Say
  *exactly* what must change and why; give a concrete path, not just
  "this is wrong".

Never approve code you don't understand, and never block a net-positive
change solely over preference.

## Blocking vs non-blocking — be explicit

The single most useful habit: every comment tells the author whether it
must be resolved. Make it unambiguous — a `Nit:`/`Optional:` prefix, or
a Conventional Comments decoration like non-blocking
(`giving-feedback.md`). Default the small stuff to non-blocking. If you
catch yourself unsure whether a comment blocks, it probably doesn't —
mark it non-blocking and move on.

## Keep scope tight

- **Don't gate on out-of-scope cleanup.** If you spot pre-existing debt
  nearby, note it and suggest a follow-up ticket/TODO; don't hold this
  change hostage to fixing it. Scope creep ("while you're here…") is an
  anti-pattern.
- **Cap the nits.** A storm of trivial comments drowns the important
  ones and demoralises. Pick the few that matter; consider "a few
  naming nits throughout, non-blocking" as one comment rather than
  twenty.

## Order your feedback

Lead with the headline: a one-line summary and your decision, then
blockers, then majors, then the rest. The author should know within the
first sentence whether they have a real problem or a green light with
polish. Detail on comment craft → `giving-feedback.md`.

## The emergency exception

In a genuine, time-critical emergency, a change that doesn't improve (or
even slightly worsens) health may be approved to stop the bleeding — but
only with a tracked follow-up to put it right, and only for true
emergencies, not schedule pressure. This is the *one* carve-out from the
Standard; don't let it become routine.
