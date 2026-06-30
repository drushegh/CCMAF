# Animation: Frame-Driven Motion

Every animated value is a **pure function of the current frame**. This
is the heart of Remotion and the source of most beginner bugs.

## Why frame-driven only (the flickering rule)

At render time, frames are captured by multiple headless Chrome
instances, in parallel and not necessarily in order. A CSS
`transition`, a `setInterval`, or anything reading `Date.now()` has no
stable relationship to "frame N", so the captured frame is whatever the
animation happened to be at — flicker, jumps, desync. It looks fine in
the Studio (real-time) and breaks only on render, which is why it
catches people. **Derive everything from `useCurrentFrame()`.** (See
`/docs/flickering`.)

## useCurrentFrame + useVideoConfig

```tsx
import { useCurrentFrame, useVideoConfig } from "remotion";
const frame = useCurrentFrame();           // 0-based within the composition/sequence
const { fps, durationInFrames } = useVideoConfig();
```

`frame` is **relative to the enclosing `<Sequence>`** if there is one
(starts at 0 when that sequence starts), otherwise to the composition.

## interpolate()

Map a frame range to an output range. Always clamp unless you want
extrapolation.

```tsx
import { interpolate } from "remotion";
const opacity = interpolate(frame, [0, 30], [0, 1], {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",   // without this it keeps going past 1
});
```

- Multiple keyframes: `interpolate(frame, [0, 30, 60], [0, 1, 0])`
  (fade in then out). Input range must be monotonically increasing.
- Easing: pass `{ easing: Easing.bezier(...) }` (or `Easing.inOut(
  Easing.ease)`); import `Easing` from `remotion`.
- Great for opacity, position, scale, colour channels, rotation — any
  scalar.

## spring()

Physically-based motion (natural ease + optional overshoot). Needs
`fps` and `frame`.

```tsx
import { spring } from "remotion";
const scale = spring({
  frame,
  fps,
  config: { damping: 200 },          // damping↑ = less/no overshoot
  durationInFrames: 20,               // optional: fit the spring to a length
});
```

Defaults overshoot slightly (a lively "pop"). Combine with `interpolate`
to map a spring's 0→1 into any range:
`interpolate(spring(...), [0,1], [-200, 0])`. `measureSpring()` tells you
how many frames a spring takes to settle.

## Determinism

- Never `Math.random()` — use Remotion's seeded `random("seed")` /
  `random(seed)` so every render of a frame is identical.
- No wall-clock time, no mutable module-level counters, no reading from
  the network *during* render (do that in `calculateMetadata` or
  `delayRender`).

## Composition over giant timelines

Build small animated components and compose them with `<Sequence>` /
transitions (`sequencing-and-transitions.md`) rather than one component
with dozens of `interpolate` calls keyed off absolute frames. Local
frames keep each piece readable and reusable.

General React performance (memoisation, re-renders) → `react-development`.
