# Pitfalls and Safety

MCP servers that run engines execute real code on the user's machine and
mutate real files. Treat them with the same care as a shell.

## Arbitrary code execution is the headline risk

- `blender-mcp`'s `execute_blender_code` runs **arbitrary Python inside
  Blender** — full access to bpy, the filesystem, the network. The
  upstream README itself flags it as "powerful but potentially
  dangerous". Rules: **save the .blend first**, run **small, reviewed**
  chunks, never paste code you wouldn't run by hand, and prefer the
  asset/integration tools over raw scripting where they cover the task.
- `godot-mcp`'s structural operations run real Godot against the project
  via bundled GDScript, and `run_project` executes the game. A malicious
  or buggy project runs like any other program. Don't run untrusted
  projects expecting sandboxing.
- This is a `secure-development` concern — supply-chain (you're running
  `npx`/`uvx` packages), code execution, and data exfiltration via
  generated code all apply. Pin/verify versions for anything beyond
  local experimentation.

## Connection and process gotchas

- **blender-mcp "could not connect":** the Blender addon isn't running
  or "Connect to Claude" wasn't clicked. The fix is in Blender, not the
  terminal. Do **not** run `uvx blender-mcp` manually — the client
  spawns it.
- **One instance only:** don't run blender-mcp from two clients (e.g.
  Cursor and Claude) at once.
- **godot-mcp "Godot not found":** set `GODOT_PATH` to the executable.
- **"Invalid project path":** point at the directory containing
  `project.godot`, not a parent or a subfolder.

## Timeouts and decomposition

blender-mcp uses a ~180s socket timeout and will fail a heavy one-shot
request ("Timeout waiting for Blender response"). Decompose: source one
asset, screenshot, adjust, then the next. The same discipline keeps the
Godot loop legible — one change per run.

## You are blind in Godot — don't bluff

The single most damaging failure mode is asserting a visual outcome you
can't see. `get_debug_output` proves the program ran and what it logged;
it does not prove the scene looks right. Report exactly what the output
establishes, mark the rest unverified, and ask the user to look when
only eyes will do.

## Version drift

- The blender-mcp `main` README advertises 1.5.5 while 1.6.x ships; tool
  names and parameters change across versions. **Trust the running
  server's advertised tool list over any document**, including these
  references. If a documented tool is missing or a parameter differs,
  the live schema wins.
- Confirm versions with `get_godot_version` and the blender-mcp status
  calls at the start of a session rather than assuming.

## Repository hygiene

- AI-generated meshes, downloaded Sketchfab/PolyHaven assets, raw
  `.blend` files and embedded-texture `.glb` can be large — make a
  deliberate `.gitignore` decision rather than committing megabytes
  blind.
- Godot's `.godot/` cache is generated — gitignore it (`godot-development`).
- Record asset **provenance and licence** (especially Sketchfab) so a
  shipped product isn't built on uncleared assets.
- Disable telemetry where the project/client requires it:
  `DISABLE_TELEMETRY=true` for blender-mcp (it collects anonymised usage
  data by default).
