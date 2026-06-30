# ECS / DOTS Basics (core since Unity 6.4)

**Status (June 2026)**: Entities, Collections, Mathematics and
Entities Graphics are **core packages as of Unity 6.4**; Jobs +
Burst verified production tech. Architecture updates continue
towards 6.7 LTS and the CoreCLR transition (~6.8) — check current
package/runtime notes before deep commitments.

## When ECS (honest decision frame)

| Adopt | Don't |
|-------|-------|
| 10k+ similar entities with per-frame logic (units, boids, sims) | Typical gameplay (player, UI, a few dozen actors) |
| Cache-coherent number crunching; determinism needs | Teams new to Unity under deadline (real learning curve) |
| Streaming megaworlds with entity baking | Projects already fine on MonoBehaviours + Jobs |

The middle path: **MonoBehaviour gameplay + Jobs/Burst for hot
loops** captures most performance wins without the ECS programming
model. Hybrid (managed gameplay + ECS subscenes for masses) is a
normal production shape.

## The model

- **Entity**: an id. **Component** (`IComponentData`): plain struct
  data. **System** (`ISystem`): logic over queries of components.
  Data-oriented: contiguous chunk memory, no per-object vtables.
- **Baking**: authoring GameObjects in subscenes convert (bake) to
  entities at build/load — authoring stays designer-friendly.
- **Archetypes/chunks**: entities with identical component sets
  store together; structural changes (add/remove component) are the
  expensive operation — batch them via EntityCommandBuffers.

```csharp
using Unity.Entities;
using Unity.Mathematics;
using Unity.Transforms;
using Unity.Burst;

public struct MoveSpeed : IComponentData
{
    public float Value;
}

[BurstCompile]
public partial struct MoveForwardSystem : ISystem
{
    [BurstCompile]
    public void OnUpdate(ref SystemState state)
    {
        float dt = SystemAPI.Time.DeltaTime;
        foreach (var (transform, speed)
                 in SystemAPI.Query<RefRW<LocalTransform>, RefRO<MoveSpeed>>())
        {
            transform.ValueRW.Position +=
                transform.ValueRO.Forward() * speed.ValueRO.Value * dt;
        }
    }
}
```

## Jobs + Burst (useful WITHOUT full ECS)

```csharp
using Unity.Burst;
using Unity.Collections;
using Unity.Jobs;

[BurstCompile]
public struct DistanceJob : IJobParallelFor
{
    [ReadOnly] public NativeArray<Unity.Mathematics.float3> Positions;
    public NativeArray<float> Distances;
    public Unity.Mathematics.float3 Origin;

    public void Execute(int i)
    {
        Distances[i] = Unity.Mathematics.math.distance(Positions[i], Origin);
    }
}
// schedule: new DistanceJob{...}.Schedule(n, 64).Complete();
```

Rules: Native containers (`NativeArray/List/HashMap`) with explicit
`Dispose()` (or `Allocator.TempJob` lifetimes); no managed objects
inside Burst jobs; `[ReadOnly]` everything readable (scheduler
parallelism); safety system errors are friends — they're catching
real races. `Unity.Mathematics` types (`float3`) for Burst-optimal
maths.

## Practical adoption notes

- Entities Graphics renders baked entities (URP/HDRP); GameObject
  companions for things lacking entity equivalents (audio, some
  components) — the hybrid seam is normal, design it explicitly.
- Managed APIs (physics callbacks, UnityEvents, most packages)
  don't exist inside ECS — boundary systems translate
  (`EntityCommandBuffer` from events; singleton components for
  game-state bridges).
- Debugging: Entities Hierarchy/Inspector windows, Systems window
  for update order, Burst Inspector for generated code when chasing
  performance.
- Determinism/netcode: Netcode for Entities is the DOTS multiplayer
  stack — separate adoption decision, same data-oriented constraints.

## Boundary

Generic C# performance (struct layout, Span) → `dotnet-development`;
this file owns the Unity-specific stack (Entities/Jobs/Burst/
collections + safety system).
