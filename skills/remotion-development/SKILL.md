---
name: remotion-development
description: >-
  Making videos programmatically with Remotion — the React framework for
  video. Covers compositions and the Studio, frame-driven animation
  (useCurrentFrame, interpolate, spring), sequencing and transitions,
  assets/audio/video (staticFile, OffthreadVideo, delayRender),
  data-driven video via input props and calculateMetadata with typed
  (zod) schemas, and every rendering path (the CLI, server-side
  @remotion/renderer, Remotion Lambda) plus embedding with
  @remotion/player. Use for ANY Remotion work — .tsx compositions,
  registerRoot, Composition/Sequence, useCurrentFrame/interpolate/
  spring, `npx remotion render`/`studio`, renderMedia/selectComposition,
  renderMediaOnLambda, @remotion/player. Trigger whenever someone wants
  a video generated from React/code/data — "make an MP4 from this data",
  "animated intro/explainer in code", "render a video on the server",
  "data-driven video", a personalised video at scale — even if they
  don't say "Remotion". **Licensing is in scope and must be raised.**
---

# Remotion Development

Remotion makes videos **programmatically with React**: a video is a
React component, time is a frame counter, and rendering screenshots each
frame with headless Chrome and stitches them with FFmpeg. **Current
line June 2026: v4.0.x** (4.x bundles its own FFmpeg — no system FFmpeg
needed). Verify the project's pinned version; minor releases move fast.

This skill owns the Remotion model and pipeline. General React (hooks
rules, component composition, Next.js) → `react-development`; general TS
and tsconfig → `typescript-development`; three.js itself (for
`@remotion/three`) → `threejs-development`. Cross-reference, don't
duplicate.

**Verification note:** TSX compositions can be type-checked/bundled
(esbuild/tsc), but *correctness* of an animation is visual — the real
check is a render or the Studio preview. Don't claim a video looks right
from code alone.

## Non-negotiables

1. **Licensing is a commercial decision — surface it, don't bury it.**
   Remotion is **not** open-source-free for everyone: it is free for
   individuals, non-profits, for-profit companies with **up to 3
   employees**, and genuine evaluation. A **for-profit company with 4 or
   more employees needs a paid Company Licence** (remotion.pro). This
   catches most consultancies and product teams. Raise it before a team
   builds anything non-trivial on Remotion, and re-verify current terms
   (`references/licensing.md`) — don't assert pricing from memory.
2. **Animate from `useCurrentFrame()`, never from CSS transitions/
   animations or wall-clock time.** Frames are rendered in parallel and
   out of order by separate Chrome instances; anything not derived from
   the current frame flickers or desyncs in the render even if it looks
   fine in preview. Every moving value is a pure function of `frame`.
3. **Determinism everywhere.** No `Math.random()`, `Date.now()`, or
   un-seeded state — two renders of the same frame must be identical.
   Use Remotion's seeded `random()`. Side effects belong in
   `delayRender`/`continueRender` or `calculateMetadata`, not in render.
4. **One source of truth for metadata.** Width, height, fps and
   `durationInFrames` come from the `Composition` (or
   `calculateMetadata`), and inside components from `useVideoConfig()` —
   never hard-code dimensions or fps in two places.
5. **Type your input props with a schema.** Data-driven videos take
   input props; define a zod schema so the Studio gets an editing UI and
   renders are validated. Props must be JSON-serialisable (they cross a
   process/network boundary, especially on Lambda).
6. **`OffthreadVideo` for rendering, not `Video`.** Embedded video for
   rendering should use `OffthreadVideo` (frame-accurate, extracted by
   FFmpeg); reserve `Video` for the Player/preview. Audio via
   `Audio` with frame-based trimming.

## How the pieces fit

