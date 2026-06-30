# Canvas Apps: YAML Authoring and App Structure

Canvas apps are authored as `.pa.yaml` files (Power Apps YAML), editable
via source control, the studio code view, or coauthoring tooling. From
Microsoft's official canvas authoring guidance.

## YAML syntax rules (break these and formulas silently die)

- **Multi-line formulas** use the `|-` block scalar; the `=` prefix goes
  on the first content line:

```yaml
OnSelect: |-
  =Set(x, 1);
  Set(y, 2)
```

- **Record literals must be quoted.** `Default: ={Value: "Tab1"}` parses
  `Value:` as a YAML key — the formula never runs. Write
  `Default: '={Value: "Tab1"}'` (or double quotes with `""` escaping).
  Bites hardest on `Default`, `Selected`, and hardcoded `Items`;
  `ModernTabList.Default` is the classic case.
- **Strings containing `: ` must be quoted**: `HintText: ="Label: enter
  a value"`.

## Control selection

Discover controls before planning — the modern catalogue includes
high-level controls (`Avatar`, `Badge`, `Progress`, `ModernTabList`,
`ModernCard`) that are expensive to rebuild from primitives. Never guess
property names; verify against the control definition.

| Need | Control |
| --- | --- |
| Precise positioning | `GroupContainer` (ManualLayout) |
| Responsive row/column | `GroupContainer` (AutoLayout + `LayoutDirection`) |
| List of items | `Gallery` (Items, TemplateSize, OnSelect) |
| Tabular display / editing grid | `Table` / `DataGrid` |
| Record forms | `Form` / `EntityForm` (DataSource, Item, OnSuccess) |
| Clickable card | `ModernCard` — **`GroupContainer` has no `OnSelect`** |

For clickable non-card areas, overlay a transparent `Button`/`Rectangle`
(`Fill: =RGBA(0,0,0,0)`, `BorderThickness: =0`) — containers can't be
tapped.

## Layout strategy

Default to **AutoLayout** (responsive); ManualLayout only for explicitly
fixed-size desktop dashboards. Phone/tablet/multi-device apps must be
AutoLayout. Rules that prevent ugly surprises:

- Don't nest ManualLayout inside AutoLayout containers.
- Scrollable containers: `LayoutOverflowY: =LayoutOverflow.Scroll`; never
  create nested scrollbars.
- Dynamic gallery height: `Height: =CountRows(Self.AllItems) *
  Self.TemplateHeight`.
- `AutoHeight: =true` on text labels so content expands instead of
  scrolling.
- AutoLayout knobs: `LayoutDirection`, `LayoutAlignItems`,
  `LayoutJustifyContent`, `LayoutGap`, `FillPortions`, padding props.

Device targets drive design: desktop → dense/multi-column/keyboard;
tablet → touch targets, medium density; phone → single column, large
targets, minimal typing.

## App structure

- Set `App.StartScreen` explicitly.
- Initialise all variables in `OnVisible` (variables are screen-scoped;
  `Set` in `OnVisible` is the reset point).
- Shared constants/logic go in `App.Formulas` (named formulas + UDFs —
  see power-fx-delegation.md), not copy-pasted per control.
- Buttons don't support `Size` for text — resize the button.
- Mock data during build: `ClearCollect` collections in `App.OnStart`,
  swapped for real sources before delegation review.

## Quality gate before handing over

1. No delegation warnings (or each one consciously accepted and
   documented).
2. YAML compiles/validates; no quoting-related dead formulas.
3. Responsive behaviour checked at phone and desktop widths.
4. All variables initialised; no orphaned controls referencing deleted
   data sources.
5. Accessibility basics: contrast, focus order, AccessibleLabel on
   interactive controls.

Docs: https://learn.microsoft.com/power-apps/maker/canvas-apps/working-with-data-sources ·
https://learn.microsoft.com/power-apps/maker/canvas-apps/app-performance-considerations
