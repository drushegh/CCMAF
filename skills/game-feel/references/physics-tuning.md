# Physics tuning: realistic vs good-feeling

The biggest game-feel insight: **good-feeling motion is usually not physically
realistic.** A real jump, real friction, real momentum make a sluggish, floaty
game. Treat motion values as *design parameters tuned for sensation*, not a
simulation to keep accurate.

## Don't ship the engine defaults

Dropping a rigid body in with default gravity/mass/friction gives "realistic"
and almost always bad-feeling control: floaty jumps, slidey stops, momentum you
can't fight. Override deliberately; the defaults are a starting substrate, not a
design.

## The levers

- **Acceleration / deceleration** — how fast you reach and leave top speed.
  *Snappy* feel: near-instant accel and stop. *Weighty* feel: gradual ramp and a
  slide. This single choice defines a character's personality (think a precise
  platformer vs a heavy tank).
- **Max speed** — capped, not "whatever physics produces". A clear top speed is
  more controllable and readable.
- **Friction / drag** — ground vs air friction tuned separately; air control is
  usually *more* generous than reality for responsiveness.
- **Gravity** — the big one for jumps (below).
- **Turning** — instant direction change feels responsive (most 2D); momentum-
  preserving turns feel heavy/realistic (racing, some 3D). Choose per game.

## Asymmetric gravity (the floaty-jump fix)

Almost every good platformer **falls faster than it rises**. Equal up/down
gravity feels floaty and hangs too long at the apex. Use a higher gravity on
descent (and often when the jump button is released). Pseudocode convention
below: **screen coordinates, y-positive is down**, so rising is `velocity.y < 0`
and falling is `velocity.y > 0` (same convention as `input-and-responsiveness.md`;
flip the signs for a y-up engine):

```text
if velocity.y > 0 (falling):        gravity *= FALL_MULTIPLIER     # e.g. 2.0
elif velocity.y < 0 and not jump_held: gravity *= LOW_JUMP_MULT     # e.g. 2.5
clamp velocity.y to TERMINAL_VELOCITY
```

A short hang-time at the apex (briefly reduced gravity near the peak) can add
control and "hateable" precision — used in Mario-likes. Cap **terminal
velocity** so falls stay readable and controllable.

## Frame-rate independence (or feel changes with FPS)

A classic, easily-missed bug: applying movement/gravity *per frame* without
scaling by delta-time makes the **feel change with frame rate** — the jump that
felt right at 60 fps is twice as strong at 120 and mushy at 30. Run feel-
critical movement on a **fixed timestep** (physics tick), or multiply
accelerations/velocities by **delta-time**, so the experience is identical
across machines. Frame-windowed forgiveness (coyote/buffer measured in frames)
should likewise be expressed in seconds, or fixed to the physics tick, not raw
render frames.

## Tuning by intended character

Decide the feel first, then set values to match:
- **Crisp/precise** (Celeste-like): fast accel, hard stop, fast fall, tight
  air control, strong forgiveness.
- **Weighty/grounded** (heavy character): slow ramp, momentum, slower fall,
  committed turns.
- **Floaty by design** (space/swim): low gravity, drifting decel — but still
  *controllable*, not accidental.

## A simulation is not a game

If you genuinely need realism (a physics puzzle, a sim racer, a sandbox), the
realism *is* the design — but still tune the *control* layer over it
(steering response, assists, camera) so it feels good to drive, not just
accurate. Even racing sims add stability assists and tuned camera for feel.

## Reasoning checklist

For a "floaty / slippery / heavy" complaint: is gravity symmetric (make fall
faster)? is decel too low (slidey)? is accel ramp too long (sluggish)? is there
a speed cap? Are ground and air handled separately? These are number tweaks on
exposed tunables — change one, **playtest**, repeat (`tuning-and-verification.md`).
Engine-specific APIs (CharacterBody, Rigidbody modes, movement components) →
the engine skill.
