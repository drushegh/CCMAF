# Asset Pipeline: Blender → glTF → Godot

The supported, low-friction path for 3D assets is **glTF 2.0**
(`.glb` binary preferred, `.gltf` + textures also fine). Godot imports
it natively; Blender exports it well. Avoid `.blend`-into-Godot and FBX
unless you have a specific reason — glTF is the conventions-aligned
route. Mechanics of the Blender export live in `blender-development`
(`export-pipeline.md`); this file is the MCP-driven workflow around it.

## End-to-end with the two servers

1. **Blender (blender-mcp):** `get_scene_info`, source/generate the
   asset via `asset_creation_strategy`, then **`get_viewport_screenshot`
   to confirm** it looks right and `get_object_info`/`world_bounding_box`
   to confirm size. This is the one stage where you have eyes — use
   them.
2. **Prepare for export** (via `execute_blender_code`): apply
   transforms, sane names, one logical object/collection, materials
   using the Principled BSDF (glTF maps it to Godot's PBR), reasonable
   poly count.
3. **Export glTF** to a path inside the Godot project (e.g.
   `res://assets/models/`).
4. **Godot:** the engine auto-imports on focus/scan; assemble the
   imported scene into your gameplay scene (instance it, add collision),
   then `run_project` + `get_debug_output`.

## Conventions that bite

- **Up axis & handedness.** Blender is **Z-up**, Godot is **Y-up**. The
  glTF exporter performs the axis conversion (glTF is Y-up) — let it;
  don't pre-rotate in Blender to "fix" it or you'll double-correct.
- **Scale / units.** Unapplied object scale exports as-is and lands
  wrong in Godot. **Apply transforms** (scale especially) before export.
  1 Blender metre = 1 Godot unit when units are set sensibly.
- **Origin / pivot.** Set the object origin where you want Godot's
  transform pivot (feet for a character, base for a prop) before export
  — re-homing it after import is fiddly.
- **Materials & textures.** Principled BSDF transfers; procedural
  Blender node materials do **not** — bake them to textures first.
  Prefer packed `.glb` (textures embedded) for portability, or keep an
  organised external texture folder.
- **Normals & smoothing.** Export normals; check shading in Godot — bad
  custom split normals show as faceting or seams.
- **Collision is Godot's job.** glTF carries the visual mesh; build
  `CollisionShape3D`/static bodies in Godot (or use Godot's
  `-col`/`-convcol` import name suffixes), not in Blender.

## Generated-asset specifics (Hyper3D / Hunyuan3D / Sketchfab)

- Generated models are **normalised in size** — rescale on purpose;
  check `world_bounding_box` after import into Blender, again after
  export into Godot.
- Generated meshes can be heavy/messy topology — for anything reused at
  scale, decimate/retopo in Blender before export.
- Sketchfab assets carry **licences** — record the source and licence;
  not everything downloadable is cleared for a shipped product
  (`secure-development` / legal). Flag licence provenance to the user
  rather than assuming it's fine.

## Re-import and iteration

- Changing the source file and re-exporting to the same path triggers a
  Godot re-import; instances update. Keep the export path stable so you
  don't orphan references.
- Don't edit the imported scene's mesh in Godot and expect it to survive
  a re-import — treat Blender as the source of truth for geometry and
  Godot as the source of truth for scene composition, collision and
  logic.
- Keep large binaries out of casual commits — decide `.gitignore` for
  raw `.blend` and bulky `.glb` deliberately (`pitfalls-and-safety.md`).
