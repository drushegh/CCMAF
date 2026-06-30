---
name: godot-mcp-workflow
description: >-
  Driving Godot and Blender from an AI agent over MCP — the practical
  loop for @coding-solo/godot-mcp (npx) and ahujasid/blender-mcp (uvx).
  Covers what each server's tools can and cannot do, the
  scaffold→edit-files→run→read-debug-output loop, working "blind" in
  Godot (no viewport screenshot) via observability, the Blender→glTF→
  Godot asset pipeline, and the safety rules for arbitrary code
  execution. Use whenever work involves the godot-mcp or blender-mcp
  servers, running/launching a Godot project through MCP, capturing
  Godot debug output, building scenes/nodes via MCP, generating or
  sourcing 3D assets in Blender via MCP (PolyHaven/Sketchfab/Hyper3D/
  Hunyuan3D), or wiring a Blender-authored asset into Godot. Trigger on
  "run my Godot game", "what's the debug output", "make the scene",
  "model this in Blender then put it in Godot", godot_operations, or an
  MCP-driven game-dev loop — even when the server isn't named.
---

# Godot + Blender MCP Workflow

How an autonomous agent actually builds a Godot game through MCP, using
`@coding-solo/godot-mcp` (the Godot side) and `ahujasid/blender-mcp`
(the asset side). This is the **workflow** layer: the Godot engine
knowledge lives in `godot-development` and `godot-shaders-development`,
the Blender knowledge in `blender-development`/`blender-toolkit`. Here we
cover how to drive them over MCP and how to verify when you can't see the
screen.

**The defining constraint: godot-mcp is deliberately small and you are
blind in Godot.** It launches the editor, runs the project, captures
console/error output, and does coarse scene scaffolding — nothing more.
There is **no viewport screenshot** on the Godot side. blender-mcp, by
contrast, *can* screenshot its viewport. Design the whole loop around
this asymmetry.

## What each server is for

| Server | Install | Role | Can it "see"? |
|--------|---------|------|---------------|
| godot-mcp | `npx @coding-solo/godot-mcp` | launch / run / **debug output** / coarse scene scaffolding | No — debug text only |
| blender-mcp | `uvx blender-mcp` (1.6.x) | model, material, asset sourcing & AI generation, **Python in Blender** | Yes — `get_viewport_screenshot` |

Full tool lists and parameters: `references/godot-mcp-tools.md` and
`references/blender-mcp-tools.md`. **Tool surfaces drift between
versions and the READMEs lag** (the blender-mcp README on `main` still
says 1.5.5 while 1.6.x ships) — confirm the live tool list from the
running server rather than trusting any doc, including this one.

## The core loop (Godot)

Because you can't see the game, you work like a backend engineer with no
debugger UI — you make state observable and read it back.

1. **Scaffold** the project/scene: `get_project_info` /
   `create_scene` / `add_node` for the skeleton, or write `.tscn`/`.gd`
   text directly (both are text files — direct editing with
   Read/Write/Edit is usually faster and more precise than `add_node`
   for anything non-trivial).
2. **Author logic** as GDScript/C# per `godot-development` standards
   (typed, signals-up/calls-down). Instrument it: `print()` /
   `print_debug()` for traces, `push_error()`/`push_warning()` for
   problems, `assert()` for invariants — this is your only feedback
   channel.
3. **Run**: `run_project` (debug mode), then `get_debug_output` to read
   stdout/stderr and stack traces; `stop_project` to halt.
4. **Diagnose from the text**, fix the files, re-run. Loop tightly.
5. **Verify behaviour headlessly** where possible: write logic that can
   run under `godot --headless` and prints pass/fail, or GUT/gdUnit4
   tests (`godot-development`) — far more reliable than inferring from a
   running window you can't see.

Details and the UID-on-rename rule: `references/the-development-loop.md`.

## The asset pipeline (Blender → Godot)

When the work needs 3D assets, Blender is the upstream and **glTF is the
bridge** — Godot imports `.glb`/`.gltf` natively.

