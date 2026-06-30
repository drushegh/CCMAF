---
name: blender-development
description: >-
  Blender development knowledge layer: bpy Python scripting (data-block
  model, operators, dependency graph, headless automation), add-on and
  extension development (blender_manifest.toml platform), Geometry Nodes
  concepts, and the asset export pipeline to engines (glTF/FBX conventions
  for Unreal, Unity, Godot and the web). Use for ANY work involving
  Blender scripting, bpy, Blender add-ons/extensions, geometry nodes,
  .blend automation, or exporting Blender assets to game engines and
  three.js.
---

# Blender Development

The knowledge layer for Blender scripting, extension development and
asset pipelines. **Operational tooling note**: this Cowork environment
has the `blender-toolkit` plugin (WebSocket live control of a running
Blender, Mixamo retargeting) — use THAT for hands-on scene manipulation
tasks; use THIS skill for writing bpy code, building add-ons and
designing pipelines. They complement, not compete.

## Version state (June 2026 — verify on blender.org)

**Blender 5.0 released 17 March 2026** (ACES colour pipelines/HDR,
Geometry Nodes volume + SDF nodes, VFX Reference Platform 2025
alignment). **4.5 LTS** is the last 4.x LTS (supported to July 2027) —
the sensible pin for long-running pipelines. The **Extensions
platform** (`blender_manifest.toml`, extensions.blender.org) is the
packaging standard since 4.2; legacy `bl_info` add-ons still load but
new work targets extensions. Pin and state the target version in any
add-on or pipeline you build — API drift between minor versions is
real.

## Non-negotiables

1. **`bpy.data` over `bpy.ops` wherever possible.** Operators depend
   on context (selection, active object, area) and are brittle in
   scripts/headless; direct data manipulation is explicit and fast:

```python
import bpy

mesh = bpy.data.meshes.new("GridMesh")
obj = bpy.data.objects.new("Grid", mesh)
bpy.context.collection.objects.link(obj)   # linking is explicit
```

   When an operator is unavoidable, use `context.temp_override(...)`
   to supply the context it needs instead of poking
   `bpy.context` globals.
2. **Data-blocks have users**: meshes/materials/images persist or
   vanish by reference counting (orphans purge on save). Creating an
   object ≠ adding it to the scene — link to a collection. Removing:
   `bpy.data.objects.remove(obj, do_unlink=True)`.
3. **Don't hold references across undo/redo or file loads** —
   Python references to freed data-blocks crash. Re-fetch by name;
   in handlers (`bpy.app.handlers`) treat all prior references as
   stale.
4. **Evaluated vs original data**: modifiers/geometry nodes results
   live on the evaluated object —
   `obj.evaluated_get(depsgraph)` (`bpy-scripting.md`); reading
   `obj.data` gives the un-evaluated original.
5. **Performance**: never per-vertex Python loops where
   `foreach_get/foreach_set` + NumPy work; batch `bmesh` edits; keep
   UI (panel `draw()`) code allocation-free.
6. **Units and axes are pipeline contracts**: Blender is Z-up,
   metres, -Y forward; every engine differs — fix it in EXPORT
   settings/conventions, not by rotating meshes ad hoc
   (`export-pipeline.md`).
7. **Extensions**: declare everything in `blender_manifest.toml`
   (id, version, blender_version_min, permissions, wheels for
   bundled deps); no network access without the permission flag;
   test with `blender --command extension validate`.

## Workflow

- **Scripting tasks**: prototype in the interactive console/Text
  Editor → harden into `bpy.data`-first functions → headless run via
  `blender -b file.blend -P script.py -- args`
  (`references/automation-headless.md`).
- **Add-on/extension**: scaffold manifest + package layout →
  operators (`bpy.types.Operator`) + panels + PropertyGroups →
  register/unregister cleanly → validate + build with the extension
  CLI (`references/addons-extensions.md`).
- **Asset pipeline**: model to convention (scale applied, named,
  UV'd) → materials Principled-BSDF-only for export → bake what the
  target can't read → glTF (web/Godot) or FBX (UE/Unity legacy
  flows) with per-engine presets → validate in-engine
  (`references/export-pipeline.md`).
- **Procedural modelling**: Geometry Nodes first for art-directable
  procedural content; Python for pipeline/batch logic; both for
  generated-then-tweaked workflows (`references/geometry-nodes.md`).

## High-frequency pitfalls

- Scripts that work in the UI but fail headless (context-dependent
  `bpy.ops`, missing window/area assumptions).
- Forgetting `mesh.update()`/`bmesh.to_mesh()` flushes; or editing a
  mesh while in Edit Mode from Python (toggle object mode first).
- Add-ons leaking handlers/timers after unregister; duplicate
  registration on reload — guard with try/unregister patterns.
- Modified scale/rotation not applied before export (engine physics
  and modifiers misbehave downstream).
- Image/texture paths absolute to one machine — pack or use
  relative paths in pipelines.
- Assuming GN node names/sockets stable across versions — they
  rename; version-gate node-tree-building scripts.

## References

| File | Load when |
|------|-----------|
| `references/bpy-scripting.md` | Writing any bpy code — data model, depsgraph, performance |
| `references/addons-extensions.md` | Add-on/extension structure, registration, packaging |
| `references/geometry-nodes.md` | Procedural modelling concepts, GN vs Python decisions |
| `references/export-pipeline.md` | glTF/FBX export conventions per target engine |
| `references/automation-headless.md` | Batch/CLI/CI rendering and processing |

## Boundaries with sibling skills

- Live scene manipulation in THIS environment → `blender-toolkit`
  plugin (operational layer).
- Consuming exported assets: `threejs-development` (web),
  `unreal-engine-development`, `unity-development`,
  `godot-development`.
- General Python idioms → `python-development`; bpy specifics stay
  here.
