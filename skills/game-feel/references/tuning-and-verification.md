# Tuning and verifying feel

Feel is found by iteration, not derived from code. You (and an AI agent) cannot
reliably judge feel by reading source — it's perceived in motion and latency. So
the process is built around fast iteration and a human in the loop.

## Expose every feel value as a tunable

Hardcoded feel numbers kill iteration. Surface them where they can be changed and
ideally hot-reloaded mid-play:

- Movement: accel, decel, max speed, ground/air friction, turn rate.
- Jump: jump velocity/height, fall multiplier, low-jump multiplier, terminal
  velocity, apex hang.
- Forgiveness: coyote frames, jump-buffer frames, corner-correction amount.
- Juice: hitstop frames, shake magnitude/decay, particle counts, easing
  durations.
- Camera: damping, look-ahead distance, deadzone size.

Designer-facing parameters (inspector fields, a tuning resource/config,
data-driven values) mean feel can be dialled in seconds — the difference between
a game that gets tuned and one that doesn't. Implementation of data-driven
config → the engine skill (e.g. ScriptableObjects, Godot Resources, data assets).

## The tuning loop (human in the loop)

1. Set a starting point based on intended character (`physics-tuning.md`) and
   typical windows (`input-and-responsiveness.md`).
2. **Someone plays it** — the developer or a tester. Feel is subjective and
   only assessable in the hands.
3. Change **one parameter at a time**, re-play, compare. Note what each value
   does ("fall mult 1.5→2.2: apex hang gone, lands crisp").
4. Reference **acknowledged-good examples** (Celeste, Mario, Hollow Knight,
   Dead Cells) as feel targets — study, don't copy numbers blindly.
5. Stop when it feels right, not when the code is "done".

## What an agent can and can't do here

- **Can**: reason about the levers, propose starting values, spot structural
  feel-killers (animation-gated movement, symmetric gravity, no forgiveness,
  hardcoded values, over-juice), and wire up the tunables.
- **Can't**: confirm it "feels good" from the code or a screenshot. **State this
  plainly** and ask the person to play and report, or to share a clip.

## Capture what you can (ui-verification)

Stills and clips don't convey latency/feel fully, but they catch a lot:

- Capture a **short clip / frame sequence** of the movement (engine recording, or
  `ui-verification`'s frame capture) and view it in order: is the arc right, the
  easing smooth, the squash/landing reading, the camera steady?
- A **frame sequence of a jump** shows hang time and fall speed; of a hit, shows
  hitstop and shake. Useful evidence to pair with the player's felt report.
- For web/canvas games, `ui-verification` (`3d-and-non-web.md`) covers grabbing
  those frames.

## Over-juice and accessibility checks

Part of verifying feel is checking you haven't *over*-done it:

- Is the core action still **readable** under the effects (can the player see the
  hitbox, the platform edge, the threat)?
- Are **screenshake, flashes and full-screen effects** within safe limits, with
  **settings to reduce them** and OS **reduced-motion** honoured? This is a
  genuine accessibility/safety issue (photosensitivity), not a nicety →
  `accessibility-development`.
- Are controls **remappable** and not gated behind frame-perfect inputs?

## Definition of done

Feel work is done when a human has played it and it feels right at the target
character, forgiveness makes it fair, juice amplifies without burying, and the
accessibility/over-juice checks pass — not when the parameters compile.
