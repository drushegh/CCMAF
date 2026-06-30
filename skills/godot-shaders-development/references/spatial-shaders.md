# Spatial (3D) Shaders

`shader_type spatial;` — drives 3D surfaces fed into Godot's PBR
lighting. Processor functions: `vertex()`, `fragment()`, `light()`
(custom lighting), plus optional `start()` is not used here.

## The PBR output model

You don't compute final colour in `fragment()` — you write **material
properties** and the engine lights them. Key outputs:

| Output | Meaning |
|--------|---------|
| `ALBEDO` | base colour (linear) |
| `METALLIC` | 0 dielectric … 1 metal |
| `ROUGHNESS` | 0 mirror … 1 diffuse |
| `SPECULAR` | dielectric reflectance (default 0.5) |
| `NORMAL_MAP` | tangent-space normal map *input* (engine resolves) |
| `NORMAL` | working normal in view space (write directly for custom) |
| `EMISSION` | added, unlit — for glow (with WorldEnvironment glow) |
| `ALPHA` | transparency; triggers the transparent pipeline when < 1 |
| `ALPHA_SCISSOR_THRESHOLD` | alpha-tested cutout without `discard` |
| `RIM`, `CLEARCOAT`, `ANISOTROPY`, `AO`, `BACKLIGHT`, `SSS_STRENGTH` | extended PBR |

Common inputs in `fragment()`: `UV`, `UV2`, `COLOR` (vertex colour),
`VERTEX` (view-space position), `NORMAL`, `TANGENT`, `BINORMAL`, `VIEW`,
`FRONT_FACING`, `SCREEN_UV`, `FRAGCOORD`, `TIME`.

## render_mode (spatial) — the high-value ones

`unshaded` (ignore lighting, write ALBEDO straight), `cull_back`/
`cull_front`/`cull_disabled`, `depth_draw_opaque`/`_always`/`_never`,
`depth_prepass_alpha` (fixes sorting on alpha-tested foliage),
`depth_test_disabled` (overlays), `blend_mix`/`_add`/`_sub`/`_mul`,
`diffuse_lambert`/`_burley`/`_toon`, `specular_schlick_ggx`/`_toon`/
`_disabled`, `world_vertex_coords` (interpret `VERTEX` in world space in
`vertex()`), `shadows_disabled`, `ambient_light_disabled`,
`vertex_lighting` (cheap, mobile).

## Vertex animation

`vertex()` inputs/outputs include `VERTEX`, `NORMAL`, `TANGENT`, `UV`,
`COLOR`, `MODELVIEW_MATRIX`, `MODEL_MATRIX`, `INSTANCE_CUSTOM`. Animate
position there and pass data to `fragment()` via varyings:

```glsl
uniform float amplitude : hint_range(0.0, 1.0) = 0.1;
void vertex() {
    VERTEX.y += sin(TIME * 2.0 + VERTEX.x * 4.0) * amplitude; // wind/wave
}
```

For world-space effects use `MODEL_MATRIX` or `world_vertex_coords`.
Recompute or perturb `NORMAL` if the displacement is steep, or lighting
goes wrong.

## Transparency, depth and screen reading

Writing `ALPHA < 1.0` moves the material to the transparent queue
(sorted back-to-front, no depth write by default → sorting artefacts).
Prefer `ALPHA_SCISSOR_THRESHOLD` for foliage/fences (stays opaque,
sorts correctly). To read what's behind a surface (refraction, glass):

```glsl
uniform sampler2D screen_tex : hint_screen_texture, filter_linear_mipmap;
void fragment() {
    vec2 ofs = NORMAL.xy * 0.05;          // distort by surface normal
    ALBEDO = texture(screen_tex, SCREEN_UV + ofs).rgb;
}
```

Depth-based effects (soft particles, intersection highlights) sample
`hint_depth_texture` and reconstruct linear depth from
`INV_PROJECTION_MATRIX` — see the Godot docs' "Advanced post-processing"
for the reconstruction maths; get the matrix conventions right or the
depth comes out non-linear.

## Custom lighting

`light()` runs per-pixel per-light. Use it for toon ramps, wraps, or
stylised lighting. Inputs include `LIGHT`, `LIGHT_COLOR`, `ATTENUATION`,
`NORMAL`, `VIEW`, `ALBEDO`; you accumulate into `DIFFUSE_LIGHT` /
`SPECULAR_LIGHT`:

```glsl
void light() {
    float ndl = dot(NORMAL, LIGHT);
    float ramp = smoothstep(0.0, 0.01, ndl);     // hard toon edge
    DIFFUSE_LIGHT += ALBEDO * LIGHT_COLOR * ATTENUATION * ramp;
}
```

`next_pass` (set on the material in GDScript/inspector) chains a second
shader over the same geometry — the idiomatic way to layer e.g. a base
PBR pass and a fresnel rim pass without one mega-shader.

Boundary: assigning the material, animating `set_shader_parameter` over
time, and `.tres` material data → `godot-development`.
