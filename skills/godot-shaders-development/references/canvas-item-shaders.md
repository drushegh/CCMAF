# Canvas Item (2D) Shaders

`shader_type canvas_item;` — the default for everything 2D: `Sprite2D`,
`TextureRect`, `TileMapLayer`, `Control`, `Polygon2D`, `Line2D`.
Processor functions: `vertex()`, `fragment()`, `light()`.

## Built-ins that matter

`fragment()`: `COLOR` (in/out — starts as the node's modulated texel,
you write the final), `UV`, `TEXTURE` (the node's `sampler2D`),
`TEXTURE_PIXEL_SIZE` (1/texture-size, for neighbour sampling),
`SCREEN_UV`, `SCREEN_PIXEL_SIZE`, `MODULATE` (the node's modulate
colour), `AT_LIGHT_PASS`, `TIME`. `vertex()`: `VERTEX` (2D local pos),
`UV`, `COLOR`.

The default `fragment()` is effectively `COLOR = texture(TEXTURE, UV) *
MODULATE` — so reading `TEXTURE`/`UV` and writing `COLOR` is the bread
and butter.

## Sampling neighbours (outlines, blurs, edge detect)

Use `TEXTURE_PIXEL_SIZE` to step exactly one texel:

```glsl
shader_type canvas_item;
uniform vec4 line_color : source_color = vec4(0,0,0,1);
uniform float thickness : hint_range(0,8) = 1.0;
void fragment() {
    vec2 px = TEXTURE_PIXEL_SIZE * thickness;
    float a  = texture(TEXTURE, UV).a;
    float up = texture(TEXTURE, UV + vec2(0.0,  px.y)).a;
    float dn = texture(TEXTURE, UV + vec2(0.0, -px.y)).a;
    float lf = texture(TEXTURE, UV + vec2(-px.x, 0.0)).a;
    float rt = texture(TEXTURE, UV + vec2( px.x, 0.0)).a;
    float edge = clamp(up+dn+lf+rt, 0.0, 1.0) * (1.0 - a);
    COLOR = mix(texture(TEXTURE, UV), line_color, edge);
}
```

This works because sprite import enables a small margin; for tightly
packed atlases the outline can bleed — expand the region or sample with
clamped UVs.

## Screen-space effects (2D)

Reading `hint_screen_texture` in 2D requires a `BackBufferCopy` node
*above* the shaded node in the tree (set its rect/Full), or the back
buffer is empty/stale. This is the classic "my 2D distortion is black"
bug — it's draw order, not the shader.

```glsl
uniform sampler2D screen_tex : hint_screen_texture;
void fragment() {
    vec2 d = vec2(sin(UV.y*40.0 + TIME*5.0))*0.005;  // heat-haze
    COLOR = texture(screen_tex, SCREEN_UV + d);
}
```

## 2D lighting

With `Light2D` nodes, `light()` lets you customise the response.
Built-ins: `LIGHT` (rgba light at fragment), `LIGHT_COLOR`,
`LIGHT_ENERGY`, `NORMAL` (from a normal map texture on the node), `UV`,
`SHADOW_MODULATE`. Write `LIGHT`:

```glsl
void light() {
    float ndl = dot(normalize(NORMAL.xy), normalize(LIGHT_VEC));
    LIGHT = texture(TEXTURE, UV) * LIGHT_COLOR * LIGHT_ENERGY * max(ndl, 0.0);
}
```

(Use normal-map textures on the `Sprite2D`/`CanvasTexture` for 2D
normals.)

## Common 2D effects (recipes to reach for)

- **Dissolve**: threshold a noise texture against a `progress` uniform;
  add an emissive edge band with two `smoothstep`s.
- **Flash/hit**: `mix(COLOR.rgb, flash_color, flash_amount)` driven by a
  tween on `set_shader_parameter`.
- **Palette swap**: index a 1×N palette texture by the red channel.
- **Scrolling / parallax**: offset `UV` by `TIME * speed` with
  `repeat_enable`.

Keep these as `uniform`-driven so the same shader serves many sprites;
drive `progress`/`flash_amount` from GDScript tweens
(`godot-development`).

Boundary: the node tree, `CanvasGroup`, and tween/animation wiring →
`godot-development`.
