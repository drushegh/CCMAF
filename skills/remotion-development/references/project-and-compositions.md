# Project Structure, Compositions and the Studio

## Anatomy of a Remotion project

```
remotion.config.ts        # render/Studio config (NOT runtime props)
src/
  index.ts                # entry: registerRoot(RemotionRoot)
  Root.tsx                # lists every <Composition>
  MyVideo.tsx             # a composition's React component
public/                   # static assets, reached via staticFile()
```

`src/index.ts`:

```ts
import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";
registerRoot(RemotionRoot);
```

Scaffold a fresh project with `npm create video@latest`, or add Remotion
to an existing React app (`@remotion/cli`, `remotion`, plus the
`@remotion/*` packages you need).

## The Composition

A composition is the unit you render: a component + dimensions + fps +
duration + an `id`.

```tsx
import { Composition } from "remotion";
import { MyVideo } from "./MyVideo";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="MyVideo"                 // referenced on the CLI
      component={MyVideo}
      durationInFrames={150}        // 5s at 30fps
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ title: "Hello" }}
    />
  </>
);
```

- `id` is how you target it: `npx remotion render MyVideo out.mp4`.
- `defaultProps` are the starting input props (and what the Studio shows
  first). Keep them JSON-serialisable.
- For dynamic dimensions/duration or data fetching, use
  `calculateMetadata` instead of static numbers
  (`data-and-props.md`).
- A 1-frame composition is a `<Still>` — for images (thumbnails, OG
  images, posters). Render with `npx remotion still`.

Inside the component, read config from the hook, never re-declare it:

```tsx
import { useVideoConfig } from "remotion";
const { width, height, fps, durationInFrames } = useVideoConfig();
```

## The Studio

`npx remotion studio` launches the local Studio: live preview, timeline
scrubbing, a props editor (driven by your zod schema —
`data-and-props.md`), and a render button. It's the primary feedback
loop — an agent that can't see the preview should still expect the
human to drive the Studio for visual sign-off.

## remotion.config.ts (config vs props — don't confuse them)

`remotion.config.ts` configures the **renderer and Studio** (image
format, codec defaults, overwrite, webpack overrides, public dir). It is
**not** where per-video data goes — that's input props. Common entries:

```ts
import { Config } from "@remotion/cli/config";
Config.setVideoImageFormat("jpeg");
Config.setConcurrency(8);
Config.overrideWebpackConfig((c) => c); // e.g. add Tailwind, aliases
```

CLI flags override config; input props override `defaultProps`. Keep the
mental model: *config = how to render*, *props = what to render*.

See also `/docs/the-fundamentals` and `/docs/terminology/composition`.
