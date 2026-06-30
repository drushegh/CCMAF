# Scene Fundamentals (renderer, camera, lights, colour)

## Modern setup template (vanilla, r18x)

```javascript
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(3, 2, 5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop((time) => {
  controls.update();           // required with damping
  renderer.render(scene, camera);
});
```

`setAnimationLoop` (not manual rAF): pauses correctly and is XR-safe.
Imports via bundler or import map; addons from `three/addons/…`.

## Camera discipline

- Keep near/far tight (e.g. 0.1–100, not 0.001–100000) — depth buffer
  precision; z-fighting usually traces here.
- Perspective fov 45–75 typical; orthographic for CAD/iso views.
- One camera per view; for inset views use viewport/scissor, not
  extra renderers.

## Lighting

| Light | Cost | Use |
|-------|------|-----|
| Environment map (IBL) | Cheap | PBR base lighting — `scene.environment` from HDR (RGBELoader + PMREMGenerator, or drei `<Environment>`) |
| Directional | Moderate (+shadow map) | Sun/key light; the usual single shadow caster |
| Ambient/Hemisphere | Trivial | Fill only — flattens if overused |
| Point/Spot | Per-light cost ×6 for point shadows | Sparingly; never dozens of shadow casters |

Shadows: `renderer.shadowMap.enabled = true`, per-object
`castShadow`/`receiveShadow`, and **fit the shadow camera frustum to
the scene** (too small = clipped shadows; too large = blocky).
`shadowMap.type = THREE.PCFSoftShadowMap` for quality. Bake static
shadows into textures where content allows.

## Colour management and tone mapping (most-broken area)

- Since r152 colour management is on by default:
  `renderer.outputColorSpace = THREE.SRGBColorSpace` (default — leave
  it).
- **Colour textures** (baseColor/emissive): `texture.colorSpace =
  THREE.SRGBColorSpace` (GLTFLoader sets this correctly; manual
  TextureLoader does NOT — set it yourself).
- **Data textures** (normal/roughness/metalness/AO): linear (default)
  — never sRGB.
- Tone mapping: `renderer.toneMapping = THREE.ACESFilmicToneMapping`
  (or AgX in newer releases) + `toneMappingExposure` for HDR-ish
  response; washed-out or oversaturated output is almost always a
  colour-space/tone-mapping mismatch, not a lighting problem.

## Materials baseline

`MeshStandardMaterial` (PBR) is the default; `MeshPhysicalMaterial`
adds clearcoat/transmission/sheen at cost; `MeshBasicMaterial` for
unlit. Share material instances across meshes; clone only when
per-object uniforms truly differ. `material.transparent` + sorting
issues: prefer `alphaTest` for cutouts; transparency ordering is
painterly, expect artefacts with intersecting glass.

## Scene graph hygiene

Group logically (`THREE.Group`); name nodes for debugging; static
subtrees: `matrixAutoUpdate = false` + one `updateMatrix()`. Use
`scene.traverse` for audits (dispose sweeps, shadow flags).
