---
name: threejs-development
description: >-
  Three.js and React Three Fiber development: scene/camera/renderer
  fundamentals, lighting and colour management, glTF asset pipeline
  (Draco/KTX2/meshopt), performance engineering (draw calls, instancing,
  LOD, memory/dispose discipline), GLSL and TSL shaders, WebGL vs WebGPU,
  raycasting/controls/animation, and the R3F/pmndrs ecosystem (drei,
  rapier, zustand, postprocessing). Use for ANY work involving three.js,
  React Three Fiber, WebGL/WebGPU 3D in the browser, 3D product
  configurators, glTF/GLB models, shaders, or interactive 3D scenes.
---

# Three.js Development

Standards for browser 3D with three.js (vanilla and React Three Fiber).
Primary source: emalorenzo/three-agent-skills (120+ prioritised rules,
three r182+; saved in Reference skills) plus EnzeD r3f-skills and
mrgoonie's doc-mirror references — load those for API-level detail.

## Version reality (June 2026 — verify on release notes)

Three.js ships monthly (r18x line; rules grounded at r0.182+). Modern
setup: ES modules + import maps (or bundler), `three/addons/` paths
(the old `examples/jsm` docs persist in stale tutorials),
`renderer.setAnimationLoop()` over manual rAF. **WebGPURenderer + TSL**
are production-capable for new projects with fallback; WebGL remains
the default safe target — choose deliberately
(`references/shaders-webgpu.md`). R3F v9 pairs with React 19.

## Non-negotiables

1. **Dispose what you create.** Geometries, materials, textures and
   render targets hold GPU memory until `.dispose()` — removing from
   the scene is NOT disposal. Recursive dispose on teardown; in
   React, dispose in cleanup (R3F handles declaratively-mounted
   objects, not ones you created imperatively).
2. **Never allocate in the render loop.** No `new Vector3()`/object
   literals inside the frame callback — preallocate and reuse scratch
   objects; cache expensive lookups outside the loop.
3. **Draw calls are the budget.** Instancing (`InstancedMesh`) for
   repeated geometry, merge static meshes, share materials/geometries,
   LOD for distance, and measure (`renderer.info.render.calls`)
   before optimising further.
4. **Asset pipeline is glTF/GLB**: Draco or meshopt compression for
   geometry, **KTX2/Basis** for textures, power-of-two sizes where
   mipmapped. FBX/OBJ are interchange at best — convert. (Authoring
   side → `blender-development` when built.)
5. **Cap `setPixelRatio(Math.min(devicePixelRatio, 2))`** — beyond 2
   is invisible cost, mobile-lethal.
6. **Colour management**: leave `outputColorSpace` at its sRGB
   default; mark colour textures `SRGBColorSpace`, data textures
   (normal/roughness) linear; lighting falls apart when this is wrong.
7. **R3F: never `setState` in `useFrame`.** Mutate refs for
   per-frame values; React state is for discrete changes; zustand
   with selectors/transient subscriptions for shared state. Re-renders
   are the #1 R3F performance killer.
8. **Render on demand for static scenes** (`frameloop="demand"` in
   R3F; conditional render in vanilla) — a configurator idling at
   60 fps is wasted battery.

## Decision guides

- **Vanilla vs R3F**: React app → R3F (declarative lifecycle,
  ecosystem); standalone visualisation/game or non-React host →
  vanilla. Don't bolt React on for a single canvas widget.
- **Lighting**: IBL (HDR environment map) for PBR realism +
  one directional light with shadows where needed; every shadow-
  casting light multiplies render cost. Bake what doesn't move.
- **Physics**: rapier (R3F: `@react-three/rapier`) as default;
  physics in a worker for heavy scenes.

## Workflow

1. Scene skeleton: renderer (antialias per need), camera (sensible
   fov/near/far — tight near/far helps depth precision), resize
   handler, animation loop with delta time.
2. Assets: compressed glTF via `GLTFLoader` (+`DRACOLoader`/
   `KTX2Loader` registered), `LoadingManager`/Suspense for progress;
   await full load before first render to avoid jank.
3. Materials/lighting: `MeshStandardMaterial` baseline; environment
   map; verify colour spaces (`references/scene-fundamentals.md`).
4. Interaction: raycaster patterns, controls
   (`references/interaction-animation.md`).
5. Performance pass BEFORE shipping: draw calls, geometry counts,
   texture memory, dispose audit, mobile test
   (`references/performance.md`).
6. Verify visually at multiple DPRs and on a low-end device profile.

## High-frequency pitfalls

- Stale imports (`examples/jsm`, old CDN script tags) from outdated
  tutorials — use `three/addons/` via import map/bundler.
- Memory leak via hot-reload/SPA navigation: renderer + scene not
  disposed on unmount.
- Shadows: forgetting `castShadow`/`receiveShadow` per object, or a
  shadow camera frustum that doesn't cover the scene (or covers far
  too much — resolution waste).
- Raycasting `InstancedMesh`/skinned meshes needs care (instanceId,
  updated matrices); raycast against a small candidates list, not
  `scene.children` deep.
- `OrbitControls` requires `controls.update()` when damping enabled.
- Z-fighting from coplanar surfaces — offset geometry or
  `polygonOffset`, not depth hacks.
- R3F: creating geometries/materials inline per render instead of
  memo/args; forgetting `Suspense` around async loaders; drei
  `useGLTF.preload` skipped.

## References

| File | Load when |
|------|-----------|
| `references/scene-fundamentals.md` | Renderer/camera/lights/colour setup |
| `references/assets-loaders.md` | glTF pipeline, compression, loading UX |
| `references/performance.md` | Draw calls, memory, mobile, profiling |
| `references/r3f-patterns.md` | React Three Fiber + drei/zustand/rapier |
| `references/shaders-webgpu.md` | GLSL, TSL, WebGPU renderer decisions |
| `references/interaction-animation.md` | Raycasting, controls, animation mixer |

## Boundaries with sibling skills

- React component architecture, Suspense semantics →
  `react-development`; TypeScript typing → `typescript-development`.
- Page integration, CSS, bundling → `frontend-development`.
- Asset authoring/export (Blender) → `blender-development` (Batch C);
  game-engine alternatives → `unity-development` /
  `godot-development` when 3D-in-browser isn't the right call.
