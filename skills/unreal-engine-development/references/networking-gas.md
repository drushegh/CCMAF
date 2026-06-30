# Networking, Replication and GAS (awareness-to-working level)

## The model: server-authoritative replication

Dedicated/listen server owns truth; clients render predictions and
receive replicated state. Every networked feature answers: who has
authority (`HasAuthority()`), what replicates, and what's predicted.

### Replicating state

```cpp
UPROPERTY(ReplicatedUsing = OnRep_Health)
float Health;

void AMyCharacter::GetLifetimeReplicatedProps(
    TArray<FLifetimeProperty>& OutLifetimeProps) const
{
    Super::GetLifetimeReplicatedProps(OutLifetimeProps);
    DOREPLIFETIME(AMyCharacter, Health);
    DOREPLIFETIME_CONDITION(AMyCharacter, Stamina, COND_OwnerOnly);
}

UFUNCTION()
void OnRep_Health();   // client-side reaction (UI, effects)
```

- Actor must have `bReplicates = true`; movement via
  `SetReplicateMovement` or CharacterMovement's built-in networking.
- `OnRep_` functions fire on clients when the value arrives — drive
  cosmetic reactions there, never gameplay authority.
- Conditions (`COND_OwnerOnly`, `COND_SkipOwner`, …) and
  `NetUpdateFrequency`/dormancy control bandwidth.
- Only UPROPERTY-marked, registered properties replicate; TArrays of
  structs replicate whole-array (consider `FFastArraySerializer` for
  big lists).

### RPCs

`UFUNCTION(Server, Reliable)` client→server commands (validate
server-side — `WithValidation` for cheat checks);
`UFUNCTION(Client, Reliable)` server→owning client;
`UFUNCTION(NetMulticast, Unreliable)` server→everyone (cosmetic
events). Reliable RPC spam saturates the channel — state changes
belong in replicated properties, not repeated multicasts.

### Relevancy and testing

Actors replicate only to clients they're relevant to (distance/
ownership rules; Replication Graph or Iris for big player counts —
version-check Iris maturity). TEST EARLY: PIE with 2+ clients +
simulated latency/packet loss (`p.NetEmulation.*` / PIE network
settings); single-player-tested netcode is fiction.

## Gameplay Ability System (GAS)

Epic's framework for abilities/attributes/effects with built-in
replication and prediction. **Adopt when**: multiplayer with
nontrivial ability interactions (cooldowns, buffs/debuffs, stacking,
resource costs), or single-player RPG-depth stat systems. **Skip
when**: simple shooters/puzzles — its learning curve outweighs wins.

Building blocks:

| Piece | Role |
|-------|------|
| `UAbilitySystemComponent` (ASC) | Per-actor hub (on PlayerState for player-persistent stats) |
| `UAttributeSet` | Replicated numeric stats (`FGameplayAttributeData` + `ATTRIBUTE_ACCESSORS`); clamp in `PreAttributeChange`/`PostGameplayEffectExecute` |
| `UGameplayAbility` | Activatable logic; instancing policy; costs/cooldowns as effects; ability tasks for async (montages, waits) |
| `UGameplayEffect` | Data-driven attribute modification: Instant / Duration / Infinite; stacking rules; executions for complex maths |
| Gameplay Tags | The glue: ability activation conditions, immunity, state flags — design the tag taxonomy FIRST |
| Gameplay Cues | Replicated cosmetic reactions (VFX/SFX) keyed by tag |

Adoption path: enable GameplayAbilities plugin → ASC + AttributeSet
on the framework classes → one ability and one effect end-to-end →
expand. Epic's Lyra sample is the reference architecture for
production GAS (and modern UE structure generally) — mine it before
inventing conventions. Community documentation (the well-known GAS
documentation repo) fills Epic's gaps; verify against current engine
version.

## Sessions and transport

OnlineSubsystem (Steam/EOS/platform) for sessions/presence; EOS for
cross-platform free tier. Travel: `ServerTravel` (seamless with
transition map) vs `ClientTravel`. NAT/infrastructure and dedicated
server hosting are deployment concerns → coordinate with
`devops-development` for CI building of server targets.
