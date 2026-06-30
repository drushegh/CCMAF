# Rendering and the Player

Three ways to turn a composition into a file, plus the Player for
in-browser playback. Pick the path up front — it shapes the
architecture.

## 1. CLI — local, one-off and scripts

```bash
npx remotion render MyVideo out/video.mp4 --props=./data.json
npx remotion still  MyStill out/thumb.png --frame=30
npx remotion studio                 # live preview + props editor
npx remotion bundle                 # produce a bundle for SSR/Lambda
npx remotion lambda render <serve-url> MyVideo
```

Good for development, manual exports, and simple CI jobs. v4 bundles
FFmpeg; the renderer needs a Chrome Headless Shell (auto-downloaded).

## 2. Server-side — @remotion/renderer (Node/Bun)

Programmatic rendering in your own backend. The shape is always:
**bundle → select composition → render**.

```ts
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia, ensureBrowser } from "@remotion/renderer";

await ensureBrowser();                                  // Chrome present
const serveUrl = await bundle({ entryPoint: "./src/index.ts" });
const composition = await selectComposition({
  serveUrl, id: "MyVideo", inputProps,                  // resolves calculateMetadata
});
await renderMedia({
  serveUrl, composition, codec: "h264",
  outputLocation: "out/video.mp4", inputProps,
  onProgress: ({ progress }) => console.log(progress),
});
```

- `renderStill()` for a single frame; `renderFrames()` for raw frames +
  custom stitching.
- `selectComposition` runs `calculateMetadata`, so duration/size/props
  are resolved before render.
- Run on a machine with enough CPU; control parallelism with
  `concurrency`.

## 3. Remotion Lambda — cloud scale (AWS)

For high volume / personalised batches. One-time setup deploys a
function and a site (the bundle on S3); then render on demand, parallelised
across Lambda invocations.

```ts
import { deployFunction, deploySite, getOrCreateBucket } from "@remotion/lambda";
import { renderMediaOnLambda, getRenderProgress } from "@remotion/lambda/client";
// deploy once (function + site to S3), then:
const { renderId, bucketName } = await renderMediaOnLambda({
  region: "eu-west-1", functionName, serveUrl, composition: "MyVideo",
  codec: "h264", inputProps, framesPerLambda /* optional chunking */,
});
const progress = await getRenderProgress({ renderId, bucketName, functionName, region });
```

- Scales by splitting the video into chunks across concurrent Lambdas.
- Mind: AWS IAM/permissions, the input-props size limit (pass big data
  by reference), region, and cost (per-render; verify current pricing).
  AWS infra/permissions → `secure-development`/your cloud setup.
- A GCP path via `@remotion/cloudrun` has existed — **verify its current
  support status** before choosing it over Lambda rather than assuming.

## Output knobs (all paths)

- `codec`: `h264` (default, MP4), `h265`, `vp8`/`vp9` (WebM), `prores`
  (editing), `gif`, plus audio-only (`mp3`/`aac`/`wav`).
- Quality: `crf` (lower = better/bigger), `jpegQuality` for frame
  capture, `videoBitrate`/`audioBitrate`.
- `imageFormat` (`jpeg` fast / `png` for alpha), `scale` (super-sampling),
  `pixelFormat` (e.g. `yuva420p` + ProResfor transparency),
  `concurrency`, `frameRange`, `muted`, `everyNthFrame`.

## @remotion/player — in-browser playback (not rendering)

Embed a live, interactive preview in a React/Next app. This **plays**
the composition in the browser; it does **not** produce a file.

```tsx
import { Player } from "@remotion/player";
<Player
  component={MyVideo}
  durationInFrames={150} fps={30} compositionWidth={1920} compositionHeight={1080}
  inputProps={{ title: "Hello" }}
  controls loop clickToPlay
  style={{ width: "100%" }}
/>;
```

- Imperative control via a `ref` (`play`, `pause`, `seekTo`,
  `getCurrentFrame`); events (`play`/`pause`/`seeked`/`ended`).
- `<Thumbnail>` renders a single frame as a preview image.
- Note: you pass metadata to the Player directly — you don't use
  `<Composition>` here (that's for the Studio/render). The component and
  its props are the shared part.
- Embedding patterns (SSR, lazy-loading, state) → `react-development`.

CI pipelines that render on push/schedule → `devops-development`.
