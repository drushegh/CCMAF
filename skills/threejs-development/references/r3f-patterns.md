# React Three Fiber Patterns (pmndrs ecosystem)

R3F v9 / React 19 pairing. Ecosystem: `@react-three/fiber`,
`@react-three/drei` (helpers), `@react-three/postprocessing`,
`@react-three/rapier` (physics), `zustand` (state), `leva` (debug
GUI). Deep per-topic API refs: EnzeD r3f-skills + emalorenzo
r3f-best-practices (Reference skills).

## The cardinal rules (re-renders kill R3F apps)

1. **Never `setState` inside `useFrame`.** Per-frame values mutate
   refs:

```jsx
function Spinner() {
  const ref = useRef();
  useFrame((state, delta) => {
    ref.current.rotation.y += delta;          // mutate, don't setState
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="hotpink" />
    </mesh>
  );
}
```

2. **Zustand with selectors** — `useStore((s) => s.speed)`, never the
   whole store; **transient subscriptions**
   (`useStore.subscribe(sel, cb)` read in `useFrame`) for
   continuously-changing values so React never re-renders.
3. Isolate stateful UI from the scene graph; memoise heavy subtrees;
   `frameloop="demand"` + `invalidate()` for static scenes.
4. Constructor args via `args={[...]}` (changing args re-constructs
   the object — keep them stable); per-prop pierced attributes
   (`position-x={1}`, `rotation-y={r}`) avoid array churn.
5. Objects created declaratively are disposed by R3F on unmount;
   objects you `new` yourself (in effects/loaders) are YOUR dispose
   responsibility.

## Canvas setup

```jsx
<Canvas
  dpr={[1, 2]}
  camera={{ position: [3, 2, 5], fov: 60, near: 0.1, far: 100 }}
  shadows
  frameloop="always"   // "demand" for static scenes
>
  <Suspense fallback={null}>
    <Scene />
    <Environment preset="city" />
  </Suspense>
  <OrbitControls makeDefault enableDamping />
</Canvas>
```

`<Canvas>` owns renderer/scene/camera lifecycle. Everything async
(useGLTF, useTexture, Environment) needs a `<Suspense>` boundary.
HTML UI lives OUTSIDE the Canvas (or via drei `<Html>` for in-scene
panels — sparingly, it's DOM compositing).

## drei — use these before hand-rolling

`useGLTF` (+ `useGLTF.preload(url)`), `useTexture`, `<Environment>`,
`<OrbitControls makeDefault>`, `<Instances>/<Merged>` (declarative
instancing), `<Text>` (SDF text), `<Html>`, `<Bounds>` (auto-fit),
`<ContactShadows>`/`<AccumulativeShadows>` (cheap grounding),
`<PerformanceMonitor>` (adaptive quality), `<Stats>`, `<Detailed>`
(LOD), `<KeyboardControls>`. gltfjsx CLI turns GLB into typed JSX
components — the right way to make model parts interactive.

## Events

Pointer events on meshes (`onClick`, `onPointerOver/Out`,
`onPointerMove`) ride a built-in raycaster — `e.stopPropagation()` to
stop hit-through; hover cursor via `onPointerOver={() =>
(document.body.style.cursor = 'pointer')}`. For dense scenes use
drei `<Bvh>` (three-mesh-bvh) to accelerate raycasts; events only on
meshes that need them (`raycast={() => null}` opt-outs help).

## Physics (@react-three/rapier)

`<Physics>` provider; `<RigidBody type="dynamic|fixed|kinematicPosition"
colliders="hull|cuboid|trimesh">` wrapping meshes; explicit colliders
(`<CuboidCollider>`) beat auto trimesh for performance; kinematic
bodies driven in `useFrame` via `setNextKinematicTranslation`.
Don't mutate transforms of dynamic bodies directly — apply
forces/impulses or use kinematic types.

## Post-processing

`@react-three/postprocessing` `<EffectComposer>` with effects as
children (`<Bloom>`, `<SSAO>`, `<DepthOfField>`, `<Vignette>`)
merges compatible effects into fewer passes — prefer it over manual
EffectComposer chains. Each extra pass = full-screen cost
(`performance.md`).

## Testing/SSR notes

Canvas is client-only — Next.js: dynamic import with `ssr: false`
(integration details → `react-development`); jest: @react-three/test-
renderer for scene logic. Keep business logic in plain
hooks/stores so it tests without WebGL.
