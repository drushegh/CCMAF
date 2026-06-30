# bpy Scripting

## The data model

`bpy.data` is the file: collections of data-blocks (`objects`,
`meshes`, `materials`, `images`, `collections`, `node_groups`, …).
Objects wrap data (`obj.data` is the mesh/curve/etc.); multiple
objects can share one data-block (instancing). `bpy.context` is the
UI situation (active object, selection, mode, scene) — read it,
prefer not to depend on it.

```python
import bpy

# Create, link, transform — no operators involved
mesh = bpy.data.meshes.new("ProcMesh")
mesh.from_pydata(
    [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)],   # verts
    [],                                              # edges
    [(0, 1, 2, 3)],                                  # faces
)
mesh.update()

obj = bpy.data.objects.new("Proc", mesh)
bpy.context.scene.collection.objects.link(obj)
obj.location = (0, 0, 1)

# Material with nodes
mat = bpy.data.materials.new("ProcMat")
mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.2, 0.5, 0.8, 1.0)
obj.data.materials.append(mat)
```

## Operators, context and overrides

`bpy.ops.*` calls need correct context (mode, active object, area
type). In scripts: set state explicitly
(`bpy.context.view_layer.objects.active = obj`, `obj.select_set(True)`)
and use temp overrides for area-dependent ops:

```python
with bpy.context.temp_override(active_object=obj, selected_objects=[obj]):
    bpy.ops.object.shade_smooth()
```

If an operator refuses headless, find the `bpy.data`/`bmesh`
equivalent — there usually is one.

## bmesh for mesh editing

```python
import bmesh

bm = bmesh.new()
bm.from_mesh(obj.data)
bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.02, segments=2)
bm.to_mesh(obj.data)
bm.free()
obj.data.update()
```

Object Mode only for `from_mesh/to_mesh`; in Edit Mode use
`bmesh.from_edit_mesh` + `bmesh.update_edit_mesh`. Always `free()`.

## Dependency graph (evaluated data)

Modifier/GN results require evaluation:

```python
deps = bpy.context.evaluated_depsgraph_get()
eval_obj = obj.evaluated_get(deps)
eval_mesh = eval_obj.to_mesh()        # temporary evaluated mesh
# ... read it ...
eval_obj.to_mesh_clear()
```

Use `mesh.copy()`-style ownership (`bpy.data.meshes.new_from_object`)
if you need it to persist.

## Performance

- Bulk attribute IO: `mesh.vertices.foreach_get("co", flat_array)` /
  `foreach_set` with NumPy arrays — orders of magnitude over loops.
- Geometry attributes API (`mesh.attributes`) for custom data layers.
- Disable viewport updates in long batches (run headless, or batch
  changes before `view_layer.update()`); avoid `bpy.ops` in loops.
- `bpy.app.timers` for incremental background work in UI sessions;
  never block the UI thread for minutes.

## Properties and persistence

Custom data on data-blocks: `obj["my_key"] = value` (ad-hoc ID
properties) or typed `bpy.props` on registered PropertyGroups
(`addons-extensions.md`). ID properties survive save/load — the
pipeline-friendly metadata channel.

## Handlers and app state

`bpy.app.handlers` (load_post, save_pre, frame_change_post,
depsgraph_update_post) for reactive automation — keep them fast,
re-entrant, and reference-free (re-fetch by name). Remove handlers on
unregister; use the `@persistent` decorator for handlers that must
survive file loads.

## Console-first development

`blender --python-console`, the in-app Python console
(`bpy.context` live), and Text Editor `Run Script` are the loop.
`dir()`/tooltips give API discovery; the official API docs match the
exact Blender version — keep the version-matched docs at hand
(API drift between 4.x and 5.0 is non-trivial).
