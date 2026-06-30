# Input System and UI

## Input System (the modern one)

Action-based: devices → bindings → **Input Actions** (semantic:
"Move", "Jump", "Interact") grouped in **Action Maps** (Gameplay,
UI, Vehicle) within an `.inputactions` asset.

```csharp
using UnityEngine;
using UnityEngine.InputSystem;

public class PlayerInputHandler : MonoBehaviour
{
    [SerializeField] private InputActionReference moveAction;
    [SerializeField] private InputActionReference jumpAction;

    private Vector2 _move;

    private void OnEnable()
    {
        moveAction.action.Enable();
        jumpAction.action.Enable();
        jumpAction.action.performed += OnJump;
    }

    private void OnDisable()
    {
        jumpAction.action.performed -= OnJump;
        moveAction.action.Disable();
        jumpAction.action.Disable();
    }

    private void Update()
    {
        _move = moveAction.action.ReadValue<Vector2>();
    }

    private void OnJump(InputAction.CallbackContext ctx)
    {
        // started / performed / canceled phases; interactions (hold, tap) configure them
    }
}
```

- Polling (`ReadValue` in Update) for continuous axes; callbacks for
  discrete actions; enable/disable symmetric.
- `PlayerInput` component for quick setups + local multiplayer
  (`PlayerInputManager` handles join/device pairing); direct action
  references for full control.
- Action map switching = input modes (swap Gameplay/UI on pause) —
  one source of truth for "what controls are live".
- Rebinding: `PerformInteractiveRebinding()` + save/load binding
  overrides JSON — plan the UI for it early if shipping PC.
- Generated C# wrapper class (from the asset) gives typed access —
  prefer it on bigger projects.

## UI Toolkit vs uGUI (decision, June 2026)

| | UI Toolkit | uGUI |
|---|---|---|
| Model | Retained-mode, UXML (structure) + USS (style) — web-like | GameObject/Canvas components |
| Editor tooling | THE standard for editor windows/inspectors | n/a |
| Runtime | The strategic direction; strong for screen-space UI (HUD, menus); data binding maturing | Mature, battle-tested everywhere |
| World-space UI | Verify current support per version (historic gap — closing in Unity 6.x) | Native (world-space canvas) |
| Custom shaders/effects per element | Limited | Full material control |

New screen-space UI → UI Toolkit by default; world-space/effect-heavy
→ uGUI still earns its keep. Don't mix paradigms within one screen.

## UI Toolkit essentials

UXML documents + USS stylesheets + `UIDocument` component;
query/manipulate via C#:

```csharp
var root = GetComponent<UnityEngine.UIElements.UIDocument>().rootVisualElement;
var healthBar = root.Q<UnityEngine.UIElements.ProgressBar>("health-bar");
healthBar.value = 0.75f;
root.Q<UnityEngine.UIElements.Button>("pause").clicked += OnPause;
```

Style via USS classes (not inline); runtime data binding
(`SetBinding`/runtime bindings in Unity 6) for model-driven UI;
custom controls as C# VisualElement subclasses.

## uGUI survival rules

Canvas dirtying: anything changing inside a Canvas rebuilds its
batches — split static/dynamic into separate canvases; avoid
Layout Groups on hot-updating elements; `CanvasGroup.alpha` for
show/hide over SetActive churn; TextMeshPro for all text; sprite
atlases to keep draw calls sane; raycast targets OFF on
non-interactive graphics (event-system cost).

## Game UI accessibility

Input rebinding, hold-alternatives for mashing, subtitle options,
colour-independent signalling, scalable text, screen-reader hooks on
platforms exposing them — `accessibility-development` owns the
deep standards; budget these in menus from the start.
