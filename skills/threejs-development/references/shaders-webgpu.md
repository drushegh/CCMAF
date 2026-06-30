# Shaders, TSL and WebGPU

## Choosing the rendering path (June 2026 state — verify currency)

| | WebGLRenderer | WebGPURenderer |
|---|---|---|
| Browser reach | Universal | Modern Chrome/Edge/Firefox; Safari arriving — check caniuse at decision time |
| Shaders | GLSL (ShaderMaterial / onBeforeCompile) | **TSL** (compiles to WGSL, falls back to GLSL/WebGL2 automatically) |
| Compute | GPGPU hacks via render targets | First-class compute shaders |
| Default advice | Safe default for broad-reach public sites | New projects wanting TSL/compute — WebGPURenderer falls back to WebGL where unsupported |

WebGPURenderer init is async (`await renderer.init()` or use
`renderAsync`); feature-detect, don't UA-sniff.

## Custom shaders in WebGL: the escalation ladder

1. Built-in material + maps/uniform tweaks (most needs end here).
2. `material.onBeforeCompile` — patch built-in shaders, keep
   lighting/shadow code. Brittle across versions: pin and re-test on
   upgrades.
3. `ShaderMaterial` (your GLSL, three provides built-in
   uniforms/attributes) / `RawShaderMaterial` (nothing provided).

```javascript
const material = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color('#3a7bd5') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform vec3 uColor;
    varying vec2 vUv;
    void main() {
      float pulse = 0.5 + 0.5 * sin(uTime + vUv.x * 6.2831);
      gl_FragColor = vec4(uColor * pulse, 1.0);
    }`,
});
// per frame: material.uniforms.uTime.value = clock.getElapsedTime();
```

GLSL rules: update uniform `.value` (cheap) — never rebuild the
material; varyings carry vertex→fragment data; mind precision on
mobile (`mediump` artefacts); branchless tricks (`mix`/`step`) over
heavy `if`s in fragments.

## TSL (Three.js Shading Language)

Node-based shader authoring in JavaScript — the forward path for
custom shading (replaces onBeforeCompile patching; renderer-agnostic:
compiles WGSL for WebGPU, GLSL for WebGL fallback).

- Node materials: `MeshStandardNodeMaterial` etc. with slots —
  `colorNode`, `positionNode`, `normalNode`, `emissiveNode`,
  `opacityNode`.
- Compose with TSL functions: `Fn()`, `uniform()`, `attribute()`,
  `uv()`, `positionLocal`, math ops, `mix/step/smoothstep`,
  conditionals (`If`/`select`), built-in noise
  (`mx_noise_float`, `mx_fractal_noise_*`), texture sampling, and
  swizzling (`.xyz`).
- Compute: TSL compute shaders for particles/GPGPU on WebGPU —
  storage buffers, workgroup memory for the heavy cases; indirect
  draws for GPU-driven rendering.
- The TSL surface evolves quickly — work from current three.js docs/
  examples for exact imports (`three/tsl`), and pin the three version
  in projects using it. emalorenzo's three-best-practices (Reference
  skills) carries a full TSL rule set incl. GLSL→TSL translation.

## Post-processing

WebGL: `EffectComposer` + passes (RenderPass, UnrealBloomPass, SSAO,
SMAA/FXAA — note MSAA is lost in render targets unless using
multisampled RTs). Every pass is a full-screen draw; combine and
budget (`performance.md`). WebGPU/TSL: post effects as node graphs
(bloom, dof, ao) — same budgeting logic. R3F: prefer
`@react-three/postprocessing` (merges passes).

## Shader debugging

Output intermediates as colour (`gl_FragColor = vec4(vec3(value),
1.0)`); Spector.js frame capture; start from a known-good minimal
shader and add stages; NaNs render black — guard divisions and
`pow(negative, x)`.
