# Rendering Features (decision-level)

UE5's marquee features have real costs and constraints — adopt
deliberately, not by default. Per-version maturity moves every
release; verify limitations (platform support, feature interactions)
in current docs before committing a project to them.

## Nanite (virtualised geometry)

- What: micro-polygon streaming for opaque static meshes — film-
  density assets without manual LODs.
- Use when: dense static environments, photogrammetry/megascans
  content, reducing LOD authoring labour.
- Constraints to check per version: materials (masked/translucent
  support has evolved), skeletal/deforming meshes, mobile support,
  aggregate geometry (foliage) behaviour. Overdraw of kitbashed
  stacked geometry is its classic cost spike.
- Not a licence for unbounded source assets: disk size and memory
  still pay; keep import-time sanity.

## Lumen (dynamic GI + reflections)

- What: real-time global illumination and reflections — no lightmap
  baking, dynamic time-of-day for free.
- Cost: meaningful GPU budget; quality scales with hardware ray
  tracing where available (software path otherwise).
- Use when: dynamic lighting matters or baking is impractical
  (large/streaming worlds, user-generated content).
- Skip when: fixed lighting + tight GPU budget (arch-viz stills,
  low-end targets) — baked lightmaps still beat it for cost/quality
  in static scenes.
- Tune via scalability settings and Post Process volume controls;
  mind translucency and emissive-as-lighting behaviours.

## Virtual Shadow Maps

Pair with Nanite for high-detail shadows; budget-sensitive — review
their cost on non-Nanite content and lower-end targets vs classic
shadow maps.

## Materials

- Master material + **Material Instances** is the law: artists tune
  instance parameters; shader permutations stay controlled. Every
  unique master = compile cost and permutation explosion risk.
- Material Functions for shared node logic; Material Parameter
  Collections for global scalars (wind, weather).
- `Switch` parameters multiply permutations — use sparingly.
- Per-platform cost: instruction counts and texture samplers in the
  material stats panel; translucency and POM are the usual offenders.
- Substrate (newer material framework) — check maturity/enablement
  per engine version before adopting.

## Niagara (VFX)

- The particle system (Cascade is legacy/removed): emitters composed
  of modules; systems composed of emitters; user parameters to drive
  from gameplay (`SetNiagaraVariable*`).
- GPU sims for counts beyond ~thousands; collision via depth buffer
  or distance fields (cheap) vs scene queries.
- Reuse via emitter inheritance and parameter-driven variants, not
  copy-paste systems.
- Budget: effects quality scalability, fixed bounds (avoid per-frame
  bounds calc), pooling for frequently spawned systems.

## Post-processing and scalability

Post Process Volumes own tone mapping/exposure/effects; one unbound
volume as the project baseline. Build scalability settings
(`Engine.ini` device profiles, `sg.*` groups) early; expose a
quality menu mapping to them. Profile with **Unreal Insights**,
`stat unit` / `stat gpu`, and GPU dumps before optimising.

## Audio note

MetaSounds is the modern procedural audio system (DSP graphs,
sample-accurate timing) — prefer it over legacy Sound Cues for new
projects; submixes for mixing/effects buses.

## Animation note

Animation Blueprints (state machines, blend spaces) for characters;
Control Rig for procedural/rig-based animation; Sequencer for
cinematics. Deep animation work is its own specialism — the saved
a5c reference skills (control-rig, sequencer) cover starting points.
