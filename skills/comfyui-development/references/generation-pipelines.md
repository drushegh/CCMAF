# Generation Pipelines Beyond txt2img

All of these extend the core spine (`workflow-model.md`). The pattern is
always: get a `LATENT` into the `KSampler`, condition it, decode it.

## img2img

Encode an input image to a latent and partially denoise it:

`Load Image` → `VAE Encode` → `KSampler` (with **`denoise` 0.3–0.8**) →
`VAE Decode`. Low denoise = stay close to the input; high = reinterpret.
This is the same lever the SDXL refiner uses.

## Inpainting / outpainting

`Load Image` + a `MASK` (from `Load Image (as Mask)`, a mask editor, or
`Pad Image for Outpainting`) → `VAE Encode (for Inpainting)` → `KSampler`
→ `VAE Decode`. Use an inpainting-capable checkpoint or the dedicated
inpaint ControlNet for clean edges; `Set Latent Noise Mask` controls
where noise is applied.

## LoRA

`Load LoRA` sits **between** the checkpoint and the sampler, patching
`MODEL` and `CLIP`:

`Load Checkpoint` → `Load LoRA` (`strength_model`, `strength_clip`) →
(encode + sample). Stack multiple `Load LoRA` nodes to combine LoRAs.
Trigger words go in the prompt. Embeddings (textual inversion) are
referenced in the prompt as `embedding:name`.

## ControlNet

Condition generation on a structural hint (pose, depth, edges, scribble):

preprocess the input (`Canny`, depth, OpenPose preprocessor — often from
a custom-node pack) → `Load ControlNet Model` → `Apply ControlNet`
(takes `CONDITIONING` + the hint `IMAGE`, outputs conditioning) →
`KSampler`. `strength` and start/end percent gate its influence. Multiple
ControlNets chain by feeding one Apply's output into the next.

## Upscaling

Two families, often combined:

- **Latent upscale + re-sample** ("hires fix"): `Upscale Latent` → a
  second `KSampler` at low `denoise` (0.3–0.5) to add detail.
- **Model/pixel upscalers**: `Load Upscale Model` (ESRGAN-family) +
  `Upscale Image (using Model)` on the decoded image.
- Tiled upscaling (tiled VAE / tiled sampling, usually custom nodes) for
  large outputs within VRAM limits.

## Model families (verify current — this space moves monthly)

- **SD1.5 / SDXL**: SDXL uses two text encoders and optionally a
  base+refiner two-stage sample. Established, well-supported.
- **SD3.x**: `Triple CLIP Loader`, separate model/VAE loaders.
- **Flux** (dev/schnell): `Load Diffusion Model` (UNet) + dual CLIP
  (CLIP-L + T5) + dedicated VAE; flux-schnell is few-step. **Mind the
  licence** — Flux dev is non-commercial unless licensed
  (`models-and-management.md`).
- **Video/audio**: AnimateDiff, SVD and newer image-to-video / text-to-
  video model packs; audio models too. Node names and required loaders
  change with each release — **verify against the installed packs**, and
  don't assert a model's capabilities/licence from memory.

## Conditioning utilities

`Conditioning (Combine)`, `(Average)`, `(Concat)` and `(Set Area)` let
you blend prompts or paint different prompts into regions — the
programmatic equivalent of regional prompting. Keep positive/negative
conditioning paths clearly separated into the sampler.
