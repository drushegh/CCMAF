---
name: unreal-engine-development
description: >-
  Unreal Engine 5 development: Blueprints vs C++ decisions, the gameplay
  framework (Actors, Pawns, GameMode, PlayerController), UCLASS/UPROPERTY
  reflection and garbage collection, modules and plugins, Enhanced Input,
  rendering features (Nanite, Lumen, Niagara, materials), asset pipeline
  and references, networking/replication basics, GAS awareness, and
  cooking/packaging/BuildGraph. Use for ANY work involving Unreal Engine,
  UE5, .uproject/.uplugin files, Blueprints, UCLASS macros, Unreal C++,
  or shipping UE titles/simulations.
---

# Unreal Engine Development

Standards for UE5 development. Source: a5c-ai/babysitter game-development
library (12 UE specialist skills, saved in Reference skills) + Epic
coding standards. UE ships ~2 releases/year on the 5.x line — verify
the current version and per-version feature maturity on Epic's release
notes before asserting (don't trust this file for "latest version").

## Blueprints vs C++ (the foundational decision)

| Put it in | When |
|-----------|------|
| **C++** | Core systems, performance-critical paths (per-tick logic at scale), engine/plugin APIs, anything needing strong typing/diff-able review, base classes that designers extend |
| **Blueprints** | Designer-facing tuning, content wiring, UI flows, one-off level logic, rapid prototyping |
| **Both (the standard pattern)** | C++ base class exposing `UPROPERTY(EditAnywhere)` knobs and `BlueprintCallable`/`BlueprintNativeEvent` hooks; Blueprint subclass for data and design iteration |

Heavy per-frame Blueprint logic and deep Blueprint inheritance chains
are the classic performance/maintainability failures — migrate hot
paths to C++ rather than fighting the VM.

## Non-negotiables

1. **Reflection discipline**: every UObject-derived class uses
   `UCLASS()`/`GENERATED_BODY()`; fields the engine must see
   (GC, serialisation, editor, replication, Blueprint) are
   `UPROPERTY(...)`; callable functions are `UFUNCTION(...)`.
   A raw pointer to a UObject without UPROPERTY is a dangling-pointer
   factory — the GC cannot see it.
2. **Garbage collection rules**: UObjects are GC-managed —
   `UPROPERTY` (use `TObjectPtr` for members in UE5) keeps them
   alive; `TWeakObjectPtr` for non-owning; never `new`/`delete`
   UObjects (`NewObject`, `CreateDefaultSubobject` in constructors,
   `SpawnActor` for actors). Non-UObject types use
   `TSharedPtr`/`TUniquePtr` — do NOT mix the two systems.
3. **Tick is a budget item**: disable tick where unused
   (`PrimaryActorTick.bCanEverTick = false`), use timers/delegates/
   events over polling, set tick intervals where latency tolerates.
4. **Gameplay framework roles are not suggestions**: rules in
   GameMode (server-only), replicated match state in GameState,
   player identity/state in PlayerState, input/possession in
   PlayerController, embodiment in Pawn/Character
   (`references/gameplay-framework.md`). Logic in the wrong class =
   broken multiplayer later.
5. **Module structure from day one**: gameplay in well-named modules
   (`.Build.cs` each), editor-only code in editor modules, reusable
   systems as plugins. IWYU-style includes; forward-declare in
   headers.
6. **Enhanced Input** (default since 5.1) for all new input — Input
   Actions + Mapping Contexts, not the legacy bindings.
7. **Asset references are architecture**: hard references load with
   the asset — chains of them load the whole game. Use soft
   references (`TSoftObjectPtr`) + async load for optional/heavy
   content; audit with the Reference Viewer and Size Map
   (`references/assets-build-packaging.md`).
8. **Epic coding standard** for C++ (prefixes A/U/F/E/I, PascalCase,
   `b` booleans); `const` correctness; no exceptions (engine
   convention) — use return values/optionals.

## Workflow

1. Project shape: pick template; set up modules/plugins; source
   control with proper `.gitignore`/LFS or Perforce (binary assets;
   One File Per Actor reduces conflicts).
2. Build C++ skeleton: gameplay framework classes, components,
   subsystems (`references/cpp-patterns.md`); expose designer knobs;
   compile clean with warnings-as-errors mentality.
3. Blueprint layer: subclass C++ bases for content; keep graphs
   shallow and event-driven (`references/blueprints-boundary.md`).
4. Features: rendering choices (Nanite/Lumen budgets), VFX, audio
   (`references/rendering-features.md`); multiplayer/GAS only with
   the patterns in `references/networking-gas.md`.
5. Test: Automation framework (unit + functional tests), PIE
   multiplayer-as-client testing early if networked.
6. Package: per-platform cooking, asset audits, BuildGraph/UAT CI
   (`references/assets-build-packaging.md`).

## High-frequency pitfalls

- Editing engine-visible state off the game thread (UObjects are not
  thread-safe; use tasks → game-thread marshalling).
- `Cast` chains hiding design problems — prefer interfaces
  (`UINTERFACE`) or components for cross-cutting behaviour.
- Constructors doing gameplay work: constructors run for CDOs at
  startup — gameplay init belongs in `BeginPlay`/`PostInitializeComponents`.
- Circular module dependencies (link errors late in the project) —
  layer modules deliberately.
- Forgetting `Super::` calls in overridden lifecycle methods.
- Blueprint spaghetti for systems C++ should own (save games,
  inventory backends, procedural logic).
- Shipping with uncontrolled asset bloat: no Size Map audits, hard
  references everywhere, uncompressed 4k textures from the art drop.

## References

| File | Load when |
|------|-----------|
| `references/gameplay-framework.md` | Actors/Pawns/GameMode/lifecycle/spawning |
| `references/cpp-patterns.md` | UCLASS macros, GC, pointers, modules, subsystems |
| `references/blueprints-boundary.md` | BP↔C++ interface, exposure specifiers, BP performance |
| `references/rendering-features.md` | Nanite, Lumen, materials, Niagara decisions |
| `references/assets-build-packaging.md` | Asset refs, cooking, packaging, BuildGraph/CI |
| `references/networking-gas.md` | Replication model, RPCs, GAS adoption |

## Boundaries with sibling skills

- Generic modern C++ (idioms, STL) → `dotnet-development` is NOT the
  place either — UE C++ is its own dialect; this skill owns it.
  tree-sitter parses standard C++; UE macros are structural-check
  territory.
- Asset authoring/export from DCC tools → `blender-development`.
- Browser 3D alternative → `threejs-development`; other engines →
  `unity-development` / `godot-development`.
- CI/CD pipeline hosting → `devops-development` (UAT/BuildGraph
  specifics stay here).
