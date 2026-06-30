# Scenes, Nodes and Architecture

## The model

Everything in the tree is a Node; a Scene is a saved node subtree
(`.tscn`, text-based — diffs nicely); scenes instance into other
scenes. Composition is the architecture: a `Player.tscn` containing
sprite/collision/audio/state nodes, instanced into levels.

Base classes: `Node` (logic), `Node2D`/`Node3D` (transforms),
`Control` (UI), `CanvasLayer` (screen-space), physics bodies
(`physics-2d-3d.md`).

## Lifecycle order

`_init` (script construct) → `_enter_tree` (parent first) →
`_ready` (CHILDREN first, then parent — children are safe to touch
in `_ready`) → `_process(delta)` / `_physics_process(delta)` →
`_exit_tree`. Input: `_input` → `_unhandled_input` (gameplay input
goes here so UI consumes first). `notification()` for the exotic
cases (WM events, predelete).

## Finding and referencing nodes

| Mechanism | Use |
|-----------|-----|
| `@onready var x := $Path/To/Child` | Standard child caching |
| `%UniqueName` | Scene-unique nodes — survives restructuring (enable "Access as Unique Name") |
| `@export var target: Node2D` | Editor-wired cross-references — refactor-safe |
| Groups (`add_to_group("enemies")`, `get_tree().get_nodes_in_group("enemies")`) | Bulk queries/broadcasts without references |
| Signals upward | Child→parent communication (never `get_parent()` assumptions) |

Scene-instancing at runtime:

```gdscript
@export var bullet_scene: PackedScene

func shoot() -> void:
    var bullet := bullet_scene.instantiate() as Bullet
    bullet.global_position = muzzle.global_position
    get_tree().current_scene.add_child(bullet)   # owner decides parent
```

Spawned things usually parent to the level, NOT the spawner (they
shouldn't die/move with it).

## Autoloads (singletons)

Project Settings → Autoload: scripts/scenes loaded once, globally
accessible by name. Legitimate uses: game state, save system, audio
manager, event bus, scene transitions. Discipline: few, stateless
where possible, no gameplay logic dumping ground. Event-bus pattern:

```gdscript
# events.gd (autoload "Events")
extends Node
signal enemy_died(enemy: Node, points: int)
```

Emitters `Events.enemy_died.emit(self, 100)`; listeners connect in
`_ready`. Use for genuinely global events only — local communication
stays local (signals to parent).

## Scene management

`get_tree().change_scene_to_packed(scene)` for hard switches; for
transitions/loading screens: keep a root "Main" scene that swaps
level children manually (full control, persistent UI/music).
Background loading: `ResourceLoader.load_threaded_request` +
`load_threaded_get` for big scenes.

## Composition patterns

- **Component nodes**: reusable child nodes with their own scripts
  (HealthComponent, Hitbox, Interactable) added to any entity —
  Godot's answer to entity-component patterns; export the linkages.
- **State machines**: nodes-as-states (a `StateMachine` node with
  state children) or a typed enum + match in one script — nodes for
  complex/animated states, enum for simple.
- **Scene inheritance**: `New Inherited Scene` for variants of one
  base (enemy types from BaseEnemy.tscn) — changes to base
  propagate; don't mix with heavy structural overrides (fragile).

## UI (Control) essentials

Anchors + containers (V/HBox, Margin, Grid, Panel) — never absolute
positions for real layouts; `size_flags` for stretch behaviour;
themes (`.tres`) for consistent styling; `_gui_input` vs global
input; CanvasLayer for HUD above world. Focus rules and keyboard
navigation matter — `accessibility-development` principles apply to
games' menus too.

## Processing control

`set_process(false)` / `set_physics_process(false)` to disable
per-node; `process_mode` (Inherit/Pausable/WhenPaused/Always) +
`get_tree().paused` for pause systems — design the pause matrix
early (what runs while paused: UI yes, world no).
