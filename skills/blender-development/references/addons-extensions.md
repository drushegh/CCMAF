# Add-ons and Extensions

## Extensions platform (the current standard, Blender 4.2+)

An extension = directory with `blender_manifest.toml` + Python
package, distributable via extensions.blender.org or private
repositories.

```toml
schema_version = "1.0.0"
id = "pipeline_tools"
version = "1.0.0"
name = "Pipeline Tools"
tagline = "Batch export and validation for engine pipelines"
maintainer = "Your Name <you@example.com>"
type = "add-on"
license = ["SPDX:GPL-3.0-or-later"]
blender_version_min = "4.2.0"
tags = ["Pipeline", "Import-Export"]

# Only with justification — surfaced to users at install:
# permissions = {network = "Check for updates", files = "Batch export"}

# Bundled pure-Python deps as wheels:
# wheels = ["./wheels/some_dep-1.0-py3-none-any.whl"]
```

- Validate/build: `blender --command extension validate` /
  `blender --command extension build` (produces the installable
  zip).
- Legacy `bl_info` dict add-ons still function but are the
  deprecated path — new work targets extensions; supporting both
  means keeping `bl_info` alongside a manifest.
- Bundle third-party Python deps as wheels — never pip-install into
  Blender's Python at runtime.

## Package anatomy

```
my_extension/
  blender_manifest.toml
  __init__.py          # register()/unregister() only — import modules here
  operators.py
  panels.py
  properties.py
  wheels/              # optional bundled deps
```

## Registration patterns

```python
import bpy

class OSP_OT_batch_export(bpy.types.Operator):
    bl_idname = "osp.batch_export"        # lowercase, namespaced
    bl_label = "Batch Export glTF"
    bl_options = {'REGISTER', 'UNDO'}

    scale: bpy.props.FloatProperty(name="Scale", default=1.0, min=0.01)

    @classmethod
    def poll(cls, context):
        return context.selected_objects

    def execute(self, context):
        # bpy.data-first work here
        self.report({'INFO'}, "Exported")
        return {'FINISHED'}

class OSP_PT_panel(bpy.types.Panel):
    bl_label = "Pipeline"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Pipeline"

    def draw(self, context):
        self.layout.operator("osp.batch_export")

classes = (OSP_OT_batch_export, OSP_PT_panel)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)

def unregister():
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
```

Rules: `poll()` guards context; `bl_options` `UNDO` for anything
mutating data; settings live in `PropertyGroup` registered onto
`Scene`/`Object` (`bpy.types.Scene.osp_settings =
bpy.props.PointerProperty(type=OSPSettings)`) — and removed in
`unregister()`. Modal operators for interactive tools; `invoke()` +
`window_manager.invoke_props_dialog` for confirm dialogs.

## Quality bar

- Unregister must be clean (classes, menu entries, handlers, timers,
  keymaps) — test enable/disable/re-enable cycles and script reload.
- No state in module globals that survives reload incorrectly.
- Long work: modal + progress or background process — never freeze
  the UI.
- i18n-friendly labels; tooltips on every property (they're the
  docs).
- Per-version CI: run Blender headless in CI to import the extension
  and run its tests against pinned Blender versions
  (`automation-headless.md`).
