# Geometry Nodes (knowledge level)

Conceptual reference for advising on and structuring GN work — node
graphs are built in the UI (or generated via the node API); exact
node names/sockets drift across versions, so verify in the target
Blender version before scripting node trees.

## Mental model

- A GN modifier evaluates a **node group**: geometry flows through;
  **fields** (grey diamond sockets) are functions evaluated per
  element (point/edge/face/instance) in a context — the core
  abstraction.
- **Attributes** carry data on geometry domains (position, normals,
  UVs, custom named attributes); Capture Attribute / Store Named
  Attribute move values across domains and to downstream consumers
  (materials read named attributes!).
- **Instances** are lightweight references — instance-on-points
  scattering stays cheap until realised; Realize Instances converts
  (and pays memory) only when per-instance geometry edits are needed.
- Group inputs become modifier-panel controls — that's the
  art-directability contract: expose few, well-named, sensibly-
  ranged inputs.

## Blender 5.0 additions (Mar 2026)

Volumes and **SDF nodes** entered Geometry Nodes — signed-distance-
field modelling (booleans/blends without mesh topology pain) and
volume workflows. Treat as current-version features; check exact
node availability in the deployed version before designing around
them.

## When GN vs Python (bpy)

| Choose | When |
|--------|------|
| **Geometry Nodes** | Procedural geometry that artists tune live (scatter, arrays, parametric assets), non-destructive setups, per-frame procedural animation |
| **Python** | Pipeline logic (IO, batch, naming, validation), data-driven generation from external sources (JSON/DB/API), anything orchestrating multiple files |
| **Both** | Python builds/configures GN setups (instantiate node group, set inputs per asset) — `modifier = obj.modifiers.new(type='NODES', name=...)`; `modifier.node_group = bpy.data.node_groups[...]`; inputs via `modifier["Socket_X"]` identifiers |

## Patterns that hold across versions

1. **Scatter**: Distribute Points on Faces → (density by
   texture/vertex-group field) → Instance on Points → random
   rotation/scale via random value fields → optional Realize.
2. **Parametric asset**: group inputs (dimensions, counts, seeds) →
   primitives + transforms → Store Named Attribute for material
   variation → asset-mark the node group for reuse.
3. **Selection-driven effects**: compare/position/proximity fields
   producing boolean selections feeding Delete/Transform/material
   assignment.
4. **Mesh→curve→mesh round trips** for cables, trims, profiles
   (Curve to Mesh with profile curve).
5. **Simulation zones** (4.x+) for stateful per-frame effects
   (growth, trails) — bake before export.

## Pipeline implications

- GN output is evaluated geometry: exporters see it (glTF/FBX export
  the evaluated mesh), but **instances** may need realising —
  check exporter behaviour, or apply the modifier for engine-bound
  static meshes.
- Named attributes can travel to engines via colour attributes/UVs
  when targets don't read custom attributes — plan the channel
  mapping (`export-pipeline.md`).
- Heavy GN setups in scene files kill team file-open times — link
  node groups from asset libraries rather than duplicating.
- Version-pin files using bleeding-edge nodes; a 5.0 SDF setup does
  not open meaningfully in 4.5 LTS.

## Asset libraries

Mark node groups/objects/materials as Assets; team asset libraries
(shared paths configured in Preferences) + linked (not appended)
node groups give central updates — the maintainable way to ship GN
tooling to artists, alongside (not instead of) extensions.
