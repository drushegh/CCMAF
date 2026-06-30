# Interaction, Controls and Animation

## Raycasting

```javascript
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function onPointerDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interactables, false);
  if (hits.length) select(hits[0].object);
}
```

Rules: raycast a curated `interactables` array, not the whole scene
graph (`recursive: false` where possible); for big/complex meshes use
**three-mesh-bvh** (orders of magnitude faster); `InstancedMesh` hits
return `instanceId`; skinned meshes need up-to-date matrices and are
expensive — proxy hitboxes (invisible simple meshes) are the pro
move for characters/complex models. Throttle hover raycasts; touch
needs bigger proxies than mouse.

## Controls (three/addons)

| Control | Use |
|---------|-----|
| `OrbitControls` | Default inspect/orbit; `enableDamping` (+ mandatory `update()` per frame), set `minDistance/maxDistance/maxPolarAngle` to keep users out of degenerate views |
| `MapControls` | Pan-dominant (GIS/plans) |
| `TrackballControls` | Free tumbling, no up-vector lock |
| `FlyControls` / `PointerLockControls` | Fly-through / FPS |
| `TransformControls` | Editor gizmos (translate/rotate/scale) — excludes itself from raycasts but mind event conflicts with orbit (disable orbit while dragging) |
| `DragControls` | Simple plane dragging |

Smooth camera moves: tween `camera.position` and a controls
`target` together (gsap or manual damping); never teleport mid-
interaction. drei `<Bounds>`/`fitToBox` patterns auto-frame objects.

## Animation system (clips)

```javascript
const mixer = new THREE.AnimationMixer(gltf.scene);
const action = mixer.clipAction(
  THREE.AnimationClip.findByName(gltf.animations, 'Walk'));
action.play();
// frame loop:
mixer.update(delta);
```

- Crossfade: `next.reset().fadeIn(0.3).play(); prev.fadeOut(0.3);`
- One-shots: `action.setLoop(THREE.LoopOnce); action.clampWhenFinished
  = true;` listen for the mixer `finished` event.
- Mixer per animated root; `mixer.update(delta)` every frame; stop
  unused actions (they cost even at weight 0 in big scenes).
- Morph targets ride the same clip system; bone-heavy scenes: cap
  skinned mesh counts, share `AnimationClip`s across instances.

## Procedural motion

Delta-time everything (`pos += speed * delta`); damp toward targets
(`THREE.MathUtils.damp`) instead of lerping by fixed factors for
frame-rate independence; gsap/tween.js fine for UI-ish moves —
drive them from the single render loop, not parallel rAFs.

## Interaction accessibility (web context)

A 3D canvas is still a web UI: provide keyboard alternatives for
essential interactions (select/next/previous focus model parts),
expose state in DOM (visually-hidden live region announcing
selection), respect `prefers-reduced-motion` (disable auto-rotate/
camera fly-ins), and never make the canvas the only path to critical
content — `accessibility-development` owns the acceptance bar.

## R3F equivalents

Pointer events on meshes replace manual raycasting
(`r3f-patterns.md`); drei `<TransformControls>`, `<DragControls>`,
`useAnimations(gltf)` wrap the above with correct lifecycle.
