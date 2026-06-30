---
name: unity-development
description: >-
  Unity 6.x development: C# MonoBehaviour scripting and lifecycle,
  ScriptableObject-driven data architecture, prefabs/variants, scene
  management, Addressables, the Input System, UI Toolkit vs uGUI, ECS/
  DOTS basics (core since 6.4), URP/render pipeline choices and the
  build pipeline (profiles, IL2CPP, CI batchmode). Use for ANY work
  involving Unity, MonoBehaviours, ScriptableObjects, prefabs, .unity
  scenes, Unity C#, Addressables, DOTS/ECS, or building/shipping Unity
  projects.
---

# Unity Development

Standards for Unity 6.x. Source: a5c-ai/babysitter unity skill set (16
skills, saved in Reference skills) + verified current platform state.

## Version state (June 2026 — verify on unity.com/releases)

Quarterly cadence: **Unity 6.4 (Mar 2026)** is the current supported
release — **ECS/Entities became a core package in 6.4** (Entities,
Collections, Mathematics, Entities Graphics built in); **6.3 LTS**
(supported to Dec 2027) is the production pin; 6.0 LTS support ends
Oct 2026 — plan upgrades. CoreCLR editor is roadmapped (~6.8) — the
.NET runtime story is changing; don't hard-code Mono assumptions in
long-lived advice. Pin the editor version per project
(ProjectVersion.txt) and match CI.

## Non-negotiables

1. **Serialization rules drive everything**: Unity serialises public
   fields and `[SerializeField]` privates (not properties, not
   readonly, not static). `[System.Serializable]` for nested classes.
   What the Inspector shows IS the serialised state — design data
   shapes accordingly.
2. **Destroyed objects are not null-but-equal-null**: UnityEngine
   .Object overloads `==` — destroyed objects compare `== null` but
   are not reference-null. Never use `?.`/`??` on UnityEngine.Object
   references (they bypass the overload); explicit `if (obj == null)`
   checks only.
3. **Cache component lookups**: `GetComponent` in `Update` is a
   per-frame search — fetch in `Awake`; never `GameObject.Find`/
   `FindObjectOfType` in hot paths (and prefer explicit references
   over Find entirely).
4. **Lifecycle discipline**: `Awake` = self-setup, `OnEnable` =
   subscribe, `Start` = cross-object init (all Awakes done),
   `OnDisable` = unsubscribe (symmetry!), `OnDestroy` = teardown.
   Physics in `FixedUpdate`, input/visuals in `Update`, camera follow
   in `LateUpdate`.
5. **ScriptableObjects are the data layer**: definitions, configs,
   shared state channels — not scene-bound MonoBehaviour fields
   copy-pasted per prefab (`references/scriptableobjects-data.md`).
6. **Addressables over Resources/**: the Resources folder defeats
   build stripping and loads eagerly; Addressables for anything
   loaded by reference at runtime (`references/prefabs-scenes.md`).
7. **Assembly definitions (.asmdef) from the start**: compile-time
   boundaries, faster iteration, testable modules; Editor code in
   Editor assemblies.
8. **Profile before optimising** (Profiler + Profile Analyzer +
   Memory Profiler on TARGET hardware) and mind GC: no per-frame
   allocations (string concat, LINQ, boxed closures in Update),
   pool spawned objects (`ObjectPool` is built in).
9. **New Input System** for new projects (action maps, rebinding,
   multi-device); legacy Input Manager only for maintenance
   (`references/input-ui.md`).

## Decision guides

- **Render pipeline**: URP is the general-purpose default
  (cross-platform, performant); HDRP for high-end visual targets;
  Built-in only in legacy maintenance. Choose ONCE — migrations are
  painful (`references/build-pipeline.md` notes).
- **GameObjects vs ECS**: MonoBehaviours for 95% of gameplay; ECS
  (core since 6.4) when entity counts × per-frame logic become the
  bottleneck (sims, swarms, massive worlds) or determinism demands
  it — hybrid approaches are normal (`references/ecs-dots.md`).
- **UI Toolkit vs uGUI**: UI Toolkit for editor tooling and
  increasingly for runtime UI (retained-mode, style sheets); uGUI
  remains fine for world-space and mature runtime patterns — check
  current feature parity before committing
  (`references/input-ui.md`).

## Workflow

1. Project setup: editor version pinned; URP template (usually);
   .gitignore (Library/, Temp/) + Git LFS for binaries; asmdef
   layout; folder convention.
2. Architecture: ScriptableObject data + thin MonoBehaviours;
   composition over inheritance; events/UnityEvents/C# events for
   decoupling (`references/csharp-scripting.md`).
3. Content: prefabs for everything instantiated (variants for
   flavours, nesting for assembly); scenes composed of prefabs;
   additive scene loading for streaming/large levels.
4. Test: Unity Test Framework (EditMode for logic, PlayMode for
   behaviour) in CI batchmode.
5. Build: Build Profiles (6.x) per target; Addressables build step;
   IL2CPP for release platforms; CI via batchmode CLI
   (`references/build-pipeline.md`).

## High-frequency pitfalls

- Subscribing in `OnEnable` without unsubscribing in `OnDisable`
  (leaks + ghost callbacks on pooled objects).
- Editing shared materials (`renderer.material` instantiates a copy
  per access; `sharedMaterial` mutates the asset — know which you
  want).
- Physics: moving static colliders, scaling rigidbodies per frame,
  raycasts without layer masks; `Time.deltaTime` in FixedUpdate
  (it's fixedDeltaTime there — fine, but mixing them up isn't).
- Coroutines die with their GameObject (disabled = stopped) —
  async/await continues after destruction unless cancelled
  (destroy-aware cancellation tokens; `destroyCancellationToken` in
  modern Unity).
- Prefab overrides drowning the variant system — apply/revert
  discipline; nested prefab edits in context.
- Build-only failures: platform-dependent compilation (`#if
  UNITY_ANDROID`), IL2CPP stripping reflection-used code (link.xml),
  case-sensitive paths on target platforms.

## References

| File | Load when |
|------|-----------|
| `references/csharp-scripting.md` | MonoBehaviour lifecycle, serialization, events, coroutines/async |
| `references/scriptableobjects-data.md` | SO architecture patterns, data-driven design |
| `references/prefabs-scenes.md` | Prefab workflows, scene management, Addressables |
| `references/ecs-dots.md` | Entities/Jobs/Burst basics and adoption decisions |
| `references/input-ui.md` | Input System, UI Toolkit/uGUI |
| `references/build-pipeline.md` | Build profiles, IL2CPP, CI batchmode, platforms |

## Boundaries with sibling skills

- C# language idioms, .NET libraries → `dotnet-development`
  (Unity's runtime constraints noted here where they differ).
- Asset authoring/export → `blender-development`.
- Engine alternatives → `unreal-engine-development`,
  `godot-development`, `threejs-development`.
- CI hosting/runners → `devops-development` (Unity batchmode
  specifics stay here).
