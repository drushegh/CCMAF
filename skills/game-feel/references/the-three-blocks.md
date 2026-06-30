# The three building blocks

Steve Swink's *Game Feel* frames the sensation of control as three layers. You
build from the bottom: get control right, then sell it.

## 1. Real-time control

The player gives continuous input and the game reacts **fast enough that they
feel directly connected** to the thing they control. This is the foundation —
if it's missing, no amount of polish saves the feel.

What kills the sense of control: **latency**. Input-to-on-screen-reaction delay
accumulates from many places — input polling timing, a fixed-update step,
animation that must "play out" before the character responds, physics
sub-stepping, V-sync/frame pacing, and render/display lag. Each adds frames; a
few frames is the difference between "crisp" and "mushy".

Principles:
- **Sample input every frame** and act on it the same frame where possible;
  don't gate movement behind an animation finishing.
- **Decouple intent from animation** — the character starts moving now; the
  animation catches up (or blends), rather than the animation being the gate.
- **Budget your latency** — know how many frames sit between button and pixel,
  and cut the avoidable ones.
- **Consistent frame pacing** matters more than raw FPS for feel; a stable 60
  feels better than a stuttering higher number.

## 2. Simulated space

The world the controlled object moves through — its rules of motion and
collision. This is where "physics" lives, but as **design parameters tuned for
feel**, not a faithful simulation (see `physics-tuning.md`). The space gives the
control *context*: a jump only feels good in relation to gravity, platforms,
gaps and the camera framing it.

## 3. Polish

Everything that **sells** the perception of controlling a real thing in a real
space: animation, particles, screenshake, sound, hitstop, squash-and-stretch,
camera moves (see `juice-and-feedback.md`). Polish **amplifies** a good core —
it makes a solid jump *feel* powerful — but it **cannot create** feel that
isn't there: juicing floaty, laggy control just makes a bad jump louder.

## The feel loop

Put together, feel is a tight loop: **input → (minimal latency) → response in the
simulated space → feedback that confirms and amplifies it → player adjusts**.
The faster and clearer that loop, the more the player feels *agency*.

## Why this matters for reasoning about feel

You usually can't run and feel the game yourself, so reason structurally:
- Is the **control** layer responsive (latency low, movement not gated by
  animation)?
- Are the **space** parameters tuned for the intended feel (snappy vs weighty),
  or left at engine defaults?
- Is there **feedback** on the events that matter, without burying the action?

Diagnose a "feels off" complaint by asking which layer is at fault — almost
always it's control (latency/responsiveness) or untuned space (floaty physics),
*then* polish. Fix in that order.
