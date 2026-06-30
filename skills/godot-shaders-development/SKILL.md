---
name: godot-shaders-development
description: >-
  Godot 4.x shader programming in the Godot Shading Language (.gdshader):
  spatial, canvas_item, particles, sky and fog shaders; render modes,
  built-ins, uniforms/hints and varyings; ShaderMaterial wiring from
  GDScript/C#; visual shaders; and GLSL compute shaders via
  RenderingDevice. Use for ANY Godot shader or material-effect work —
  .gdshader/.gdshaderinc/.glsl files, shader_type/render_mode, ALBEDO/
  EMISSION/COLOR/SCREEN_UV, hint_screen_texture, set_shader_parameter,
  dissolve/outline/water/toon/forcefield effects, GPU particles process
  shaders, procedural skies, or compute/GPGPU. Trigger even when the user
  just says "make it glow", "water effect", "2D outline", or "run this on
  the GPU" in a Godot project. Adapting a 3.x shader counts — the 4.x
  renames bite.
---

# Godot Shader Development

Standards for the **Godot Shading Language** (Godot's own GLSL-derived
language) and compute GLSL, Godot 4.x. **Current stable June 2026:
4.6.3** (4.6, Jan 2026). Shader syntax is stable across 4.x but renderer
capability differs — verify the project's renderer (Forward+, Mobile, or
Compatibility) before promising a feature.

This skill owns shaders and materials-as-code. GDScript, scenes, nodes
and `ShaderMaterial` *resource* plumbing belong to `godot-development`;
browser GLSL/TSL belongs to `threejs-development`. Cross-reference, don't
duplicate.

**Verification caveat: there is no Godot shader parser in the sandbox.**
Shader code gets structural review only. The real validators are the
Godot editor's shader compiler and `RenderingDevice` at runtime — say so,
and prefer small testable shaders over big untested ones.

## Non-negotiables

1. **Write 4.x, not 3.x.** The single biggest source of broken Godot
   shaders is pasting 3.x code. The renames that bite are in
   `references/shading-language.md` — the worst offenders: `hint_color`
   → `source_color`; the `SCREEN_TEXTURE`/`DEPTH_TEXTURE` built-ins are
   gone, replaced by `uniform sampler2D x : hint_screen_texture;`;
   `set_shader_param()` → `set_shader_parameter()`; files are
   `.gdshader`, not `.shader`. If a snippet uses any of those, it is
   3.x — port it before trusting it.
2. **Pick the right `shader_type` first** — `spatial`, `canvas_item`,
   `particles`, `sky` or `fog`. It is the first line and it fixes which
   processor functions, built-ins and render modes exist. A canvas_item
   built-in in a spatial shader simply won't compile.
3. **Declare tunables as `uniform`, never hard-code.** Anything an
   artist or designer would touch (colours, speeds, strengths) is a
   `uniform` with `source_color`/`hint_range(...)` so it surfaces in the
   inspector and can be driven by `set_shader_parameter()`. Magic
   numbers buried in `fragment()` are a defect.
4. **Do work in the cheapest stage.** `vertex()` runs per-vertex,
   `fragment()` per-pixel, `light()` per-pixel *per light*. Move
   anything that can be interpolated into `vertex()` and pass it through
   a `varying`. Per-pixel maths that didn't need to be there is the
   commonest performance bug.
5. **Avoid `discard` in opaque shaders** — it disables early-depth
   rejection and forces the whole quad through. Use it only where you
   genuinely need alpha-tested cutout, and prefer
   `ALPHA_SCISSOR_THRESHOLD` on spatial materials.
6. **Screen-reading and depth-reading are not free.** `hint_screen_texture`
   forces a back-buffer copy (a `BackBufferCopy` node in 2D); sample it
   once, cache the result, and don't reach for it when a cheaper effect
   would do.
7. **Match the renderer.** Compute shaders and many advanced features
   need a `RenderingDevice` backend (Forward+ or Mobile) — they do not
   exist on the Compatibility (OpenGL/web) renderer. On Mobile/Compat,
   precision (`lowp`/`mediump`/`highp`) and texture-fetch count matter.

