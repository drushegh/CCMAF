# Export Pipeline to Engines

The contract: modelled-to-convention in Blender, exported with the
right preset, validated in-engine. Fix problems at the convention
level, never by per-asset hacks.

## Universal conventions (before any export)

- **Apply transforms** (Ctrl+A: rotation & scale; object scale = 1,
  rotation = 0) — unapplied scale breaks engine physics, modifiers
  and batching.
- **Real-world scale in metres** (Blender native). Unit scale 1.0.
- Sane origins (pivot where the engine should pivot), named objects/
  meshes/materials (engine-side asset names inherit them), UVs
  unwrapped and (for baking/lightmaps) a second non-overlapping UV.
- Materials: **Principled BSDF only**, image textures wired directly
  (no node spaghetti exporters can't translate); pack or
  relative-path textures; bake procedural shading to textures before
  export.
- Triangulation: let the exporter/engine triangulate consistently
  (or apply a Triangulate modifier when seams/normals matter).
- Custom normals/sharp edges intentional; Weighted Normal modifier
  for hard-surface.

## Format choice

| Target | Format | Notes |
|--------|--------|-------|
| Web/three.js | **glTF/GLB** | Native pipeline (`threejs-development`: Draco/KTX2 post-process with gltf-transform) |
| Godot | **glTF** | First-class importer |
| Unity | FBX (classic) or glTF via importer packages | FBX axis quirks below |
| Unreal | FBX (established) — Interchange now also imports glTF | Datasmith for archviz scenes |

glTF is the modern default: PBR-correct, animation-capable, open.
FBX persists for UE/Unity muscle memory and some rig/animation
workflows.

## glTF export specifics (Blender exporter)

- +Y up handled by the exporter (glTF convention) — don't pre-rotate.
- Principled BSDF maps cleanly (base colour/metallic/roughness/
  normal/emissive/alpha); use the glTF Material Output conventions
  for occlusion (or pack ORM textures downstream).
- Export selected only + custom properties as needed; compression
  (Draco) either at export or in the web build pipeline (prefer
  pipeline — keeps the source export clean).
- Animations: name actions; push NLA strips per clip; "Animation
  mode: Actions/NLA" choices decide what becomes engine clips —
  test the round trip early.

## Engine-specific gotchas

- **Unreal**: FBX at scale — Blender metres vs UE centimetres:
  export with the UE-compatible scale convention (scene unit scale
  0.01 workflow or exporter unit settings — pick ONE studio
  convention and document it); smoothing groups ON for FBX; root
  bone conventions for skeletal meshes (no extra armature root
  scaling); collision via UCX_ naming where used.
- **Unity**: FBX axis conversion shows as -89.98° rotations — the
  standard fixes (apply rotation with exporter's "apply transform"
  experimental flag, or accept Unity-side import rotation) must be a
  team convention; humanoid rigs need T-pose + Unity avatar mapping.
- **Godot**: glTF straight in; collision/occlusion via `-col`/
  `-colonly` style import hints in object names (verify current
  suffix conventions per Godot version).
- **Web**: budget-first — decimate/LOD in Blender, bake AO,
  texture sizes per `threejs-development` budgets.

## Baking (the procedural→portable bridge)

Cycles bake passes (diffuse/roughness/normal/AO/emission) to
textures for anything engines can't evaluate: procedural shaders, GN
attribute-driven looks, high→low poly normal transfers (with cage).
Margin/padding ≥8px at 1k (scale up); straight normal map format per
target (OpenGL vs DirectX green channel — engine-dependent).

## Batch export

One asset per file or collection-based export units; scripted via
`bpy.ops.export_scene.gltf(filepath=..., use_selection=True, ...)`
driven by a manifest (CSV/JSON of assets → outputs) headlessly
(`automation-headless.md`) — humans forget exporter checkboxes;
scripts don't.
