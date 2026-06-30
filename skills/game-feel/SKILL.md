---
name: game-feel
description: >-
  The craft of making interactive motion feel good — engine- and
  language-agnostic. Why a jump feels floaty or crisp, why a control feels
  responsive or laggy, and the gap between physically *realistic* and
  *good-feeling*: real-time control and Steve Swink's three building blocks,
  input responsiveness and forgiveness (coyote time, jump buffering, variable
  jump height, corner correction), physics tuning (acceleration/friction/
  gravity curves, snappy vs floaty), and juice (screenshake, hitstop, easing,
  squash-and-stretch, camera, audio-visual sync). Use whenever a game's
  controls, character movement, jump, camera, hit reactions, or "it feels off"
  are in play — across Unity, Godot, Unreal, three.js or any engine. The engine
  skill owns the API; this owns why it feels right. Real-time feel needs a human
  in the loop — see the verification reference.
---

# Game Feel

The moment-to-moment **tactile sensation** of controlling something in a game —
the part that makes a jump satisfying, a hit impactful, a car planted or
slippery. It's mostly invisible in the code and absent from a screenshot, which
is exactly why it gets neglected: it lives in **timing, response and feedback**,
not in the feature list.

This skill is engine-agnostic on purpose — the same principles tune a Unity
platformer, a Godot top-down, an Unreal shooter, or a three.js toy. The engine
skills (`unity-development`, `godot-development`, `unreal-engine-development`,
`threejs-development`) own *how* to implement it; this owns *what good feels
like and why*.

> Honest limit up front: feel can't be fully judged from code or a still image —
> it's perceived in motion and latency. Tuning is a **human-in-the-loop** loop
> (someone plays, you adjust) supported by frame/clip capture
> (`ui-verification`) and the principles here. Don't claim a build "feels good"
> from reading the code.

## The central idea

**Good feel ≠ realistic physics.** A real human jump is a poor game jump.
Great-feeling games use *tuned, often non-physical* motion in service of
**responsive, legible, satisfying control**. The job is to make the player feel
that their input has immediate, powerful, predictable effect — then sell it with
feedback.

Steve Swink's **three building blocks**: **real-time control** (input produces an
effect fast enough to feel connected), **simulated space** (the world the motion
happens in), and **polish** (the art/sound/effects that sell the sensation). Get
control right first; polish amplifies a good core and can't rescue a bad one.

## Non-negotiables

1. **Responsiveness beats realism.** Minimise input-to-reaction latency; the
   player must feel their input land *now*. A technically accurate but laggy or
   floaty control feels broken.
2. **Tune for feel, not physical accuracy.** Acceleration, friction, gravity and
   speed are *design parameters*, not a physics simulation to be "correct".
   Asymmetric gravity (fall faster than you rise), capped speeds, instant
   direction changes — all standard, all non-physical, all feel better.
3. **Forgiveness is invisible and essential.** Coyote time, jump buffering,
   corner correction and the like make controls feel *fair* and responsive;
   players never notice them when present, only their absence (as "the game
   ignored me").
4. **Feedback on every meaningful event** — visual + audio + (where apt) haptic,
   layered. An action with no feedback feels weightless; this is "juice".
5. **Don't over-juice.** Screenshake, particles and effects must not bury
   readability or the core control. Excess is a real failure mode (and an
   accessibility hazard — see below). More is not better; *legible and
   satisfying* is.
6. **Expose tunables; never hardcode feel.** Jump height, gravity, accel,
   coyote/buffer windows, shake magnitude must be adjustable so feel can be
   iterated rapidly in playtesting (designer-facing values, hot-reload if
   possible).
7. **Verify in motion, with a human.** Capture frames/clips (`ui-verification`)
   and have someone actually play; tune from felt experience, not from the
   source.

## Decision tables

| Complaint | Likely lever |
|---|---|
| "Jump feels floaty" | Increase gravity (esp. on descent), lower jump rise time, add fast-fall; shorten airtime |
| "Controls feel sluggish/laggy" | Cut input latency, raise acceleration / reduce ramp, reduce buffered frames, check frame pacing |
| "Movement feels slippery" | Increase deceleration/friction, reduce momentum carry, snappier stop |
| "The game ignored my jump" | Add coyote time (~5–8 frames) + jump buffering (~5–8 frames) |
| "Bumping ledges/edges feels unfair" | Corner correction / edge nudging; forgiving collision |
| "Hits feel weak" | Hitstop/freeze-frame, knockback, screenshake (small), flash, sound, particles |
| "Camera feels jerky/nauseating" | Damping/smoothing, look-ahead, deadzone; ease, don't snap |

## High-frequency pitfalls

- **Realistic physics mistaken for good feel** — using the engine's raw rigid-
  body defaults and shipping floaty, unresponsive control.
- **No input forgiveness** — frame-perfect demands that read as the game being
  unresponsive or unfair.
- **Latency ignored** — input sampled late, animation/logic adding delay; feel
  dies in the milliseconds.
- **Over-juicing** — constant screenshake, particle spam, effects drowning the
  action and hurting readability.
- **Hardcoded magic numbers** — feel values buried in code, so iteration is slow
  and tuning never happens.
- **Symmetric jump gravity** — rise and fall at the same rate feels floaty;
  almost every good platformer falls faster than it rises.
- **Camera that snaps** to the target with no smoothing — jarring and nauseating.
- **Claiming feel from code** — declaring it good without anyone playing it.

## Workflow for tuning feel

1. Nail **real-time control** first: input → reaction with minimal latency; the
   core movement responsive before any polish.
2. Tune the **motion curves** (accel/decel/gravity/max speed) for the intended
   character — snappy vs weighty is a deliberate choice.
3. Add **forgiveness** (coyote time, jump buffering, corner correction) — make it
   fair.
4. Layer **juice/feedback** on key events (impact, pickup, jump, land), kept
   legible.
5. Tune the **camera** (follow, look-ahead, damping, deadzone).
6. **Playtest** (human in the loop) + capture clips (`ui-verification`); adjust
   the exposed tunables; repeat. Reference feel from acknowledged-good games.

## Reference index

Load on demand:

- `references/the-three-blocks.md` — Swink's model, the control loop, latency, what "feel" is made of
- `references/input-and-responsiveness.md` — latency, buffering, coyote time, forgiveness mechanics
- `references/physics-tuning.md` — realistic vs good-feeling motion; accel/friction/gravity curves
- `references/juice-and-feedback.md` — screenshake, hitstop, easing, squash-and-stretch, camera, audio
- `references/tuning-and-verification.md` — exposing tunables, the playtest loop, capture, over-juice and accessibility

## Boundaries

- **Engine API and implementation** (how to read input, move a body, attach a
  particle system, write the script) → `unity-development`,
  `godot-development`, `unreal-engine-development`, `threejs-development`. This
  skill owns the *feel*, those own the *how*.
- **A game's 2D UI, menus, HUD layout** → `ux-design`; **rendering/capturing
  frames to review** → `ui-verification`.
- **Reduced-motion / photosensitivity / remappable controls** →
  `accessibility-development` (and called out in
  `tuning-and-verification.md`).
- **Animation as an asset pipeline** (rigging, export) → `blender-development`;
  this covers animation *timing/feel*, not authoring.
