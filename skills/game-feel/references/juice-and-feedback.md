# Juice and feedback

"Juice" is the layered feedback that **sells** an action — making a good core
control feel powerful and alive (the "polish" block). The classic demo is
*Juice It or Lose It* (Jonasson & Purho): the same simple game, transformed by
feedback alone. Rule: juice **amplifies** good control; it never fixes bad
control, and too much *hurts*.

## Layer feedback on meaningful events

For an impactful event (hit, pickup, jump, land, death), stack several channels
so it reads instantly:

- **Hitstop / freeze-frame** — briefly freeze (a few to ~10 frames) on impact;
  the pause makes a hit feel heavy. The single highest-impact "weight" trick.
- **Screenshake** — a short, decaying camera shake. **Use sparingly and small**;
  scale to event magnitude; constant shake is noise and nausea.
- **Particles** — debris, sparks, dust on land/impact; communicate force and
  material.
- **Squash & stretch** — deform on acceleration/impact (a ball squashes on
  landing, stretches when launched). From the Disney 12 principles; cheap, huge
  feel return.
- **Flash / colour** — a hit flash or tint confirms a hit landed.
- **Knockback / recoil** — both target and source move; force you can see.
- **Sound** — tightly synced to the visual; audio is half of perceived impact.
  Slight pitch variation stops repetition fatigue.
- **Haptics** — where available, a rumble on the big beats.

The aggregate, well-tuned, is what players call "game feel". A pickup that
flashes, pops with a particle, plays a rising chime and nudges the HUD feels
*good*; the same pickup silent feels broken.

## Animation timing (the 12 principles, applied)

- **Anticipation** — a small wind-up before a big action (crouch before jump)
  makes it read and feel powerful.
- **Follow-through / overshoot** — settle past the target then back (UI and
  characters); motion that stops dead feels robotic.
- **Easing** — never move linearly. Ease-out for arrivals (decelerate in),
  ease-in for departures; easing curves (Penner/standard) are the vocabulary.
  Linear motion is the tell of unjuiced movement.
- **Secondary motion** — hair, cloth, trailing elements that lag the main body.

## Camera is feel too

- **Follow with damping** — smoothly track the player; never hard-snap (jarring,
  nauseating).
- **Look-ahead** — bias the camera toward facing/movement direction so the
  player sees where they're going.
- **Deadzone** — a central region the player can move within before the camera
  follows, so small moves don't jiggle the view.
- **Punch / kick** — small, brief camera moves on big events (distinct from
  shake); screen-space effects (chromatic aberration, vignette) on key beats —
  sparingly.

## Easing snippet (illustrative)

```text
# ease-out cubic: fast then settle — good for arrivals/UI
t = elapsed / duration            # 0..1
eased = 1 - pow(1 - t, 3)
value = start + (target - start) * eased
```

## Restraint and accessibility

- **Don't over-juice.** Effects must not bury the action or the information the
  player needs (where's the hitbox, what's safe). Readability first.
- **Respect reduced-motion / photosensitivity** — heavy shake, flashes and
  full-screen effects are accessibility hazards; provide settings to reduce
  screenshake and flashing, honour the OS reduced-motion flag (→
  `accessibility-development`).
- Tune intensity per event magnitude; reserve the big juice for the big moments
  (Peak-End — the climactic hit is what's remembered).

Engine-specific implementation (tween libraries, particle systems, camera rigs,
shake addons) → the engine skill; this owns *what to apply and how much*.
