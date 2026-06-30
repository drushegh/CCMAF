# Assets, Media and Async Loading

## staticFile — reference assets correctly

Assets in `public/` are referenced with `staticFile()`, never a raw
relative path (raw paths break in the bundle/render):

```tsx
import { staticFile, Img } from "remotion";
<Img src={staticFile("logo.png")} />
```

Imported assets (`import logo from "./logo.png"`) also work via the
bundler. Remote URLs are allowed but must be reachable from the render
environment (and CORS-clean).

## Images — <Img>

Use Remotion's `<Img>` (not a bare `<img>`): it integrates with
`delayRender` so the frame isn't captured before the image has decoded.
Same idea for `<IFrame>`.

## Video — OffthreadVideo vs Video

- **`<OffthreadVideo>`** — the default for embedded video. Frames are
  extracted by FFmpeg off the main thread, so they're frame-accurate and
  reliable during render. Use this for rendering.
- **`<Video>`** — uses the real HTML `<video>` element; fine for the
  Player/preview but less reliable for rendering. Reserve for playback.

Both take `src`, `startFrom`/`endAt` (trim), `volume`, `playbackRate`,
`muted`. Match the composition fps to avoid judder.

## Audio — <Audio>

```tsx
import { Audio, staticFile } from "remotion";
<Audio src={staticFile("music.mp3")} startFrom={30} volume={0.5} />
```

- Trim with `startFrom`/`endAt` (in frames). Place inside a `<Sequence>`
  to position it on the timeline.
- `volume` can be a function of frame for fades:
  `volume={(f) => interpolate(f, [0, 30], [0, 1], { extrapolateRight: "clamp" })}`.
- Audio visualisation (waveforms, audiograms) → `@remotion/media-utils`
  (`getAudioData`, `visualizeAudio`, `createSmoothSvgPath`).

## Async work: delayRender / continueRender

Anything asynchronous that must finish *before* a frame is captured —
custom fonts, fetched data used in render, manual image preloads — must
pause the render:

```tsx
import { delayRender, continueRender } from "remotion";
const [handle] = useState(() => delayRender("loading font"));
useEffect(() => {
  loadFont().then(() => continueRender(handle));
}, [handle]);
```

- Every `delayRender()` MUST be matched by a `continueRender()` (or
  `cancelRender()` on error) — an unbalanced handle hangs until the
  render times out.
- Give it a label and mind the timeout (`delayRenderTimeoutInMilliseconds`).
- Prefer doing data fetching once in `calculateMetadata`
  (`data-and-props.md`) over per-frame `delayRender`.

## Fonts

- `@remotion/google-fonts`: `import { loadFont } from
  "@remotion/google-fonts/Inter"; const { fontFamily } = loadFont();` —
  handles the `delayRender` for you.
- Local fonts: `@remotion/fonts` `loadFont({ family, url: staticFile(...) })`.
- Don't rely on system fonts being present in the render environment
  (Lambda/CI won't have them).

## Other media helpers

`@remotion/media-utils` (metadata, audio data), `@remotion/gif` (`<Gif>`),
`@remotion/lottie` (`<Lottie>`), `@remotion/shapes`/`@remotion/paths`
(SVG primitives + path maths), `@remotion/three` (Three.js canvas — see
`threejs-development`), `@remotion/skia`, `@remotion/captions` +
`@remotion/install-whisper-cpp` (subtitles). Pull these in only when
needed; each is its own dependency.
