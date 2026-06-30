# Sequencing, Layout and Transitions

## AbsoluteFill

The workhorse layout primitive — a `position: absolute` div filling the
canvas. Stack them for layers (later children on top):

```tsx
import { AbsoluteFill } from "remotion";
<AbsoluteFill style={{ backgroundColor: "white" }}>
  <AbsoluteFill>{/* background */}</AbsoluteFill>
  <AbsoluteFill>{/* foreground */}</AbsoluteFill>
</AbsoluteFill>
```

## Sequence — time-shift and limit children

`<Sequence>` shifts its children in time and (by default) limits when
they're mounted. Crucially, it **resets `useCurrentFrame()` to 0** for
its children at `from`.

```tsx
import { Sequence } from "remotion";
<Sequence from={30} durationInFrames={60} name="Title">
  <Title />     {/* frame 0 here = frame 30 on the timeline */}
</Sequence>
```

- `from` — start frame (can be negative to start "already in progress").
- `durationInFrames` — how long it's mounted (omit = to the end).
- `layout="none"` — don't wrap in an `AbsoluteFill` (when you want the
  child to flow, e.g. inside flexbox).
- `name` — label shown in the Studio timeline.

## Series — sequential, back-to-back

`<Series>` lays segments one after another without hand-computing
offsets:

```tsx
import { Series } from "remotion";
<Series>
  <Series.Sequence durationInFrames={40}><Intro /></Series.Sequence>
  <Series.Sequence durationInFrames={60}><Body /></Series.Sequence>
  <Series.Sequence durationInFrames={40} offset={-10}><Outro /></Series.Sequence>
</Series>
```

`offset` overlaps/gaps relative to the previous segment.

## Loop and Freeze

- `<Loop durationInFrames={30}>` repeats its children every N frames
  (optionally `times`).
- `<Freeze frame={30}>` pins children to a single frame (still image of
  an animation).

## Transitions — @remotion/transitions

For animated transitions *between* segments, use `<TransitionSeries>`
(not plain `<Series>`):

```tsx
import { TransitionSeries, linearTiming, springTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={60}><SceneA /></TransitionSeries.Sequence>
  <TransitionSeries.Transition
    presentation={fade()}
    timing={springTiming({ config: { damping: 200 } })}
  />
  <TransitionSeries.Sequence durationInFrames={60}><SceneB /></TransitionSeries.Sequence>
</TransitionSeries>
```

- **Presentations**: `fade`, `slide`, `wipe`, `flip`, `clockWipe`,
  `none`, plus custom presentations.
- **Timings**: `linearTiming({ durationInFrames })` or
  `springTiming(...)`.
- A transition's duration **overlaps** the adjacent sequences — budget
  for it (total length = sum of sequences − sum of transition
  durations).

## Choosing

| Need | Use |
|------|-----|
| Layered, overlapping elements | stacked `AbsoluteFill` |
| One element to appear at frame X for N frames | `<Sequence from durationInFrames>` |
| Segments back-to-back | `<Series>` |
| Animated cut between segments | `<TransitionSeries>` + a presentation |
| Repeat / hold | `<Loop>` / `<Freeze>` |
