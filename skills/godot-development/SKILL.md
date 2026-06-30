---
name: godot-development
description: >-
  Godot 4.x development: GDScript (static-typed) and C#/.NET, scene and
  node architecture, signals, custom Resources for data-driven design,
  physics (Jolt default since 4.6), input, UI, and export/CI pipelines.
  Use for ANY work involving Godot, GDScript, .tscn/.tres files,
  project.godot, Godot C#, or building/exporting Godot games and
  applications.
---

# Godot Development

Standards for Godot 4.x. Source: a5c-ai/babysitter godot skill set
(saved in Reference skills) + official docs conventions. **Current
stable June 2026: 4.6.x — 4.6 (Jan 2026) made Jolt physics the
default**; 4.5 was Sep 2025. Verify the project's pinned version —
minor releases move features; don't quote "latest" from this file.

**Verification caveat: GDScript has no sandbox parser** — code blocks
get structural checks only; the Godot editor (or `godot --check-only
--script`) is the real validator.

## Non-negotiables

1. **Static typing in GDScript, always**: `var speed: float = 300.0`,
   typed function signatures, `-> void` returns, typed arrays
   (`Array[Enemy]`). It catches errors at parse time AND runs faster
   (typed instructions). Untyped GDScript in deliverables is a
   defect.
2. **Scene composition over inheritance**: small scenes with a clear
   root + script, composed via instancing; scene inheritance only for
   genuine specialisation. One responsibility per scene.
3. **Signals up, calls down**: parents call children directly;
   children report upward via signals — never `get_parent()` chains
   or `get_node("/root/…")` reach-arounds. Decoupled systems talk
   through an autoload event bus (sparingly).
4. **Cache node references**: `@onready var anim: AnimationPlayer =
   $AnimationPlayer` — `get_node()`/`$` in `_process` is a per-frame
   string lookup.
5. **Resources are the data layer**: custom `Resource` classes
   (`.tres`) for item stats, configs, definitions — not dictionaries,
   not JSON-by-default, not nodes. Editor-editable, typed,
   shareable.
6. **`_physics_process` for physics, `_process` for visuals**; all
   movement `* delta` (except `move_and_slide()` which handles it);
   never poll input in `_process` when input events/actions do it
   better (Input Map actions, not keycodes).
7. **Collision layers/masks designed as a table** (named layers in
   project settings) before writing physics code — debugging
   accidental layer soup later costs days.
8. **Don't free what physics still touches**: `queue_free()` (not
   `free()`) from gameplay; deferred calls
   (`call_deferred`/`set_deferred`) when mutating physics state
   mid-callback.

## GDScript vs C# (decision)

| GDScript | C# |
|----------|----|
| Default: tight editor integration, fastest iteration, idiomatic docs/community | .NET ecosystem need (libraries, shared code with enterprise .NET), heavy compute logic, teams of C# developers |

Mixed projects work (signal/call interop both ways) but pick a
primary. C# builds require the .NET edition of Godot; some platforms
lag (verify per-version web export support for C#). GDExtension
(C++/Rust) for engine-level performance needs — beyond this skill's
scope. Details: `references/csharp-interop.md`.

## Workflow

1. Project hygiene: version-pin Godot; `.gitignore` (.godot/ cache);
   project settings (display, input map, **named physics layers**,
   autoloads) before content.
2. Architecture: main scene + scene-per-screen/entity; autoloads for
   true singletons (game state, event bus, audio manager) — few and
   disciplined (`references/scenes-nodes.md`).
3. Entities: typed GDScript on scene roots; `@export` for designer
   tunables; signals declared with typed parameters
   (`references/gdscript.md`).
4. Data: custom Resources + `.tres` files
   (`references/resources-export.md`).
5. Physics/movement per body type (`references/physics-2d-3d.md`).
6. Test: GUT or gdUnit4 unit tests for logic; scene runner tests for
   integration; headless `godot --headless` in CI.
7. Export: presets per platform + export templates version-matched
   to the editor; automate via CI
   (`references/resources-export.md`).

## High-frequency pitfalls

- `@onready` vars accessed before `_ready` (instancing order), or
  `%UniqueName` scene-unique nodes not enabled.
- Forgetting `.emit()` is the 4.x signal call
  (`health_changed.emit(hp)`) and `await` replaced `yield` —
  3.x-era snippets online mislead constantly.
- `await get_tree().create_timer(…).timeout` leaks callbacks if the
  node dies first — guard with `is_instance_valid` or use
  scene-tree-bound timers for cancellable waits.
- Resources are SHARED by reference when assigned in the editor —
  `.duplicate()` (or "Make Unique"/local to scene) for per-instance
  mutable state; mutating a shared .tres mutates everyone's.
- String paths to scenes/resources (`load("res://…")`) break on
  rename — prefer `@export var scene: PackedScene` references or
  `preload` where static.
- Physics in `_process`, or scaling physics bodies (scale colliders'
  shapes, not the body).
- UI: Control anchors/containers ignored in favour of absolute
  positions — breaks on every resolution; learn the container
  system.

## References

| File | Load when |
|------|-----------|
| `references/gdscript.md` | Writing any GDScript — typing, signals, await, tool scripts, tests |
| `references/scenes-nodes.md` | Scene architecture, lifecycle, autoloads, groups |
| `references/csharp-interop.md` | Godot C# specifics and interop |
| `references/physics-2d-3d.md` | Bodies, Jolt, collision design, movement |
| `references/resources-export.md` | Custom Resources, data-driven design, export/CI |

## Boundaries with sibling skills

- Asset authoring/import conventions → `blender-development`
  (glTF straight into Godot).
- Alternative engines → `unity-development`,
  `unreal-engine-development`; browser-native 3D →
  `threejs-development`.
- Plain C# language idioms → `dotnet-development`; Godot-specific C#
  stays here. CI hosting → `devops-development`.
