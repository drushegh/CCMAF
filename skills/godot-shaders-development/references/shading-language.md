# Godot Shading Language — Core Reference

The Godot Shading Language is a GLSL-derived DSL compiled by the engine.
This file covers the parts common to every `shader_type`. Per-type
built-ins live in the type-specific references.

## File layout

```glsl
shader_type spatial;                 // FIRST line, mandatory
render_mode cull_disabled, blend_mix; // optional, comma-separated

uniform vec4 tint : source_color = vec4(1.0);
uniform float speed : hint_range(0.0, 10.0) = 1.0;
varying vec3 world_pos;

void vertex()   { /* per-vertex */ }
void fragment() { /* per-fragment */ }
```

Files are `.gdshader`. Shared code goes in `.gdshaderinc` included with
`#include "res://fx/common.gdshaderinc"`. Compute shaders are separate
`.glsl` files (see `compute-shaders.md`).

## Data types

`void bool int uint float`; vectors `vec2/3/4`, `ivec*`, `uvec*`,
`bvec*`; matrices `mat2/3/4`; samplers `sampler2D`, `sampler2DArray`,
`sampler3D`, `samplerCube`, plus `isampler*`/`usampler*`. Arrays are
supported (`float w[4]`). Precision qualifiers `lowp/mediump/highp`
matter on the Mobile/Compatibility renderers; default `highp` on
desktop. Swizzling (`v.xy`, `c.rgb`), and constructors
(`vec3(1.0)`, `vec4(rgb, 1.0)`) as in GLSL. Built-in functions are the
GLSL set: `mix`, `clamp`, `smoothstep`, `step`, `fract`, `mod`, `dot`,
`cross`, `normalize`, `length`, `texture`, `textureLod`, etc.

## Uniforms and hints (the artist/designer contract)

```glsl
uniform vec4 albedo : source_color;          // sRGB→linear conversion
uniform float amount : hint_range(0.0, 1.0); // inspector slider
uniform sampler2D tex : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D mask : hint_default_white;
uniform sampler2D screen : hint_screen_texture, filter_linear_mipmap;
uniform sampler2D depth : hint_depth_texture;
global uniform vec4 wind;                     // Project Settings > Shader Globals
instance uniform vec4 variant_tint;           // per-instance, no back-buffer cost
```

Texture filter hints: `filter_nearest`, `filter_linear`,
`filter_nearest_mipmap`, `filter_linear_mipmap` (+`_anisotropic`
variants). Repeat: `repeat_enable` / `repeat_disable`. Note the filter
hint is `filter_linear_mipmap` — **singular `mipmap`**; `mipmaps`
(plural) is a common typo that fails to compile.

Set from GDScript via the material, not the shader:

```gdscript
var mat := ShaderMaterial.new()
mat.shader = preload("res://fx/water.gdshader")
mat.set_shader_parameter("speed", 2.0)
$Mesh.material_override = mat            # 3D; use .material on 2D/Control
```

C#: `mat.SetShaderParameter("speed", 2.0f);`. `instance uniform`s are
set per-node with `GeometryInstance3D.set_instance_shader_parameter()`.

## Varyings

Declared at top level, written in `vertex()`, read in `fragment()`/
`light()`. Interpolated across the primitive unless qualified `flat`.

```glsl
varying vec3 world_normal;
void vertex()   { world_normal = (MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz; }
void fragment() { NORMAL = ...; }  // use world_normal here
```

## Common built-ins (all types)

`TIME` (seconds since engine start — wraps; not a frame counter),
`PI`/`TAU`/`E`, `OUTPUT_IS_SRGB` is **gone** in 4.x (output is linear,
the engine tonemaps). Coordinate matrices in 3D: `MODEL_MATRIX`,
`MODELVIEW_MATRIX`, `VIEW_MATRIX`, `INV_VIEW_MATRIX`,
`PROJECTION_MATRIX`, `INV_PROJECTION_MATRIX`.

## 3.x → 4.x migration table (check this FIRST on any pasted snippet)

| Godot 3.x | Godot 4.x |
|-----------|-----------|
| `hint_color` / `hint_albedo` | `source_color` |
| `SCREEN_TEXTURE` (built-in) | `uniform sampler2D s : hint_screen_texture;` |
| `DEPTH_TEXTURE` (built-in) | `uniform sampler2D d : hint_depth_texture;` |
| `NORMAL_TEXTURE` | `uniform sampler2D n : hint_normal_roughness_texture;` |
| `NORMALMAP` / `NORMALMAP_DEPTH` | `NORMAL_MAP` / `NORMAL_MAP_DEPTH` |
| `WORLD_MATRIX` | `MODEL_MATRIX` |
| `CAMERA_MATRIX` | `INV_VIEW_MATRIX` |
| `INV_CAMERA_MATRIX` | `VIEW_MATRIX` |
| `.shader` files | `.gdshader` |
| `material.set_shader_param()` (GDScript) | `set_shader_parameter()` |
| particle `vertex()` with `VELOCITY`/`TRANSFORM` | `start()`/`process()` model |
| `hint_range` filter on samplers (none) | explicit `filter_*` / `repeat_*` hints |

`textureLod`, `texelFetch`, screen-space derivatives (`dFdx`/`dFdy`,
`fwidth`) are available where the renderer supports them. When in doubt
about a built-in's existence for a given `shader_type`, the editor's
shader completion is authoritative — it only lists valid ones.
