# blender-mcp Tool Reference (ahujasid/blender-mcp)

Source: github.com/ahujasid/blender-mcp, installed via `uvx blender-mcp`
(this project uses **1.6.x**). It is two parts: a **Blender addon**
(`addon.py`) that runs a socket server (default `localhost:9876`) inside
Blender, and the **MCP server** (`uvx blender-mcp`) the client launches.

**Connection model — get this right or nothing works:** install the
addon in Blender, open the 3D-view sidebar (`N`) → "BlenderMCP" tab →
tick the integrations you want (PolyHaven/etc.) → click **"Connect to
Claude"**. Do **not** run `uvx blender-mcp` yourself in a terminal — the
MCP client spawns it. Run only **one** client's instance at a time.
Env: `BLENDER_HOST`/`BLENDER_PORT`, and `DISABLE_TELEMETRY=true`.

**Verify the live tool list** — the `main` README still advertises
1.5.5 though 1.6.x ships; tool surfaces drift.

## Tools (≈22, as of 1.5.x/1.6.x)

**Scene & code**
- `get_scene_info` — scene/object summary. *Always call first.*
- `get_object_info` — detail on one named object.
- `get_viewport_screenshot` — PNG of the viewport (`max_size`). **Your
  eyes on the Blender side — use it to confirm before/after.**
- `execute_blender_code` — run **arbitrary Python** in Blender (the real
  workhorse, and the dangerous one — see safety).

**PolyHaven** (free CC0 — textures/HDRIs/models; enable in sidebar)
- `get_polyhaven_status`, `get_polyhaven_categories`,
  `search_polyhaven_assets`, `download_polyhaven_asset`, `set_texture`.

**Sketchfab** (large realistic library; needs API key, downloadable
models only)
- `get_sketchfab_status`, `search_sketchfab_models`,
  `get_sketchfab_model_preview` (thumbnail — confirm before download),
  `download_sketchfab_model` (**`target_size` is required** — largest
  dimension in metres, e.g. chair 1.0, car 4.5).

**Hyper3D Rodin** (text/image → generated model; trial key is limited)
- `get_hyper3d_status`, `generate_hyper3d_model_via_text`,
  `generate_hyper3d_model_via_images`, `poll_rodin_job_status`,
  `import_generated_asset`.

**Hunyuan3D** (alternative generator)
- `get_hunyuan3d_status`, `generate_hunyuan3d_model`,
  `poll_hunyuan_job_status`, `import_generated_asset_hunyuan`.

It also exposes an MCP **prompt**, `asset_creation_strategy`, encoding
the recommended sourcing order (below).

## The asset_creation_strategy (follow it)

1. **Always** `get_scene_info` first.
2. Check which integrations are enabled (`get_*_status`).
3. Source in this priority:
   - Specific existing object → **Sketchfab** first, then PolyHaven.
   - Generic object/furniture → **PolyHaven** first, then Sketchfab.
   - Custom/unique not in any library → **Hyper3D** or **Hunyuan3D**
     (generate one item at a time — never a whole scene in one shot,
     never generate ground).
   - Environment lighting → PolyHaven **HDRIs**.
   - Materials/textures → PolyHaven **textures**.
4. After importing, **check `world_bounding_box`** and fix
   location/scale/rotation so nothing clips and spatial relationships
   are right.
5. Fall back to `execute_blender_code` scripting only when all
   integrations are off, a simple primitive is requested, or generation
   failed.

Generation tools are **asynchronous**: create → `poll_*_status` until
done → `import_*`. Don't block; poll.

## Practical notes

- Generated/imported models arrive **normalised in size** — rescale
  intentionally (Sketchfab via `target_size`; generated via post-import
  transform).
- PolyHaven/Sketchfab integrations must be ticked in the Blender sidebar
  *and* (Sketchfab/Hyper3D) have keys configured, or the status calls
  report disabled.
- Keep requests small — heavy operations hit the ~180s socket timeout;
  break them into steps.
- This is a third-party integration (not by Blender); `get_*_status`
  messages may carry key-type hints the model is told to remember
  silently — don't surface API-key details to the user.
