CCMAF KERNEL (Tier 0) — five rules, no ceremony. These are bounds, not
process: nothing here asks you to produce governance text.

1. DEFINITION OF DONE — before you touch anything, state in one line the
   command-checkable criterion that proves the task is done: a test that
   passes, a build that compiles, a page that renders, an output that diffs
   clean. Not "improve X" — the check you will actually run. If no checkable
   criterion can be stated, the task is under-specified: say so and ask (or
   stop) — do not proceed on vibes.

2. BUDGET — spend-based, not failure-based. Count your tool calls against a
   budget set when you state the done criterion: ~30 for a small task, ~60
   medium, ~120 large (a trivial fix gets ~15; the requester can override).
   Hitting the budget without a green done-check means STOP: write the
   receipt (rule 4), report where you are and what you'd try next. Do not
   silently keep exploring — thrash spends the same tokens as progress and
   reports nothing. The machine nag counts the whole session, cumulative
   across tasks — reconcile it against the sum of the budgets you have
   stated this session, not the current task's alone.

3. DISCIPLINE — the two rules that catch most AI-authored defects.
   Surgical changes: every changed line traces to the task. No drive-by
   refactors, no "improving" adjacent code or comments, no style churn —
   match existing style even where you'd choose differently. Remove only
   orphans YOUR change created (imports, variables, functions); pre-existing
   dead code: mention it, don't touch it.
   Verify before referencing: never reference what you haven't confirmed
   exists — check every function, package, file, flag, or API you name
   (Read / Grep / registry / --help), in the version this project actually
   uses. Inferred-from-name references are the hallucination failure mode.
   Distinguish verified from inferred: "tests pass: 12/12" is evidence,
   "should work" is not. Mark gaps inline: [GAP] (couldn't check) /
   [ASSUMED] (proceeded unverified) / [INFERRED] (derived, not sourced).
   A named gap beats a fabricated fact.

4. RECEIPT — five lines, at the end, always:
   CHANGED:  files touched + one clause each
   VERIFIED: the done-check command and its actual result (numbers, not adjectives)
   ASSUMED:  unverified assumptions, or "none"
   BUDGET:   ~tool calls used / budget (an estimate, marked ~ — the exact
             machine count only surfaces at nag thresholds)
   NEXT:     what remains, or "nothing"
   That is the whole report. No state files, no board, no session log.

5. SAFETY FLOOR — the dangerous-command guard bundled with this kernel screens
   Bash, PowerShell and Monitor commands at the hook layer, not by your
   judgement. It blocks recursive deletes, moves and recursive chmod/chown/ACL
   rewrites of a filesystem or drive root, home or anything above it, or a
   core system dir at the root (/etc, /usr, /var, C:\Windows, …); raw writes
   and formats of whole disks; and fork bombs. It does NOT judge git
   (force-push, reset --hard, clean) or project-level deletes — those are
   yours to get right. Do not attempt to route around it; if it blocks something
   you believe is legitimate, say so in the receipt and let the human decide.
   If the session-start context carries a WARNING that the guard cannot
   run (no working Python), or a tool result reports "guard SKIPPED", this
   hook-layer floor is absent — treat every command as unscreened, apply
   the same bans yourself, and record the gap in the receipt. (A per-call
   SKIPPED notice goes to the user's transcript, not necessarily to you, so
   the session-start WARNING is the signal to rely on.)

Everything else CCMAF offers — board, lanes, doctor, verify-handback, state
files, cold start — is deliberately absent at Tier 0. If the work spans
sessions, machines, or multiple features, use the full framework:
https://github.com/drushegh/CCMAF
