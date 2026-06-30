# The Gameplay Framework

## Class roles (multiplayer-correct from the start)

| Class | Lives | Role |
|-------|-------|------|
| `AGameModeBase`/`AGameMode` | **Server only** | Rules: spawning, win conditions, player admission. Never store anything clients must read |
| `AGameStateBase`/`AGameState` | Server + replicated | Match-wide replicated state (score, phase, timers) |
| `APlayerController` | One per player (own client + server) | Input, camera management, possession, UI ownership; survives pawn death |
| `APlayerState` | Replicated per player | Player identity/stats visible to everyone (name, score, team) |
| `APawn` / `ACharacter` | Replicated | The possessed embodiment; Character adds CharacterMovementComponent (networked movement, capsule, skeletal mesh) |
| `UGameInstance` | One per process, whole session | Cross-level persistence (profiles, session state); subsystem host |
| `AHUD` / UMG widgets | Owning client | Per-player UI (UMG is the modern path; CommonUI for gamepad/cross-platform menus) |

Wrong-home symptoms: "works in PIE, breaks in multiplayer" usually
means client-needed data in GameMode or authority logic in Pawns.

## Actor lifecycle

Constructor (CDO-safe setup only: `CreateDefaultSubobject`, defaults)
→ `PostInitializeComponents` → `BeginPlay` (gameplay init) → ticking/
events → `EndPlay` (cleanup, reason enum) → GC. Spawning:
`GetWorld()->SpawnActor<T>(Class, Transform, Params)`; deferred
spawn (`SpawnActorDeferred`) to set properties before construction
scripts run. `Destroy()` marks for removal — references via UPROPERTY
null out; raw pointers dangle.

## Components

- `UActorComponent` (behaviour, no transform), `USceneComponent`
  (transform, attachable), `UPrimitiveComponent` (rendering/
  collision).
- Composition over inheritance: prefer a `UHealthComponent` reused
  across actor types to a deep AActor hierarchy.
- Create in constructor with `CreateDefaultSubobject<T>(TEXT("Name"))`;
  attach scene components into one hierarchy under the root.

## Subsystems (the singleton replacement)

Auto-instanced engine-managed services keyed by lifetime:
`UGameInstanceSubsystem` (whole session), `UWorldSubsystem` (per
world/level), `ULocalPlayerSubsystem` (per local player),
`UEditorSubsystem`. Access:
`GetGameInstance()->GetSubsystem<UMySubsystem>()`. Use them for
managers (save, analytics, inventory services) instead of
singleton-Actors placed in maps.

## Possession and input flow

PlayerController possesses Pawn; input arrives at the controller and
routes to the pawn. **Enhanced Input**: `UInputAction` assets
(value types: bool/Axis1D/2D/3D) + `UInputMappingContext` (bindings,
modifiers, triggers); add contexts via the local player's
`UEnhancedInputLocalPlayerSubsystem` with priorities; bind in
`SetupPlayerInputComponent`:

```cpp
void AMyCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
    Super::SetupPlayerInputComponent(PlayerInputComponent);
    auto* EIC = CastChecked<UEnhancedInputComponent>(PlayerInputComponent);
    EIC->BindAction(MoveAction, ETriggerEvent::Triggered, this, &AMyCharacter::Move);
    EIC->BindAction(JumpAction, ETriggerEvent::Started, this, &ACharacter::Jump);
}
```

Context add/remove is how you switch input modes (menus, vehicles).

## Levels and world structure

- **World Partition** (UE5 default for large worlds): automatic
  streaming grid + One File Per Actor (collaborative editing); data
  layers for variant content.
- Level streaming (classic sublevels) still fine for interiors/
  chunked linear games.
- `AWorldSettings` per level; persistent level owns global actors.
- Lifecycle caution: streamed-out actors' references — soft
  references and weak pointers across streaming boundaries.

## Timers, delegates, events

`GetWorldTimerManager().SetTimer(...)` over tick polling; dynamic
multicast delegates (`DECLARE_DYNAMIC_MULTICAST_DELEGATE`) for
BP-bindable events; native delegates for C++-only (cheaper). Unbind
in `EndPlay` to avoid calls into dead objects.
