# Visual Shaders, Performance and Debugging

## Visual shaders — when and how

A `VisualShader` is a node-graph that **compiles to the same Godot
Shading Language** as text shaders. Same `shader_type` choices
(spatial/canvas_item/particles/sky/fog), same outputs.

Prefer the visual editor for: exploration, quick artist/designer
iteration, and effects that are mostly node wiring (mixes, gradients,
fresnel, UV maths). Prefer **text `.gdshader`** for: anything
version-controlled (graphs produce large, diff-hostile `.tres`),
non-trivial control flow, reuse via `#include`, and code you'll
maintain.

- **Expression node** — drop a slab of Godot Shading Language inside a
  graph when a sub-calculation is clearer as code. The pragmatic bridge.
- **`VisualShaderNodeCustom`** — author a reusable custom node in
  GDScript/C# (`_get_name`, `_get_category`, `_get_input_port_*`,
  `_get_code`). Worth it for studio-standard nodes used across many
  graphs; overkill for one-offs.
- You can convert intent freely — read the generated code (the editor
  shows it) to learn idioms or to graduate a graph to a text shader.

## Performance playbook

Order of impact, roughly:

1. **Stage placement.** `fragment()` runs orders of magnitude more than
   `vertex()`. Interpolate via `varying` whatever you can.
2. **Texture fetches** dominate fragment cost. Minimise samples, enable
   mipmaps (`filter_*_mipmap`) to keep the cache happy, and avoid
   dependent fetches in tight loops.
3. **Screen/depth reads.** `hint_screen_texture` forces a full back-buffer
   copy (a `BackBufferCopy` in 2D); `hint_depth_texture` similarly costs.
   Sample once, reuse. Don't use them for effects a cheaper trick covers.
4. **`discard`** disables early-Z → the fragment shader runs for hidden
   pixels. Use `ALPHA_SCISSOR_THRESHOLD` instead on spatial cutouts.
5. **Overdraw.** Stacked transparent layers each run the full shader per
   pixel. Reduce transparent area, or go opaque + alpha-scissor.
6. **Branching.** Modern desktop GPUs handle uniform branches fine;
   *divergent* branches that each do texture work are the costly case.
   `mix`/`step`/`smoothstep` are often cheaper than `if`.
7. **Mobile/Compatibility.** Use precision qualifiers (`mediump` where
   safe), fewer samples, `vertex_lighting`/`unshaded` where acceptable.

## Shader compilation stutter

Godot 4 can hitch the first time a material/pipeline variant is seen
(pipeline compilation). Mitigations: keep the number of distinct
material variants down; warm shaders by instantiating the materials
during a loading screen so compilation happens off the hot path. Newer
4.x releases improved precompilation/ubershader behaviour — verify what
the project's pinned version does rather than assuming.

## Debugging shaders (no parser, you are partly blind)

- **The editor compiler is the truth.** Its errors give line and reason;
  paste-and-compile beats reasoning about syntax from memory.
- **Visualise intermediates.** Temporarily write a value to `ALBEDO`/
  `COLOR` (e.g. `ALBEDO = vec3(roughness_value);`) to *see* it. Output
  `UV` as `COLOR = vec4(UV, 0.0, 1.0)` to confirm coordinates.
- **Isolate.** Halve the shader until the artefact moves — bisecting a
  shader is faster than staring at it.
- **Check the obvious environment causes** before the maths: wrong
  renderer (compute/screen-tex), missing `BackBufferCopy`, shared
  material mutated, sRGB (`source_color`) missing, normals in the wrong
  space.
- For compute, **read back a buffer and assert** known values — that's
  the closest thing to a unit test the GPU path allows.

Boundary: profiling the wider frame (the Godot profiler, draw calls,
mesh/LOD), and CI/headless runs → `godot-development` /
`devops-development`.
