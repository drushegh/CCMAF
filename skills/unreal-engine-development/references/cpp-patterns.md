# Unreal C++ Patterns

UE C++ is a dialect: reflection macros, engine-managed memory, no
exceptions, engine containers (`TArray`, `TMap`, `FString`/`FName`/
`FText`) over STL in engine-facing code.

## Class anatomy

```cpp
UCLASS(Blueprintable)
class MYGAME_API AMyCharacter : public ACharacter
{
    GENERATED_BODY()

public:
    AMyCharacter();

    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Stats",
              meta = (ClampMin = "0.0"))
    float MaxHealth = 100.f;

    UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
    TObjectPtr<UHealthComponent> Health;

    UFUNCTION(BlueprintCallable, Category = "Combat")
    void ApplyDamage(float Amount);

    UFUNCTION(BlueprintNativeEvent, Category = "Combat")
    void OnDamaged(float Amount);          // C++ default + BP override

protected:
    virtual void BeginPlay() override;
};
```

`MYGAME_API` export macro on public classes; one class per
header; `#include` minimal + forward declarations (IWYU).

## Specifier cheat rows (the ones that matter)

- UPROPERTY visibility: `EditAnywhere` / `EditDefaultsOnly` /
  `VisibleAnywhere`; BP access: `BlueprintReadWrite` /
  `BlueprintReadOnly`; replication: `Replicated` /
  `ReplicatedUsing=OnRep_X`; `Transient` (don't serialise),
  `meta=(ClampMin/ClampMax, AllowPrivateAccess)`.
- UFUNCTION: `BlueprintCallable`, `BlueprintPure` (no exec pins —
  must be side-effect free), `BlueprintImplementableEvent` (BP-only
  body), `BlueprintNativeEvent` (+ `_Implementation` in C++),
  `Server`/`Client`/`NetMulticast` + `Reliable` (RPCs),
  `CallInEditor`.
- UCLASS: `Blueprintable`, `BlueprintType`, `Abstract`, `Config=Game`.

## Memory and pointers

| Situation | Use |
|-----------|-----|
| UObject member (owning/seen-by-GC) | `UPROPERTY() TObjectPtr<T>` |
| UObject non-owning/optional | `TWeakObjectPtr<T>` (check `IsValid()`) |
| UObject construction | `NewObject<T>()`; subobjects in constructors via `CreateDefaultSubobject`; actors via `SpawnActor` |
| Non-UObject heap types | `TUniquePtr` / `TSharedPtr` / `TSharedRef` (never on UObjects) |
| Struct data | `USTRUCT(BlueprintType)` + `GENERATED_BODY()`; value semantics |

GC truths: unmarked raw UObject pointers are invisible to GC (dangle
after collection); `IsValid(Ptr)` checks pending-kill; clear
delegates/timers in `EndPlay`. Containers of UObject pointers must be
`UPROPERTY()` too.

## Strings

`FName` (interned, comparisons, identifiers), `FString` (mutable
manipulation), `FText` (display + localisation — anything a user
sees). `TEXT("...")` macro on all literals.

## Modules and plugins

- Module = `.Build.cs` + `IMPLEMENT_MODULE`/`IMPLEMENT_PRIMARY_GAME_MODULE`;
  declare dependencies in `PublicDependencyModuleNames` /
  `PrivateDependencyModuleNames` (private unless headers expose it).
- Editor-only code → separate editor module (`"Type": "Editor"` in
  .uproject) — shipping builds must not link editor modules.
- Plugin = self-contained modules + `.uplugin` + content; the unit of
  reuse across projects. Keep gameplay plugins engine-version-agile
  (no engine-private includes).

## Subsystems, interfaces, async

- Subsystems for services (see `gameplay-framework.md`).
- Interfaces: `UINTERFACE(MinimalAPI, Blueprintable)` + `IMyInterface`
  pair; check with `Implements<UMyInterface>()`; call BP-implementable
  members via `IMyInterface::Execute_Foo(Obj, ...)`.
- Async: `AsyncTask(ENamedThreads::...)`, `FRunnable` for long-lived
  threads, `UE::Tasks` for task graph — **touch UObjects only on the
  game thread**; marshal results back via game-thread tasks.
- Slow loads: `FStreamableManager`/`UAssetManager` async loads with
  soft references (`assets-build-packaging.md`).

## Testing and logging

- Automation framework: `IMPLEMENT_SIMPLE_AUTOMATION_TEST` for unit
  tests, functional tests as level-based AFunctionalTest for gameplay;
  run via session frontend or `-ExecCmds="Automation RunTests ..."`
  in CI.
- `DECLARE_LOG_CATEGORY_EXTERN`/`DEFINE_LOG_CATEGORY` per system;
  `UE_LOG(LogMyGame, Warning, TEXT("%s"), *Name)`; `check()`/
  `ensure()` for invariants (ensure logs without crashing shipping).

No UE-aware parser exists in most toolchains outside the engine —
treat compile-in-editor (or UBT in CI) as the only real verification
of UE C++.
