# Asset Pipeline and Loaders

## The pipeline: glTF 2.0 (GLB) or convert to it

glTF is three.js's first-class format (PBR materials, animations,
skins, morph targets, extensions). FBX/OBJ/STL loaders exist for
interchange but lose fidelity — convert in the DCC tool
(`blender-development` covers export conventions).

Compression stack for production:

| Layer | Tool | Notes |
|-------|------|-------|
| Geometry | **Draco** or **meshopt** | Draco = best ratio, decode cost + wasm decoder to host; meshopt (via gltfpack) = near-instant decode, great default |
| Textures | **KTX2 (Basis Universal)** | GPU-native compressed, transcodes per device; huge VRAM + download savings vs PNG/JPEG |
| Whole file | `gltf-transform` / `gltfpack` CLI | Dedupe, prune, resize, quantise in CI |

```javascript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

const draco = new DRACOLoader().setDecoderPath('/draco/');
const ktx2 = new KTX2Loader().setTranscoderPath('/basis/')
  .detectSupport(renderer);

const loader = new GLTFLoader()
  .setDRACOLoader(draco)
  .setKTX2Loader(ktx2);

const gltf = await loader.loadAsync('/models/scene.glb');
scene.add(gltf.scene);
```

Decoder/transcoder wasm files must be hosted with the app (or CDN) —
the loader paths above are not optional decoration.

## Texture rules

- Power-of-two dimensions where mipmaps matter; cap sizes (1k–2k for
  most web use; 4k only with justification).
- `TextureLoader`-loaded colour maps need
  `texture.colorSpace = THREE.SRGBColorSpace` manually
  (GLTFLoader handles it).
- `anisotropy = renderer.capabilities.getMaxAnisotropy()` for
  ground/oblique surfaces.
- Reuse texture instances; dispose dynamically created ones.

## Loading UX

- `LoadingManager` for aggregate progress (onProgress/onLoad/onError)
  in vanilla; R3F uses Suspense + drei `useProgress`/`<Loader>`.
- Await critical assets before first render (flash-of-empty-scene and
  shader-compile jank otherwise); consider
  `renderer.compileAsync(scene, camera)` to pre-warm shaders.
- Lazy-load secondary content after first paint; prioritise the hero
  asset.
- HDR environments: `RGBELoader` + `PMREMGenerator` (or drei
  `<Environment>` presets) — .hdr files are big; use compressed
  alternatives where possible.

## Asset hygiene in CI

Run `gltf-transform optimize` (or gltfpack) on commit: prune unused
nodes/materials, dedupe accessors, quantise, compress. Budget checks:
fail builds over agreed triangle/texture/file-size budgets — 3D asset
bloat is invisible until mobile users churn.

## Loading from user uploads (configurator/CMS scenarios)

Validate file type/size server-side; parse in a worker where
feasible; glTF can embed external URIs — resolve/strip them
(SSRF-adjacent, see `secure-development`); never `eval`-style trust
in extensions data.
