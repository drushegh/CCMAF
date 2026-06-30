# Models, Assets and Environment Management

## Model types and where they live

ComfyUI loads weights from `ComfyUI/models/<subfolder>/`. The ones you'll
handle:

| Subfolder | Holds |
|-----------|-------|
| `checkpoints` | full models (UNet+CLIP+VAE bundled) — SD1.5/SDXL/SD3 etc. |
| `diffusion_models` / `unet` | bare diffusion models (e.g. Flux) loaded with separate CLIP/VAE |
| `clip` / `text_encoders` | text encoders (CLIP-L/G, T5) for split models |
| `vae` | standalone VAEs |
| `loras` | LoRA / LyCORIS adapters |
| `controlnet` | ControlNet models |
| `upscale_models` | ESRGAN-family upscalers |
| `embeddings` | textual-inversion embeddings (used as `embedding:name`) |
| `clip_vision`, `ipadapter`, `style_models` | IP-Adapter / vision conditioning |

Files are typically `.safetensors` (prefer over `.ckpt` — pickles can
execute code on load; another supply-chain reason to use safetensors).

## Sharing models across installs — extra_model_paths.yaml

Don't duplicate large weights. Copy `extra_model_paths.yaml.example` to
`extra_model_paths.yaml` and point ComfyUI at an existing model library
(e.g. an A1111 install or a shared drive):

```yaml
my_models:
  base_path: D:/ai/models/
  checkpoints: checkpoints/
  loras: loras/
  vae: vae/
```

## Tooling

- **comfy-cli** — the official CLI: `comfy install` (set up ComfyUI),
  `comfy model download`, `comfy node install/registry`, `comfy launch`.
  The cleanest scriptable/CI path.
- **ComfyUI-Manager** — in-UI install of custom nodes and models, with a
  "missing nodes" resolver for imported workflows. Convenient, and the
  main vector for running untrusted code — vet before installing
  (`mcp-and-deployment.md`, `secure-development`).
- **Comfy Registry** (registry.comfy.org) — the package index custom
  nodes publish to; Manager and comfy-cli install from it.

## Model licensing — verify before commercial use

This is a real obligation, not housekeeping. Weights carry licences that
the *images you generate* may inherit or be restricted by:

- **CreativeML OpenRAIL-M** (many SD checkpoints) — permissive with
  use-based restrictions.
- **Flux** — `schnell` is Apache-2.0; **`dev` is non-commercial** unless
  you hold a commercial licence from Black Forest Labs.
- **Civitai / community checkpoints & LoRAs** — bespoke, varied terms;
  some forbid commercial use, model merging, or selling outputs.

Before delivering generated assets commercially, confirm the licence of
**every** weight in the graph (base model, each LoRA, ControlNet) and
record it. When unsure, flag it rather than assuming — for client
work this is the difference between a usable asset and a liability.

## Practical environment notes

- VRAM is the binding constraint; quantised (fp8/GGUF) variants trade
  quality for fitting on smaller GPUs. ComfyUI offloads to CPU/RAM when
  short, at a speed cost.
- Pin a Python venv; ComfyUI + custom nodes are sensitive to torch/CUDA
  versions. Containerising → `containers-development`.
- Keep `models/` out of git (huge binaries); track only workflows and
  node code.
