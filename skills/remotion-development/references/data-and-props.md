# Data-Driven Video: Input Props, Schemas and Metadata

The payoff of programmatic video: the same composition renders thousands
of variants from data (personalised intros, per-record summaries,
data-viz from an API). This is done with **input props**.

## Input props

Props passed into a composition's component at render time, overriding
`defaultProps`.

- CLI: `npx remotion render MyVideo out.mp4 --props='{"name":"Ada"}'`
  or `--props=./data.json`.
- SSR/Lambda: the `inputProps` argument to `renderMedia` /
  `renderMediaOnLambda`.
- Player: the `inputProps` prop.
- Read them as the component's props, or via `getInputProps()` outside a
  component.

**Props must be JSON-serialisable** — they cross a process (SSR) or
network (Lambda) boundary. No functions, class instances, or `Date`
objects; pass an ISO string and parse it inside.

## Type the schema with zod

Define a zod schema so (a) renders are validated and (b) the Studio
generates a visual props editor:

```tsx
import { z } from "zod";
import { Composition } from "remotion";
import { zColor } from "@remotion/zod-types";

export const myVideoSchema = z.object({
  title: z.string(),
  accent: zColor(),
  items: z.array(z.object({ label: z.string(), value: z.number() })),
});

<Composition
  id="MyVideo"
  component={MyVideo}
  schema={myVideoSchema}
  defaultProps={{ title: "Q1", accent: "#FF9E18", items: [] }}
  fps={30} width={1920} height={1080} durationInFrames={150}
/>;
```

The component types its props as `z.infer<typeof myVideoSchema>`.
`@remotion/zod-types` adds video-aware types (`zColor`, `zTextarea`).

## calculateMetadata — dynamic duration, dimensions and data

When duration/size depend on the data, or you need to fetch once before
rendering, use `calculateMetadata` on the `<Composition>`:

```tsx
<Composition
  id="MyVideo"
  component={MyVideo}
  schema={myVideoSchema}
  defaultProps={{ src: "" }}
  calculateMetadata={async ({ props }) => {
    const data = await fetch(props.src).then((r) => r.json());
    return {
      durationInFrames: data.scenes.length * 90,  // data-driven length
      props: { ...props, data },                  // inject fetched data
      // width/height/fps can also be returned
    };
  }}
  fps={30} width={1920} height={1080} durationInFrames={1}
/>
```

- Runs once per render (not per frame) — the right place for fetches,
  `parseMedia()` to read a video's real duration/dimensions, etc.
- Return `props` to pass enriched data down, so components don't fetch
  during render (keeps render deterministic — `animation.md`).

## Batch / personalised rendering at scale

- Drive a loop (or Lambda concurrency) over your dataset, passing each
  record as `inputProps`; render IDs/output keys per record.
- Keep payloads small — Lambda has input-props size limits; for large
  data, pass a reference (URL/key) and fetch in `calculateMetadata`.
- Make output paths deterministic and idempotent so re-runs don't
  duplicate.
- Untrusted input props (user-supplied) are a security surface — treat
  as untrusted input, validate with the schema, beware SSRF in
  `calculateMetadata` fetches (`secure-development`).

Rendering mechanics (CLI/SSR/Lambda) → `rendering-and-player.md`.
