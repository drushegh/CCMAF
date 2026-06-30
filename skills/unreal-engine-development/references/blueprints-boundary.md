# Blueprints and the C++ Boundary

## The standard architecture

C++ owns the skeleton, Blueprints own the flesh: a C++ base class per
gameplay concept exposing tunables (`EditAnywhere`) and hooks
(`BlueprintNativeEvent`/`BlueprintImplementableEvent`); designers
subclass in Blueprint, set data, wire content, and override hooks.
Content references (meshes, sounds, effects) live in the Blueprint —
keeping C++ free of asset paths.

| Exposure | Direction | Use |
|----------|-----------|-----|
| `BlueprintCallable` | BP calls C++ | Commands with side effects |
| `BlueprintPure` | BP calls C++ | Getters/maths (no exec pin — MUST be cheap and side-effect free; pure nodes re-evaluate per connected pin use) |
| `BlueprintImplementableEvent` | C++ calls BP | Designer-defined reactions, no C++ default |
| `BlueprintNativeEvent` | C++ calls BP (default in C++) | Same with `_Implementation` fallback |
| `BlueprintAssignable` delegates | BP binds to C++ events | Event-driven wiring |

Blueprint Function Libraries (`UBlueprintFunctionLibrary`) for
stateless utilities; Blueprint Interfaces when designers need
contracts without C++.

## Blueprint craft rules

- **Event-driven, not Tick**: BP Tick at scale is the #1 BP perf
  sin — timers, delegates, overlap events instead.
- Keep graphs shallow: collapse to functions/macros; one screen per
  function as the readability bar; comment boxes for flow.
- Pure-node fan-out: an expensive pure node wired to five pins runs
  five times — cache into a local variable node.
- Avoid deep BP-inheritance + circular BP references (load-time and
  compile cascade pain); prefer composition via child actor/
  components or interfaces.
- Data-only Blueprints (subclass with only property overrides) are
  cheap and diff-friendly; logic-bearing BP assets are binary —
  meaningful review requires editor diff tooling, so keep reviewable
  logic in C++.
- Construction Scripts run in-editor on every move/property change —
  keep them light; no gameplay side effects.

## Data-driven design

- `UDataAsset`/`UPrimaryDataAsset` for typed static data
  (item definitions, enemy archetypes) — preferable to config-on-
  Blueprint for shared data.
- `UDataTable` (+ `FTableRowBase` structs) for spreadsheet-style
  data with CSV/JSON import.
- Gameplay Tags (`FGameplayTag`, editor-managed hierarchy) for
  extensible enums/queries — the idiomatic labelling system (and the
  backbone of GAS — `networking-gas.md`).
- Curves (`UCurveFloat`) for designer-tunable response curves.

## When to migrate BP → C++

Triggers: per-frame logic, large loops, deep call chains in hot
paths, multiplayer-authoritative logic, anything needing code review
rigour, VM overhead showing in `stat game`/Unreal Insights traces.
Mechanical approach: reproduce the BP logic in a C++ base
(`BlueprintNativeEvent` hooks preserved), reparent the Blueprint to
the new base, delete migrated nodes, keep designer knobs.
(Blueprint nativization was removed circa UE 5.0 — don't propose it.)

## UI (UMG) boundary

Widget logic in C++ `UUserWidget` bases (`meta=(BindWidget)` to
attach designer-laid-out elements), visuals/animation in the widget
Blueprint; CommonUI for input-mode-aware menu stacks. ViewModels
(UMG ViewModel/MVVM plugin) for data binding in newer UE — verify
plugin maturity per engine version.

## Debugging across the boundary

PIE + breakpoints work in both worlds (VS/Rider for C++, graph
breakpoints + watch in BP); `PrintString` is fine for spike checks,
`Visual Logger` and `GameplayDebugger` for systemic state; BP→C++
call stacks visible in Unreal Insights traces.
