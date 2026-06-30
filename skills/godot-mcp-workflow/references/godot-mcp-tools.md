# godot-mcp Tool Reference (@coding-solo/godot-mcp)

Source: github.com/Coding-Solo/godot-mcp (MIT), installed via
`npx @coding-solo/godot-mcp`. Install in Claude Code:
`claude mcp add godot -- npx @coding-solo/godot-mcp`. Optional env:
`GODOT_PATH` (explicit Godot executable; otherwise auto-detected),
`DEBUG=true` (server-side logging).

**Verify the live tool list** from the running server — this reflects
the surface as of mid-2026; servers evolve.

## Tools (14)

| Tool | Does | Key params |
|------|------|------------|
| `launch_editor` | Opens the Godot editor for a project | `projectPath` |
| `run_project` | Runs the project in **debug** mode | `projectPath`, optional `scene` |
| `get_debug_output` | Returns captured stdout/stderr + errors of the running project | — |
| `stop_project` | Stops the running project | — |
| `get_godot_version` | Installed Godot version | — |
| `list_projects` | Finds Godot projects under a directory | `directory` |
| `get_project_info` | Project structure/metadata | `projectPath` |
| `create_scene` | New scene with a given root node type | `projectPath`, `scenePath`, `rootNodeType` |
| `add_node` | Adds a node to a scene with properties | `scenePath`, `nodeType`, `nodeName`, `properties` |
| `load_sprite` | Loads a texture into a `Sprite2D` | `scenePath`, `nodePath`, `texturePath` |
| `export_mesh_library` | Exports a 3D scene as a `MeshLibrary` (for GridMap) | `scenePath`, `outputPath` |
| `save_scene` | Saves a scene; can save as a variant | `scenePath`, optional `newPath` |
| `get_uid` | UID for a file (Godot **4.4+**) | `filePath` |
| `update_project_uids` | Resaves resources to refresh UID references (4.4+) | `projectPath` |

(Param names are indicative — confirm against the running server's
schema. The full list is also enumerated in the project's `autoApprove`
config block in its README.)

## How it works (architecture)

Two execution styles under the hood:

- **Direct CLI** for simple things — launching, running, version — call
  Godot's own command line.
- **Bundled GDScript** for structural operations — `create_scene`,
  `add_node`, etc. route through a single comprehensive script
  (`godot_operations.gd`) that takes an operation name + JSON params.
  No per-operation temp scripts are generated.

Implication: structural operations run *real Godot* against your project
files. They are as trustworthy as the engine, but coarse — one node, one
texture, one scene at a time.

## What it does NOT do (work around these)

- **No viewport/screenshot.** You cannot see the rendered game. Your
  only runtime signal is `get_debug_output`. Instrument code with
  `print()`/`push_error()` and read it back.
- **No live editor manipulation / no control of a running game.** It
  runs the project and reports; it does not poke a live scene tree,
  drive input, or inspect runtime node state interactively.
- **No fine-grained scene editing.** `add_node` sets simple properties;
  complex node setups, signals, sub-resources and exported references
  are better written as `.tscn` text directly (it's a documented text
  format) or built in code.
- **No shader/animation/physics authoring tools.** Those are file edits
  guided by `godot-development` / `godot-shaders-development`.

## Practical usage notes

- Every project op needs a valid `projectPath` containing
  `project.godot`. "Invalid project path" almost always means you
  pointed at the wrong directory level.
- If Godot isn't found, set `GODOT_PATH` to the executable (not the
  folder).
- Prefer running a **specific scene** during iteration (`run_project`
  with a `scene`) so you test the unit you changed, not the whole game.
- `run_project` is debug-mode, so `print` output and error backtraces
  come through `get_debug_output` — the richer your logging, the more
  you can "see".
