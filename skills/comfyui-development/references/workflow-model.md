# The Workflow Graph, Execution and the Core Pipeline

## How the graph executes

A ComfyUI workflow is a directed graph of nodes. Each node declares typed
inputs and outputs; an edge connects an output socket to a compatible
input socket. On execution ComfyUI topologically orders the graph and
runs each node when its inputs are ready. It **caches** node outputs and
only re-runs a node if its inputs (or its `IS_CHANGED` signal) changed —
so tweaking the prompt re-runs the sampler but not the checkpoint load.

Sockets are typed (`MODEL`, `CLIP`, `VAE`, `CONDITIONING`, `LATENT`,
`IMAGE`, `MASK`, plus primitives `INT`/`FLOAT`/`STRING`). Types must
match to connect — this is the main correctness guardrail.

## Two JSON formats — know which is which

- **Editor/graph format**: what the UI saves by default — includes node
  positions, link IDs, UI state. For humans and the editor.
- **API format**: a flat object keyed by node ID, each
  `{ "class_type": "...", "inputs": {...} }`, where an input is either a
  literal or a `[from_node_id, output_index]` reference. This is what the
  `/prompt` endpoint consumes.

Get the API format via **Save (API Format)** / **Export (API Format)** in
the UI (enable dev mode if the option is hidden). Automation always uses
this shape (`api-automation.md`).

```jsonc
// API-format fragment
"3": { "class_type": "KSampler",
       "inputs": { "seed": 42, "steps": 20, "cfg": 7.0,
                   "sampler_name": "dpmpp_2m", "scheduler": "karras",
                   "denoise": 1.0,
                   "model": ["4", 0], "positive": ["6", 0],
                   "negative": ["7", 0], "latent_image": ["5", 0] } }
```

## The canonical text-to-image pipeline

| Node | Role |
|------|------|
| `Load Checkpoint` | loads `MODEL`, `CLIP`, `VAE` from one `.safetensors` |
| `CLIP Text Encode` (×2) | encode positive and negative prompts → `CONDITIONING` |
| `Empty Latent Image` | blank `LATENT` at the target width/height (+ batch size) |
| `KSampler` | denoises the latent under the conditioning |
| `VAE Decode` | `LATENT` → `IMAGE` |
| `Save Image` / `Preview Image` | write/preview the result (an OUTPUT node) |

Diffusion happens in **latent space** (≈1/8 resolution); the VAE encodes
to / decodes from pixels. SDXL/Flux and newer models split this
differently (separate UNet/diffusion-model, dual CLIP, dedicated VAE
loaders) — see `generation-pipelines.md`.

## Samplers, schedulers and the key knobs

- **`steps`** — denoising iterations (more ≠ always better; many
  samplers converge by ~20–30).
- **`cfg`** — classifier-free guidance: how strongly the prompt
  constrains the image (too high = burnt/over-saturated).
- **`sampler_name`** — e.g. `euler`, `euler_ancestral`, `dpmpp_2m`,
  `dpmpp_2m_sde`, `dpmpp_3m_sde`, `uni_pc`, `ddim`, `lcm` (LCM/turbo/
  lightning models want very low steps + low cfg).
- **`scheduler`** — noise schedule: `normal`, `karras`, `exponential`,
  `sgm_uniform`, `simple`, `beta`, `ddim_uniform`.
- **`denoise`** — 1.0 for txt2img; **<1.0** is the lever for img2img and
  refiners (how much of the input latent to keep).

## Seeds and reproducibility

The `seed` plus all the above plus the exact models determine the output.
Pin the seed for reproducible work; "randomize" is for exploration.
Record the whole recipe (model + hashes, sampler settings, seed, graph)
with any delivered image — it's the only way to regenerate it.
