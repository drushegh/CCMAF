# Godot C# (.NET) Notes

Requires the .NET edition of Godot + .NET SDK. Same engine API
surface with C# naming (`MoveAndSlide()`, `GlobalPosition`).
Platform support for C# lags GDScript on some targets (notably web
export — verify current status per Godot version before committing
a C# project to web).

## Script anatomy

```csharp
using Godot;

public partial class Player : CharacterBody2D
{
    [Signal]
    public delegate void HealthChangedEventHandler(int newHealth);

    [Export]
    public int MaxHealth { get; set; } = 100;

    [Export]
    public float Speed { get; set; } = 300f;

    private AnimatedSprite2D _anim = null!;
    private int _health;

    public override void _Ready()
    {
        _anim = GetNode<AnimatedSprite2D>("AnimatedSprite2D");
        _health = MaxHealth;
    }

    public override void _PhysicsProcess(double delta)
    {
        var direction = Input.GetAxis("move_left", "move_right");
        Velocity = Velocity with { X = direction * Speed };
        MoveAndSlide();
    }

    public void TakeDamage(int amount)
    {
        _health = Mathf.Max(0, _health - amount);
        EmitSignal(SignalName.HealthChanged, _health);
        if (_health == 0)
            QueueFree();
    }
}
```

Rules: classes are `partial` (source generators); signals are
`[Signal] delegate ... EventHandler` pairs emitted via
`EmitSignal(SignalName.X, …)` or subscribed as C# events
(`HealthChanged += OnHealthChanged`); `[Export]` properties for the
inspector; file name must match class name.

## Interop

- C# ↔ GDScript: call across via `Call("method_name", args)` /
  `Get/Set("property")` (Variant-based, untyped) — keep cross-
  language surfaces small and well-defined; same-language for hot
  paths.
- Variant-compatible types only across the boundary (Godot
  collections `Godot.Collections.Array/Dictionary` vs
  `System.Collections` — convert at the edge, use System collections
  internally).
- `GetNode<T>` generic casts; `GD.Print`, `GD.Load<PackedScene>`;
  `Callable.From(...)` for callable interop.

## .NET ecosystem usage

NuGet packages work (the genuine reason to choose C#): JSON
(System.Text.Json), maths/ML libs, shared business logic with
non-game .NET code. Constraints: keep heavy allocation off the
per-frame path (GC spikes = frame hitches) — pool, reuse buffers,
prefer structs judiciously; async/await with Godot needs care
(engine callbacks aren't on a .NET synchronisation context —
marshal back via `CallDeferred`).

## Tooling

External editor (VS/Rider/VS Code) with the Godot C# tools; build
happens via dotnet (msbuild) before run; debugger attach supported.
Unit tests: ordinary xUnit/NUnit projects for pure logic +
gdUnit4Net / GoDotTest for engine-touching tests in CI.

## When to recommend C# (consultancy frame)

.NET-house teams, reuse of existing C# domain code,
heavy simulation logic, typed-ecosystem preference. Counterweights:
GDScript's iteration speed, docs/community defaults, web export
maturity. General C# language guidance → `dotnet-development`;
engine API usage stays here.
