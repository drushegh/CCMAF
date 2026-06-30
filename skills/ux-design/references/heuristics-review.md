# Heuristic review (Nielsen's 10)

A fast, structured way to *evaluate* a UI — yours or someone else's — without a
user study. Jakob Nielsen's 10 usability heuristics (NN/g) are the standard
checklist; pair them with this skill's laws and a severity rubric, then confirm
findings by rendering (`ui-verification`).

## The 10 heuristics (as review questions)

1. **Visibility of system status** — does the UI always show what's happening
   (loading, saved, current location, progress) within a sensible time?
2. **Match between system and the real world** — does it speak the user's
   language and follow real-world conventions, not internal jargon/codes?
3. **User control and freedom** — are there clear exits, undo/redo, cancel? Can
   the user escape a state they entered by mistake?
4. **Consistency and standards** — internal consistency (same thing looks/acts
   the same) and external (platform conventions — Jakob)?
5. **Error prevention** — are slips and mistakes designed out (constraints,
   confirmations, good defaults) before they can happen?
6. **Recognition rather than recall** — are options/information visible so users
   don't have to remember across steps (Miller)?
7. **Flexibility and efficiency of use** — accelerators for experts (shortcuts,
   defaults, recents) without burdening novices?
8. **Aesthetic and minimalist design** — does every element earn its place, or
   is signal diluted by noise (Hick)?
9. **Help users recognise, diagnose, recover from errors** — plain-language
   messages saying what, why, and how to fix, next to the problem?
10. **Help and documentation** — is help available and findable where needed,
    even if the goal is to need none?

## Running a heuristic evaluation

1. Define the **user and the key tasks**; walk each task through the UI.
2. At each screen/step, check it against the 10 heuristics **and** this skill's
   laws (hierarchy, Gestalt grouping, Fitts/Hick, feedback timing, target size).
3. Record each issue as: *what* you observed, *which* heuristic/law it violates,
   *where*, and a suggested fix.
4. Rate **severity** and prioritise — don't treat all findings as equal.
5. Cover the **unhappy paths** (empty/error/loading/overflow), not just the
   happy path.
6. **Verify visually** — render the screens and look (`ui-verification`); many
   issues (cramped spacing, weak hierarchy, clipped content) are only obvious
   when seen.

## Severity rubric (NN/g-style, 0–4)

- **0 — not a problem** (or purely cosmetic preference).
- **1 — cosmetic** — fix if time permits (minor alignment/spacing).
- **2 — minor** — low-frequency or easily worked around; fix soon.
- **3 — major** — frequent or hard to work around; users struggle. Fix.
- **4 — catastrophe** — blocks the task or causes data loss/errors. Fix before
  release.

Score on **frequency × impact × persistence**: a small issue on the main flow
can outrank a big issue no one hits.

## Output of a review

A prioritised list, severity-tagged, each item naming the violated
heuristic/law and a concrete fix — so it's actionable and the reasoning is
inspectable. This is the rubric `ui-verification` applies when critiquing a
rendered screenshot, and it dovetails with an `accessibility-development` audit
(run both: usability and a11y are different lenses on the same UI).