1. In Blender via blender-mcp: source or generate the asset
   (`asset_creation_strategy` order — Sketchfab/PolyHaven for existing,
   Hyper3D/Hunyuan3D for generated, scripting last). **Check the scene
   first** (`get_scene_info`) and **screenshot to confirm**
   (`get_viewport_screenshot`) — use the eyes you have on this side.
2. Clean up and export glTF (axis/scale conventions, applied transforms)
   — see `references/asset-pipeline.md` and, for the Blender export
   mechanics, `blender-development` (`export-pipeline.md`).
3. Drop the file into the Godot project; let Godot import it; assemble
   it into a scene; `run_project` and read the output.

## Non-negotiables

1. **Confirm the environment before driving.** `get_godot_version` (and
   that `GODOT_PATH` resolves) and a blender-mcp status call before
   assuming either server is connected — blender-mcp needs its Blender
   addon running and "Connect to Claude" clicked, or every call fails.
2. **Don't pretend to see the Godot screen.** Never claim a visual
   result you can't verify. State what the debug output proves and what
   remains unverified; ask the user to eyeball the window when only eyes
   will do.
3. **Treat `execute_blender_code` as running arbitrary code on the
   user's machine** — because it is. Save the .blend first, work in
   small steps, and don't run code you wouldn't run by hand. Same
   caution for any operation that mutates files. (`secure-development`.)
4. **Edit files directly for non-trivial work.** The MCP scaffolding
   tools (`add_node`, `create_scene`) are convenience for skeletons;
   real scene/script authoring is faster and more reviewable as direct
   `.tscn`/`.gd` edits under version control.
5. **Keep generated junk out of commits.** AI-generated meshes, imported
   `.blend`/`.glb` and Godot's `.godot/` cache need deliberate
   `.gitignore` decisions; don't dump multi-MB binaries into the repo
   blind.
6. **Break big requests into MCP-sized steps.** blender-mcp has a ~180s
   timeout and times out on heavy one-shot requests; decompose.

## Pitfalls

- blender-mcp "connection refused" → the Blender addon isn't running or
  "Connect to Claude" wasn't clicked; running `uvx blender-mcp` yourself
  in a terminal is *wrong* — the MCP client launches it.
- Running **both** a Cursor and a Claude instance of blender-mcp at once
  → conflicts; run one.
- Assuming godot-mcp can manipulate a *running* game or read live state
  — it can't; it runs and reports, that's the contract.
- Renaming/moving a `.gd`/scene and breaking `res://` UID references on
  Godot 4.4+ → use `get_uid`/`update_project_uids`.
- Blender Z-up vs Godot Y-up and unit/scale surprises → apply transforms
  before export; the glTF exporter converts axes but not your unapplied
  scale. (`references/asset-pipeline.md`.)
- Silent telemetry — blender-mcp collects anonymised data by default;
  set `DISABLE_TELEMETRY=true` if the project requires it.

## References

| File | Load when |
|------|-----------|
| `references/godot-mcp-tools.md` | Using the Godot server — every tool, params, the bundled-GDScript model, UID tools, limits |
| `references/blender-mcp-tools.md` | Using the Blender server — every tool, asset sources, the `asset_creation_strategy`, connection model |
| `references/the-development-loop.md` | The run→debug→fix loop, observability-driven dev, headless verification, UID management |
| `references/asset-pipeline.md` | Moving assets Blender→glTF→Godot — conventions, scale/axis, import settings |
| `references/pitfalls-and-safety.md` | Arbitrary-code-execution safety, version drift, timeouts, repo hygiene, telemetry |

## Boundaries with sibling skills

- Godot engine/GDScript/scenes → `godot-development`; shaders →
  `godot-shaders-development`.
- Blender concepts, bpy scripting, geometry nodes, export mechanics →
  `blender-development` / `blender-toolkit`.
- Security of arbitrary code execution and supply chain →
  `secure-development`. MCP *server authoring* (building your own) →
  `llm-development`.
