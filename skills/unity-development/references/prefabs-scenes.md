# Prefabs, Scenes and Addressables

## Prefab discipline

- Everything instantiated more than once is a prefab; everything
  designed as a unit is a prefab. Scene-only one-offs are the
  exception, not the rule.
- **Variants** for flavours (EnemyGrunt_Fast variant of EnemyGrunt):
  inherit base changes, override deltas. **Nested prefabs** for
  assembly (turret prefab inside tank prefab).
- Override hygiene: apply intentional overrides to the prefab (or
  variant), revert accidents — scenes full of stray overrides make
  base-prefab edits unpredictable. Review override lists before
  committing scenes.
- Edit in Prefab Mode (isolation/in-context), not by hacking
  instances.
- Spawning: `Instantiate(prefab, pos, rot, parent)`; pool
  frequently spawned/destroyed things —
  `UnityEngine.Pool.ObjectPool<T>` with OnGet/OnRelease resets
  (remember event unsubscribe symmetry on pooled objects).

## Scene architecture

- Compose scenes from prefabs; keep scenes thin (placement +
  lighting + bake data).
- **Additive loading** for structure: persistent "Core" scene
  (managers, UI, audio) + content scenes loaded/unloaded additively
  (`SceneManager.LoadSceneAsync(name, LoadSceneMode.Additive)`);
  `SetActiveScene` controls lighting/new-object target.
- Async always for runtime loads (`allowSceneActivation` for
  loading-screen gating); scene handles for unloading.
- Cross-scene references don't serialise — communicate via SO
  channels (`scriptableobjects-data.md`) or runtime lookup at load.
- Multi-scene editing in the editor mirrors the runtime additive
  setup — keep them aligned.
- Team hygiene: scene files conflict badly — split work via additive
  scenes (one person per scene), prefab-first workflows, and Unity's
  Smart Merge (UnityYAMLMerge) configured in the VCS.

## Addressables (the asset delivery system)

Resources/ is legacy: eager, unstripped, memory-hostile. Addressables
load by address/label/`AssetReference` with dependency-aware bundles
and ref-counted unloading:

```csharp
using UnityEngine;
using UnityEngine.AddressableAssets;
using UnityEngine.ResourceManagement.AsyncOperations;

public class BossSpawner : MonoBehaviour
{
    [SerializeField] private AssetReferenceGameObject bossPrefab;

    private AsyncOperationHandle<GameObject> _handle;

    private async void SpawnBoss()
    {
        _handle = bossPrefab.InstantiateAsync(transform.position, Quaternion.identity);
        GameObject boss = await _handle.Task;
        // ...
    }

    private void OnDestroy()
    {
        if (_handle.IsValid())
            Addressables.ReleaseInstance(_handle);
    }
}
```

Rules:

- **Every load pairs with a release** (`Release`/`ReleaseInstance`) —
  leaks here are memory bloat on device.
- `AssetReference` fields in prefabs/SOs replace hard references for
  heavy content (keeps initial scene load light).
- Groups/labels define bundle layout: group by load-together
  patterns (per level, per feature); local vs remote groups enable
  content updates/DLC without app updates (catalog updates).
- Build Addressables content as a build step (player build alone is
  not enough) — wire into CI (`build-pipeline.md`).
- Profiler + Addressables Event Viewer/Profiler module to verify
  what's resident; duplicate-asset-in-multiple-bundles warnings
  matter (shared dependencies get their own group).
- Sync `WaitForCompletion()` exists for tooling — avoid on the hot
  path/main thread in gameplay.

## Asset import hygiene

Import settings are per-asset code review material: texture max
size/compression per platform (overrides), sprite atlases for UI,
model import (read/write OFF unless needed — doubles memory),
audio compression/load type per clip length. Presets (+ Preset
Manager) enforce defaults; an AssetPostprocessor script enforces
team rules mechanically.
