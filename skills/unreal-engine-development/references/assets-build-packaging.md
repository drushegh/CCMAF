# Assets, Build and Packaging

## Asset references (architecture-grade decision)

- **Hard reference** (UPROPERTY UObject*/TObjectPtr, BP variable
  defaults): referenced asset loads when the referencer loads. Chains
  of hard refs = monolithic load times and memory. Audit with
  **Reference Viewer** (right-click asset) and **Size Map**.
- **Soft reference** (`TSoftObjectPtr<T>` / `TSoftClassPtr<T>`): path
  only; load on demand:

```cpp
UPROPERTY(EditAnywhere, Category = "Loadout")
TSoftObjectPtr<USkeletalMesh> HeavyMesh;

void AMyActor::LoadMesh()
{
    Streamable = UAssetManager::GetStreamableManager()
        .RequestAsyncLoad(HeavyMesh.ToSoftObjectPath(),
            FStreamableDelegate::CreateUObject(this, &AMyActor::OnMeshReady));
}
```

- **Asset Manager + Primary Assets**: classify top-level content
  (levels, game modes, item definitions via `UPrimaryDataAsset`),
  drive chunking and bulk async loads; rules in Project Settings.

## Import pipeline

- Meshes/animation via FBX or **Interchange** framework (extensible
  import, glTF support); authoring conventions (scale, axes, naming)
  → `blender-development`.
- Textures: right compression per usage (default/normal/masks —
  sRGB OFF for data maps), power-of-two, mip policies, virtual
  textures for huge sets.
- Naming convention (`T_`, `SM_`, `SK_`, `M_`, `MI_`, `BP_`, `NS_`)
  + folder discipline — retrofitting naming on a mature project is
  misery; validate with the Asset Naming/Validation tooling.
- Source control: Perforce is the native-fit (file locking for
  binaries); Git needs LFS + One File Per Actor + lock workflow
  agreements.

## Cooking and packaging

- **Cook** = bake assets per platform; **package** = cook + compile +
  stage + archive (Project Launcher/UAT). Shipping config for
  release; Development for profiling; DebugGame for source debugging.
- Cook discovery: anything referenced from startup maps, Asset
  Manager rules, `+DirectoriesToAlwaysCook`, and primary asset
  chunks. Unreferenced ≠ cooked — "works in editor, missing in
  build" usually means an asset only reachable by string path
  (use soft refs registered with Asset Manager instead).
- Pak/chunking: chunk IDs via Asset Manager for patch/DLC
  separation; IoStore/Zen streaming formats per version defaults.
- Per-platform: device profiles control scalability; check
  platform-specific texture formats and shader permutation compile
  times (cold shader cooks are slow — share DDC, see below).

## Automation: UAT/UBT/BuildGraph

```bash
# canonical one-line package (RunUAT)
RunUAT BuildCookRun -project=MyGame.uproject -platform=Win64 \
  -clientconfig=Shipping -build -cook -stage -pak -archive \
  -archivedirectory=/builds/MyGame
```

- **UnrealBuildTool (UBT)** compiles modules; **AutomationTool
  (UAT)** orchestrates; **BuildGraph** (XML graphs) for real CI
  pipelines (parallel per-platform nodes, test gates).
- CI essentials: shared **Derived Data Cache (DDC)** (network/cloud
  DDC) or cooks take hours; incremental builds on persistent agents
  or warm caches; run Automation tests (`-ExecCmds="Automation
  RunTests MyGame"`) as a gate; binary asset validation
  (`EditorValidator` subclasses) on PRs.
- Build hosting/agents wiring → `devops-development`; the UE
  specifics (UAT calls, DDC, test invocation) stay here.

## Size and performance audits before ship

Size Map per chunk; `MemReport -full` in-game; Unreal Insights trace
on target hardware; obliterate: editor-only assets in cook, debug
textures, uncompressed audio, duplicated megatextures. Asset audits
are cheapest BEFORE content lock.
