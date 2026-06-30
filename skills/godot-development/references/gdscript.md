# GDScript (Godot 4.x)

No sandbox parser exists for GDScript — validate in the editor or
`godot --headless --check-only -s script.gd`. Indentation is
syntactic (tabs by convention).

## Canonical entity script

```gdscript
class_name Player
extends CharacterBody2D

signal health_changed(new_health: int)
signal died

@export var max_health: int = 100
@export var speed: float = 300.0
@export var jump_velocity: float = -400.0

@onready var anim: AnimatedSprite2D = $AnimatedSprite2D
@onready var hurt_sfx: AudioStreamPlayer = $HurtSfx

var health: int

func _ready() -> void:
    health = max_health

func _physics_process(delta: float) -> void:
    if not is_on_floor():
        velocity += get_gravity() * delta
    var direction := Input.get_axis("move_left", "move_right")
    velocity.x = direction * speed
    if Input.is_action_just_pressed("jump") and is_on_floor():
        velocity.y = jump_velocity
    move_and_slide()

func take_damage(amount: int) -> void:
    health = maxi(0, health - amount)
    health_changed.emit(health)
    hurt_sfx.play()
    if health == 0:
        died.emit()
        queue_free()
```

## Typing rules

- Explicit types or inferred-but-typed (`:=`) everywhere; typed
  returns incl. `-> void`; typed arrays `Array[Item]`; typed
  dictionaries (4.4+) `Dictionary[String, int]`.
- `class_name` registers global types (editor pickers, `is` checks).
- Enums for state (`enum State { IDLE, RUN, AIR }`); `match` over
  if-chains for state dispatch.
- Constants `const`, `static func` for pure helpers, `static var`
  sparingly.

## Signals and await

- Declare typed; connect in code (`died.connect(_on_player_died)`)
  or editor; one-shot: `connect(..., CONNECT_ONE_SHOT)`.
- `await someone.some_signal` suspends until emission;
  `await get_tree().create_timer(0.5).timeout` for delays;
  `await get_tree().process_frame` to defer one frame. Any function
  that awaits returns a coroutine — callers `await` it.
- Validity: after any await, the node may have been freed —
  re-check `is_instance_valid(self)`-sensitive state in long
  coroutines.

## Useful constructs

- `@export_group`, `@export_range(0, 100)`, `@export var scene:
  PackedScene` — designer-facing tunables.
- Lambdas + Callables: `timer.timeout.connect(func(): score += 1)`;
  `array.map(func(x): return x * 2)`.
- Setters/getters: `var hp: int: set(v): hp = clampi(v, 0, max_hp)`.
- `_to_string()`, `_get_configuration_warnings()` (editor warnings
  for misconfigured scenes — use in reusable components).

## @tool scripts

`@tool` at top runs the script in-editor (procedural placement,
custom gizmos, validation). Guard runtime-only logic with
`Engine.is_editor_hint()`. Crashy tool scripts can lock scenes —
develop with small steps, version control before testing.

## Testing (GUT / gdUnit4)

Both are addon frameworks with headless CI runners:

```gdscript
# gdUnit4 style
class_name PlayerTest
extends GdUnitTestSuite

func test_take_damage_clamps_at_zero() -> void:
    var player := auto_free(Player.new())
    player.health = 10
    player.take_damage(50)
    assert_int(player.health).is_equal(0)
```

Keep logic in plain functions/Resources where possible so tests
don't need scene scaffolding; scene-runner tests for integration
(input simulation, signal waits). CI:
`godot --headless` + the framework's CLI (see
`resources-export.md`).

## Performance notes

Typed code is faster; cache nodes; avoid per-frame string ops/
allocations; `PackedFloat32Array` etc. for bulk data; profiler +
`print_orphan_nodes()` for leak hunts (orphan nodes = forgot
queue_free or strong refs in lambdas/closures holding nodes).
