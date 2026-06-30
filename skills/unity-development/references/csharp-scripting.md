# Unity C# Scripting

## Canonical component

```csharp
using UnityEngine;

[RequireComponent(typeof(Rigidbody))]
public class PlayerMotor : MonoBehaviour
{
    [SerializeField] private float speed = 5f;
    [SerializeField] private Transform cameraRig;

    public event System.Action<float> SpeedChanged;

    private Rigidbody _rb;
    private Vector2 _moveInput;

    private void Awake()
    {
        _rb = GetComponent<Rigidbody>();      // cache once
    }

    private void OnEnable()  { /* subscribe */ }
    private void OnDisable() { /* unsubscribe — always symmetric */ }

    private void FixedUpdate()
    {
        var dir = new Vector3(_moveInput.x, 0f, _moveInput.y);
        _rb.MovePosition(_rb.position + dir * (speed * Time.fixedDeltaTime));
    }
}
```

`[RequireComponent]` for hard dependencies; `[SerializeField]
private` over public fields; `[Header]`, `[Range]`, `[Tooltip]` make
the Inspector the documentation.

## Lifecycle (the exact order that matters)

`Awake` (all on loaded objects, before any Start) → `OnEnable` →
`Start` (first frame, after every Awake — safe for cross-object) →
`FixedUpdate` (0..n per frame, physics step) → `Update` →
`LateUpdate` (camera/follow) → `OnDisable` → `OnDestroy`.
Execution order between scripts is unspecified — never rely on it;
use Script Execution Order settings only as a last resort (explicit
init sequencing beats it).

## Destroyed-object semantics (the Unity null trap)

`Destroy(obj)` destroys the native object at frame end; the C#
wrapper survives. Unity's `==` overload makes destroyed compare
`== null`, BUT `?.`, `??`, `is null` use reference equality and see
a live wrapper. Rule: plain `if (target == null)` / `if (target)`
for UnityEngine.Object types; reserve null-conditionals for pure C#
types. `Destroy` vs `DestroyImmediate` (editor code only).

## Events and decoupling

- C# events (`event Action<T>`) for code-to-code — fast, typed;
  unsubscribe symmetric with subscribe.
- `UnityEvent` for designer-wired responses in the Inspector
  (buttons, triggers) — slower, serialised, visible.
- ScriptableObject event channels for cross-scene/prefab decoupling
  (`scriptableobjects-data.md`).
- Avoid static event abuse: statics survive domain reloads
  unpredictably with "Enter Play Mode Options" (disable domain
  reload) — reset statics via
  `[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]`.

## Coroutines vs async

- Coroutines: frame-based sequencing tied to the component —
  stop on disable/destroy (a feature); `yield return null` (frame),
  `WaitForSeconds` (cache instances), `WaitForFixedUpdate`.
- async/await: IO, web requests (`UnityWebRequest` awaitable via
  `Awaitable` in Unity 6 — `await Awaitable.NextFrameAsync()` etc.),
  but continues after object destruction — pass
  `destroyCancellationToken` to every await chain.
- Unity 6's `Awaitable` class is the modern engine-aware async
  primitive (frame/fixed-update/background-thread hops) — prefer it
  over raw Task for engine-coupled async.

## Serialization details that bite

- Serialisable: public / `[SerializeField]` fields of serialisable
  types, `List<T>`, arrays, `[System.Serializable]` classes/structs
  (no polymorphism without `[SerializeReference]`).
- NOT serialised: properties, statics, readonly, Dictionaries
  (roll your own paired-lists + `ISerializationCallbackReceiver`).
- `[SerializeReference]` enables polymorphic graphs — heavier;
  use deliberately.
- Hot-reload: serialised fields survive domain reload; private
  non-serialised state resets — a classic source of editor-only
  weirdness.

## GC and performance habits

No per-frame allocations: cache `WaitForSeconds`, avoid LINQ/
closures/params arrays/string concat in Update, use non-allocating
physics APIs (`Physics.RaycastNonAlloc`-family or the newer
query APIs), `CompareTag()` not `tag ==`, StringBuilder for built
strings, struct enumerators (foreach over List is fine; over
IEnumerable interfaces allocates). Strings to UI every frame →
only on change. Profile, then optimise (`build-pipeline.md` tools).

## Testing

Unity Test Framework: EditMode tests (pure logic, fast) + PlayMode
tests (behavioural, scene-based). Keep logic in plain C# classes/
ScriptableObjects for EditMode coverage; asmdef test assemblies;
run in CI: `-runTests -testPlatform EditMode` batchmode
(`build-pipeline.md`).
