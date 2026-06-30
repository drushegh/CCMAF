# The MCP Development Loop

How to make progress in Godot through MCP when you cannot see the game.
The mindset: you are a backend engineer whose only window into runtime
is a log stream. Engineer observability deliberately.

## The loop

```
scaffold ──► edit files (.gd/.tscn) ──► run_project ──► get_debug_output
   ▲                                                          │
   └──────────────── fix, guided by the output ◄──────────────┘
```

1. **Scaffold** the skeleton: `create_scene`/`add_node` or write
   `.tscn` text. Use `get_project_info` to learn the layout first.
2. **Edit** scripts/scenes directly with Read/Write/Edit to
   `godot-development` standards — direct file edits beat `add_node` for
   anything with signals, exported references, sub-resources or more
   than a couple of properties.
3. **Run** the smallest scene that exercises the change (`run_project`
   with a specific `scene`), not the whole game.
4. **Read** `get_debug_output`; `stop_project` when done.
5. **Fix and repeat.** Keep iterations tiny so each output maps to one
   change.

## Observability-driven development (the key skill)

You have no screenshot. So make the program *tell you* what it's doing:

- `print()` / `print_debug()` for state traces (position, health, state
  machine transitions). Tag them (`[player]`, `[spawner]`) so they're
  greppable in the output.
- `push_error()` / `push_warning()` for anomalies — they show with
  context in debug output.
- `assert(condition, "msg")` for invariants — a failed assert halts with
  a clear message rather than drifting into undefined behaviour you
  can't see.
- On `_ready`, print a one-line "node X up, children: …" so you can
  confirm the tree assembled as intended.
- For anything numeric/logical, print the value you'd otherwise *look
  at* on screen (the score, the raycast hit, the nav path length).

Treat a quiet, error-free run as **necessary but not sufficient**:
absence of errors is not proof the visuals are right. Say so.

## Verify headlessly wherever possible

The most reliable signal is logic that self-checks:

- Write game logic so the testable core runs without a window, and add a
  scene/script that exercises it and prints `PASS`/`FAIL`. Run via the
  project; for true CI, `godot --headless` (`godot-development`).
- Use **GUT** or **gdUnit4** for unit/integration tests of systems
  (inventory, damage, state machines). A green test suite is worth far
  more than inferring from a window you can't see.
- Reserve "please look at the running game" for genuinely visual
  acceptance (does the shader look right, is the animation smooth) and
  ask the user explicitly.

## UID management (Godot 4.4+)

Godot 4.4+ tracks resources by UID (`.uid` sidecar files) as well as
`res://` paths. When you rename or move a script/scene through file
edits, references can break.

- `get_uid` to read a file's UID.
- `update_project_uids` to resave resources and refresh references after
  moves/renames.
- Prefer `@export var x: PackedScene`/`preload` references over
  stringly-typed `load("res://…")` so renames are caught at edit time
  (`godot-development`).

## When to reach for the MCP vs the filesystem

| Task | Tool |
|------|------|
| Create empty scene / add a placeholder node | `create_scene`/`add_node` (fast skeleton) |
| Script logic, signals, complex nodes, sub-resources | Direct `.gd`/`.tscn` edits |
| Run and see errors | `run_project` + `get_debug_output` |
| Confirm Godot/version/project | `get_godot_version`/`get_project_info` |
| Refresh references after a rename | `get_uid`/`update_project_uids` |
| Anything visual | ask the user; you can't see it |
