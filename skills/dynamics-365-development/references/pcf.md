# PCF Code Components

Power Apps component framework: typed, solution-packaged custom controls
hosted natively in model-driven apps, canvas apps, and portals — the
successor to HTML web resources for data presentation. Not supported
on-premises.

## Scaffold and Lifecycle

```bash
pac pcf init --namespace Contoso --name ChoicesPicker --template field
npm install
npm start watch                    # local test harness
pac pcf push --publisher-prefix contoso   # dev deploy
```

```typescript
export class ChoicesPicker implements ComponentFramework.StandardControl<IInputs, IOutputs> {
    private notifyOutputChanged: () => void;
    private container: HTMLDivElement;
    private value: number | null;

    public init(
        context: ComponentFramework.Context<IInputs>,
        notifyOutputChanged: () => void,
        state: ComponentFramework.Dictionary,
        container: HTMLDivElement,
    ): void {
        this.notifyOutputChanged = notifyOutputChanged;
        this.container = container;
        context.mode.trackContainerResize(true);   // required to receive width updates
    }

    public updateView(context: ComponentFramework.Context<IInputs>): void {
        // Called on every prop change. Values CAN be null while data loads —
        // render defensively; a later updateView delivers real values.
        this.value = context.parameters.value.raw;
        // render (React: createRoot/render against this.container)
    }

    public getOutputs(): IOutputs {
        return { value: this.value ?? undefined };
    }

    public destroy(): void {
        // unmount/cleanup — components get destroyed and reloaded for perf
    }
}
```

Manifest (`ControlManifest.Input.xml`) declares properties
(`bound`/`input`), datasets, resources, and feature usages — it's the
contract; keep types honest.

## The Rules (Microsoft's best-practice set)

- **No `formContext` dependency** — components must work in canvas/
  portals where it doesn't exist. Pattern: bind a column, raise changes
  via `notifyOutputChanged`, let a form OnChange handler do
  form-specific work.
- **Throttle `notifyOutputChanged`** — not per keypress/mousemove; emit
  on blur or interaction completion, or you flood the host.
- **Handle null in `updateView`** — data arrives late; null now, values
  next cycle.
- **Check API availability per host** — `context.webAPI` isn't available
  in canvas; consult the reference's "Available for" before using
  anything.
- **Limit `context.WebApi` calls** — they bill the user's API
  entitlement and service-protection limits; batch reads, trim payloads.
- Responsive via `context.mode.allocatedWidth` +
  `context.client.getFormFactor()` (Desktop/Tablet/Phone) — register
  `trackContainerResize(true)` in init.

## Context Surface (the useful bits)

`context.parameters` (manifest-bound data) · `context.webAPI` (CRUD
where available) · `context.utils` / `context.formatting` (formatting,
lookups) · `context.navigation` (dialogs, full-page) ·
`context.device` (camera/location where permitted) ·
`context.userSettings` (locale, user) · `context.updatedProperties`
(what changed this cycle).

## Packaging

Components ship inside solutions:

```bash
pac solution init --publisher-name Contoso --publisher-prefix contoso
pac solution add-reference --path ../ChoicesPicker
dotnet build                       # produces the solution zip with the control
```

Then import / add to forms or views like any component. Same publisher
prefix discipline as everything else; same managed-downstream rule.

## When NOT PCF

Form business logic (client-scripting.md), one-off static embeds, or
anything a standard control + business rule already does. PCF earns its
build cost when the control is reused or the UX genuinely needs custom
rendering.
