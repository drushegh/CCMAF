# Performance Engineering

Measure first: `renderer.info` (render.calls, render.triangles,
memory.geometries/textures), browser GPU profilers, stats panel,
Spector.js for draw-call inspection. Optimise the measured
bottleneck — CPU (draw calls, JS per frame) vs GPU (overdraw,
shader cost, resolution) have different fixes.

## Draw calls (usually the CPU bottleneck)

- **InstancedMesh** for N copies of the same geometry+material
  (trees, bolts, particles): one draw call; per-instance matrix via
  `setMatrixAt` + `instanceMatrix.needsUpdate`; per-instance colour
  supported.
- **Merge static geometry** (`BufferGeometryUtils.mergeGeometries`)
  sharing one material; trade-off: loses per-object culling/raycast
  identity.
- Share materials: every unique material/program switch costs;
  texture atlases let merged/instanced meshes vary appearance.
- **LOD** (`THREE.LOD`) for distance-dependent detail; impostors
  (billboards) at extreme distance.
- Frustum culling is on by default — keep bounding volumes correct
  after geometry edits (`computeBoundingSphere`); set
  `frustumCulled = false` only for skinned/instanced edge cases that
  pop.

## Memory discipline

- `geometry.dispose()`, `material.dispose()`, `texture.dispose()`,
  `renderTarget.dispose()`, `renderer.dispose()` — scene removal
  does not free GPU memory. Recursive teardown:

```javascript
function disposeTree(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((m) => {
      if (!m) return;
      Object.values(m).forEach((v) => v?.isTexture && v.dispose());
      m.dispose();
    });
  });
}
```

- SPA/HMR leak pattern: re-creating renderer/scene on remount without
  disposing the old — watch `renderer.info.memory` across
  navigations.
- Reuse scratch objects in loops (`_v3.set(...)`), never allocate
  per frame; reuse geometries/materials across meshes.

## Frame loop

- One rAF/`setAnimationLoop` owner; delta-time all motion.
- **Render on demand** for static content: render only on
  controls/state change.
- Static objects: `matrixAutoUpdate = false`.
- Throttle expensive non-visual work (raycast hover checks every
  2–3 frames; physics fixed-step).
- Offload: physics/pathfinding/decode in Web Workers;
  `OffscreenCanvas` rendering where supported.

## GPU side

- Cap pixel ratio at 2; consider dynamic resolution scaling under
  load.
- Overdraw: large transparent quads (particles, foliage) are fill-
  rate killers — smaller geometry, alphaTest, fewer layers.
- Shadows: smallest viable map sizes (1024² default), tight frusta,
  static shadow baking; one shadow-casting light unless justified.
- Post-processing passes each cost a full-screen render — budget
  them, combine where possible (`shaders-webgpu.md`).
- Texture VRAM: KTX2 keeps textures compressed ON the GPU — biggest
  single mobile win (`assets-loaders.md`).

## Mobile checklist

DPR cap (consider 1.5), KTX2 textures, reduced shadow budget or none,
simpler materials (Lambert/Phong fallback path), triangle budget
roughly an order below desktop, test on real mid-range hardware,
`powerPreference: 'high-performance'` hint, handle context loss
(`webglcontextlost` → restore path).

## Budgets (starting points, tune per project)

≤100 draw calls mobile / ≤500 desktop; ≤300k tris mobile / ≤1–2M
desktop; texture memory ≤128 MB mobile; first interactive render
≤3 s on 4G. Enforce in CI via asset checks (`assets-loaders.md`).
