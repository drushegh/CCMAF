# ScriptableObject Architecture

SOs are assets holding data + light logic, independent of scenes.
They are the difference between a data-driven project and prefab
copy-paste sprawl.

## Definition assets (the bread and butter)

```csharp
using UnityEngine;

[CreateAssetMenu(menuName = "Game/Item Definition", fileName = "Item_")]
public class ItemDefinition : ScriptableObject
{
    [SerializeField] private string displayName;
    [SerializeField] private Sprite icon;
    [SerializeField] private int maxStack = 99;
    [SerializeField] private int value;

    public string DisplayName => displayName;
    public Sprite Icon => icon;
    public int MaxStack => maxStack;
    public int Value => value;
}
```

Public read-only surface, serialised private fields. Designers
create/edit assets; code references them
(`[SerializeField] private ItemDefinition item;`). Enemy archetypes,
weapon stats, dialogue, level metadata — all this pattern.

## Runtime state rules (the trap)

- In the EDITOR, runtime changes to SO fields persist (it's the
  asset); in BUILDS they reset per session. Never store live game
  state in definition SOs.
- Pattern: definition SO (immutable) + runtime instance class
  (plain C#) constructed from it, or
  `Instantiate(soAsset)` for a runtime copy when SO-typed state is
  needed.
- `hideFlags`/`ScriptableObject.CreateInstance<T>()` for transient
  runtime SOs created in code.

## Event channels (decoupling pattern)

```csharp
[CreateAssetMenu(menuName = "Game/Events/Void Event")]
public class VoidEventChannel : ScriptableObject
{
    public event System.Action Raised;
    public void Raise() => Raised?.Invoke();
}
```

Raiser and listeners reference the same asset — no scene references,
prefabs stay self-contained, systems testable in isolation. Typed
variants (`EventChannel<T>`) for payloads. Listeners subscribe
OnEnable/unsubscribe OnDisable. Use for cross-system signals
(player died, scene-load requests); don't replace local C# events.

## Runtime sets / registries

SO holding a `List<T>` that members register into on
OnEnable/OnDisable (active enemies, spawn points) — consumers query
the set without Find calls or singletons. Clear on play-session
start (domain-reload caveat in `csharp-scripting.md`).

## Shared variable/config channels

`FloatVariable`-style SOs (a value + change event) let designers wire
"player health" to UI without coupling — powerful but governable:
document ownership (who writes), or prefer explicit systems for
anything with real invariants.

## System/service SOs

SOs can host stateless logic (strategy pattern: an `AttackBehaviour`
SO with `Execute(context)` overridden in subclasses — designers
compose behaviours in data). Keep them stateless; state lives in the
caller's context object.

## Practical discipline

- Naming convention + folders per type (`Items/`, `Events/`); the
  CreateAssetMenu `fileName` seeds it.
- Validation: `OnValidate()` for editor-time field checks; an
  EditMode test sweeping all SO assets of a type for integrity
  (missing icons, duplicate ids) catches designer slips cheaply.
- Asset references inside SOs are hard references — heavy chains
  pull content into memory; use `AssetReference` (Addressables) in
  SO fields for big payloads (`prefabs-scenes.md`).
- Don't over-architect: three event channels and twenty definition
  types is normal; a 200-asset "SO framework" replacing all code is
  not the goal.