| Concept | What it is | Reference |
|---------|-----------|-----------|
| Composition | A renderable: component + w/h + fps + duration + id | `project-and-compositions.md` |
| Studio | `npx remotion studio` live preview + props editor | `project-and-compositions.md` |
| Animation | `useCurrentFrame`, `interpolate`, `spring` | `animation.md` |
| Sequencing | `Sequence`/`Series`/`AbsoluteFill`, transitions | `sequencing-and-transitions.md` |
| Assets | `staticFile`, `OffthreadVideo`, `Audio`, `Img`, fonts | `assets-and-media.md` |
| Data | input props, `calculateMetadata`, zod schema | `data-and-props.md` |
| Output | CLI / `@remotion/renderer` SSR / Lambda; `@remotion/player` | `rendering-and-player.md` |
| Licensing | who pays, what counts, how to verify | `licensing.md` |

## Workflow

1. **Decide the delivery model first** — one-off render, data-driven
   batch, or in-app live playback (`@remotion/player`). It changes the
   architecture and the rendering path. Confirm licensing applies.
2. Scaffold: `npm create video@latest` (or add Remotion to an existing
   project); `src/index.ts` `registerRoot`, `src/Root.tsx` with
   `Composition` entries, `remotion.config.ts`.
3. Build compositions as React components; drive everything off
   `useCurrentFrame()`/`useVideoConfig()`; preview in the Studio.
4. For data-driven video, define the zod prop schema + `calculateMetadata`
   (dynamic duration/dimensions, fetch data once) and pass input props.
5. Render via the path chosen in step 1; tune codec/quality/concurrency.
6. Verify with an actual render (or Studio), not by reading the TSX.

## High-frequency pitfalls

- CSS `transition`/`animation`, `setInterval`, or `Date.now()` driving
  motion → flicker/desync on render (looks fine in preview — the classic
  trap). Everything from `frame`.
- `useCurrentFrame()` inside a `Sequence` is **relative** to that
  sequence's start, not the timeline — intended, but surprises people.
- Importing media by relative path and expecting it to render — use
  `staticFile()` (for `public/`) or a bundler import; raw paths break in
  the bundle.
- Async work (fonts, data, `Img` decode) not wrapped in
  `delayRender()`/`continueRender()` → frames captured before content is
  ready; or a `delayRender` that never continues → render timeout.
- Non-serialisable input props (functions, class instances, `Date`
  objects) — fail across the Lambda/SSR boundary.
- Assuming system FFmpeg/Chrome — v4 bundles FFmpeg; the renderer needs
  a Chrome Headless Shell (`ensureBrowser()` / auto-download in CI).
- Shipping a commercial product while assuming Remotion is "free" —
  see non-negotiable 1.

## References

| File | Load when |
|------|-----------|
| `references/project-and-compositions.md` | Project layout, `registerRoot`, `Composition`/`Still`, the Studio, config |
| `references/animation.md` | `useCurrentFrame`, `interpolate`, `spring`, easing, determinism, the no-CSS rule |
| `references/sequencing-and-transitions.md` | `Sequence`/`Series`/`Loop`/`Freeze`, layering, `@remotion/transitions` |
| `references/assets-and-media.md` | `staticFile`, `Img`, `OffthreadVideo` vs `Video`, `Audio`, fonts, `delayRender`, media-utils |
| `references/data-and-props.md` | Input props, `calculateMetadata`, zod-typed schemas, serialisation, batch/personalised video |
| `references/rendering-and-player.md` | CLI, `@remotion/renderer` (SSR), Remotion Lambda, codec/quality/concurrency, `@remotion/player` |
| `references/licensing.md` | Who must pay, what counts as an employee/seat, `@remotion/licensing`, how to verify |

## Boundaries with sibling skills

- React/Next.js patterns, hooks rules, embedding the Player in an app →
  `react-development`; TS config/typing in general → `typescript-development`.
- `@remotion/three` scenes → `threejs-development` for three.js itself.
- CI render pipelines → `devops-development`; AWS IAM/Lambda infra and
  handling untrusted input props → `secure-development`.
- Agent-driven Remotion (the official Remotion MCP / "Remotion Skills",
  Jan 2026) is a delivery vehicle, not a substitute for these standards —
  generated compositions still obey the non-negotiables above.
