---
name: comfyui-development
description: >-
  Building, automating and extending ComfyUI — the node-graph engine for
  diffusion-based image/video/audio generation. Covers the workflow
  graph and the txt2img/img2img/inpaint/ControlNet/LoRA/upscale
  pipelines, samplers/schedulers and reproducibility, custom node
  development in Python (the V3 `io.ComfyNode` schema and the still-
  supported V1 `INPUT_TYPES`/`NODE_CLASS_MAPPINGS` legacy), programmatic
  runs via the HTTP+WebSocket API and API-format workflow JSON, model
  and asset management (comfy-cli, ComfyUI-Manager, the Registry,
  extra_model_paths), and running ComfyUI for agents/MCP. Use for ANY
  ComfyUI work — a workflow `.json`, a custom node, queueing a prompt
  over the API, "generate images with ComfyUI from code", a ComfyUI MCP
  server, KSampler/checkpoint/VAE/ControlNet, or deploying ComfyUI
  headless. Trigger even when someone just says "wire up a Stable
  Diffusion / Flux pipeline" or "automate image generation" in a ComfyUI
  context.
---

# ComfyUI Development

ComfyUI (Comfy-Org) is a **node-graph** engine for diffusion model
inference: you wire nodes into a directed graph, and execution runs each
node when its inputs are ready, caching unchanged branches. It is
**model-architecture-agnostic** — the same graph model drives SD1.5,
SDXL, SD3.x, Flux and video/audio model families. It's a **rolling
release** (Vue-based frontend, the "Nodes 2.0" UI, and the V3 custom-node
schema are current in 2026) — verify the running build rather than
assuming; node availability tracks the installed model packs and custom
nodes, not a single version number.

This skill owns the ComfyUI graph, its API and node extension. General
Python idioms → `python-development`; authoring an MCP server to wrap
ComfyUI → `llm-development`; application-security depth →
`secure-development`. Cross-reference, don't duplicate.

## Non-negotiables

1. **Treat ComfyUI as untrusted-code surface.** Custom nodes are
   **arbitrary Python that runs in the server process**, and the API has
   **no authentication by default**. Never expose a ComfyUI instance to
   the public internet; vet custom nodes before installing (read the
   code / check provenance), and isolate the host. This is the dominant
   risk and a `secure-development` concern (supply chain + RCE).
2. **Automate with the API format, not the UI format.** A workflow has
   two JSON shapes: the editor graph (nodes, positions, links) and the
   **API format** (a flat map of node-id → `{class_type, inputs}`).
   Programmatic runs POST the *API format* to `/prompt`. Export it from
   the UI with **Save/Export (API Format)** — don't hand-convert the
   editor graph.
3. **Make runs reproducible and record the recipe.** Identical output
   needs the same model (and its hash/version), seed, sampler,
   scheduler, steps, CFG, denoise and node graph. Pin the seed (don't
   leave it randomised) and record the full recipe with any output you
   deliver — "looks like the reference" is not reproducible.
4. **Model and output licensing is in scope.** Checkpoints, LoRAs and
   ControlNets carry their own licences (CreativeML OpenRAIL, Flux
   non-commercial vs commercial, bespoke Civitai terms), and some
   restrict commercial use of the *model* or even the *outputs*. Verify
   the licence of every weight before using results commercially, and
   flag it — `references/models-and-management.md`.
5. **New custom nodes: V3 schema; but be fluent in V1.** Author new
   nodes with the V3 `io.ComfyNode`/`define_schema`/`comfy_entrypoint`
   API (type-safe, dynamic inputs). The V1
   `INPUT_TYPES`/`RETURN_TYPES`/`NODE_CLASS_MAPPINGS` protocol is still
   fully supported and is what nearly every existing custom node uses —
   you must read and maintain it (`references/custom-nodes.md`).
6. **Respect VRAM and determinism.** Generation is GPU/VRAM-bound;
   model choice, resolution, batch size and precision (fp16/bf16/fp8)
   decide whether it runs at all. The graph is deterministic given
   inputs — keep nodes pure; side effects belong in clearly-marked
   output nodes.

## The core text-to-image graph

The canonical pipeline every ComfyUI user must know:

`Load Checkpoint` → (`CLIP Text Encode` ×2, positive + negative) +
`Empty Latent Image` → `KSampler` (model + conditioning + latent) →
`VAE Decode` → `Save Image`.

KSampler's knobs — `seed`, `steps`, `cfg`, `sampler_name`, `scheduler`,
`denoise` — are where image character is decided. Variants (img2img,
inpainting, LoRA, ControlNet, upscaling, SDXL base+refiner) extend this
spine; see `references/generation-pipelines.md`.

## Workflow

1. **Pick the mode**: interactive (the UI), programmatic (the API), or
   agent/MCP-driven — it changes everything downstream. Confirm the host
   is not internet-exposed.
2. Build/verify the graph in the UI; confirm models exist in the right
   `models/` folders (`references/models-and-management.md`).
3. For automation, **Save (API Format)**, then parameterise the JSON
   (swap prompt text, seed, dimensions) and POST to `/prompt` with a
   `client_id`; track progress on the WebSocket
   (`references/api-automation.md`).
4. For new functionality, write a custom node (V3) rather than
   post-processing outputs (`references/custom-nodes.md`).
5. Record the full recipe (models + sampler settings + seed) alongside
   outputs.

## High-frequency pitfalls

- POSTing the **editor-graph** JSON to `/prompt` and getting validation
  errors — the API needs the **API-format** export.
- Randomised seed left in place, so "the same" run isn't reproducible.
- Missing model files: a node references a checkpoint/LoRA/VAE not in
  `models/…` → load error. Check folders, not just the graph.
- Installing custom nodes blindly via ComfyUI-Manager — that's running
  someone's Python on your machine (non-negotiable 1).
- Exposing `--listen 0.0.0.0` to a reachable network with no auth.
- Assuming a checkpoint is free to use commercially — many aren't.
- Confusing CFG (prompt adherence) with steps (denoising iterations), or
  forgetting that a `denoise` below 1.0 is what makes img2img/refiner work.
- VRAM OOM from resolution/batch — reduce, tile, or use a smaller/
  quantised model.

## References

| File | Load when |
|------|-----------|
| `references/workflow-model.md` | The graph/execution model, UI vs API JSON, the core pipeline, samplers/schedulers, latents and seeds |
| `references/generation-pipelines.md` | img2img, inpainting, LoRA, ControlNet, upscaling, SDXL/Flux/video families, conditioning |
| `references/custom-nodes.md` | Writing nodes — V3 `io.ComfyNode` schema and V1 legacy, types, output nodes, JS extensions, packaging |
| `references/api-automation.md` | `/prompt` + WebSocket, API-format workflows, parameterising/batching, the Python client pattern |
| `references/models-and-management.md` | Model types/folders, `extra_model_paths`, comfy-cli, Manager, the Registry, model licensing |
| `references/mcp-and-deployment.md` | Running headless/for agents, ComfyUI MCP servers, Docker/GPU, the security model |

## Boundaries with sibling skills

- General Python (packaging, async, testing) → `python-development`;
  custom-node Python specifics stay here.
- Building an MCP server that wraps ComfyUI → `llm-development`;
  *consuming* ComfyUI via existing MCP servers is covered here.
- Containerising/GPU hosting → `containers-development` /
  `kubernetes-development`; cloud GPU VMs → `azure-development`.
- Security depth (RCE, supply chain, threat modelling) →
  `secure-development`; the diffusion/three.js *browser* rendering world
  is unrelated.