## Choosing a shader approach

| Want | Use | Reference |
|------|-----|-----------|
| 3D surface / material effect | `spatial` shader | `spatial-shaders.md` |
| 2D sprite/UI/tilemap effect | `canvas_item` shader | `canvas-item-shaders.md` |
| Per-particle motion/appearance | `particles` process shader | `particles-sky-fog.md` |
| Procedural sky / volumetric fog | `sky` / `fog` shader | `particles-sky-fog.md` |
| Designer-editable, exploratory | Visual Shader graph | `visual-shaders.md` |
| GPGPU / data, not drawing | GLSL compute via RenderingDevice | `compute-shaders.md` |

Text `.gdshader` is the default for anything version-controlled or
non-trivial; visual shaders suit exploration and designer handoff and
compile to the same language.

## Workflow

1. Decide `shader_type` and renderer constraints; create a `.gdshader`
   (or `.gdshaderinc` for shared chunks via `#include`).
2. Define the `uniform` interface first — it's the contract with the
   scene and with `set_shader_parameter()`.
3. Write `vertex()` → `varying` → `fragment()`; keep `fragment()` lean.
4. Wire it: `var m := ShaderMaterial.new(); m.shader = preload(
   "res://fx/water.gdshader"); $Mesh.material_override = m` (3D) or
   `.material` (2D); drive params from GDScript
   (`references/shading-language.md` has the C# equivalents and the
   `godot-development` cross-ref).
5. Validate in-editor (compiler errors are precise) and, for compute,
   read back a buffer and assert values.
6. Profile if it's hot: check the renderer, texture fetches, screen
   copies and overdraw (`visual-shaders.md` performance section).

## High-frequency pitfalls

- 3.x snippets (the rename table) — always suspect first.
- Sampling `hint_screen_texture` in a shader on a material that draws
  *before* the back-buffer copy, getting stale/black pixels — order and
  `BackBufferCopy` matter in 2D.
- Colour uniforms without `source_color`, so sRGB textures/colours come
  out washed or over-bright (the hint does the sRGB→linear conversion).
- Editing a shader but mutating a **shared** `ShaderMaterial` — every
  user of that `.tres`/`.material` changes; duplicate for per-instance
  variation, or use `instance uniform`.
- `TIME` assumed to be frame count or seconds-since-level — it's
  seconds since engine start and wraps; don't build long-period logic on
  raw `TIME`.
- Compute shader silently doing nothing because the project is on the
  Compatibility renderer (no `RenderingDevice`).
- Particle shaders written like vertex shaders — the 4.x particle model
  uses `start()`/`process()` with its own built-ins, not `vertex()`.
- Forgetting normals must be in the right space, or writing `NORMAL_MAP`
  vs `NORMAL` interchangeably (one is tangent-space map input, the other
  is the working normal).

## References

| File | Load when |
|------|-----------|
| `references/shading-language.md` | Any shader — data types, render modes, uniforms/hints, varyings, the 3.x→4.x migration table, GDScript/C# wiring |
| `references/spatial-shaders.md` | 3D materials — PBR outputs, vertex animation, depth/transparency, custom `light()` |
| `references/canvas-item-shaders.md` | 2D — sprites/UI/tilemaps, screen effects, 2D lighting, common effects |
| `references/particles-sky-fog.md` | GPU particle process shaders, procedural `sky`, `fog` volumes |
| `references/compute-shaders.md` | GLSL compute via RenderingDevice — buffers, dispatch, readback, sync |
| `references/visual-shaders.md` | Visual shader editor, custom nodes, and the performance/debugging playbook |

## Boundaries with sibling skills

- GDScript/C#, scenes, `ShaderMaterial` as a resource, `.tres` data →
  `godot-development`.
- Mesh/UV/material *authoring* and glTF import conventions →
  `blender-development`; driving Godot/Blender via MCP →
  `godot-mcp-workflow`.
- Browser GLSL/WGSL/TSL and three.js materials →
  `threejs-development` (`shaders-webgpu.md`) — different language,
  different pipeline.
- HLSL/Unreal/Unity shaders → `unity-development`,
  `unreal-engine-development`.
