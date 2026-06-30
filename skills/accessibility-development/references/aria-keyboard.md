# ARIA, Keyboard and Focus Management

Authoritative pattern source: **W3C ARIA Authoring Practices Guide
(APG)** — w3.org/WAI/ARIA/apg/patterns. Use its keyboard interaction
tables verbatim; don't invent widget behaviour.

## The rules of ARIA

1. Don't use ARIA if a native HTML element/attribute does the job.
2. Don't change native semantics unless you truly must
   (`<button role="heading">` is wrong twice).
3. Every interactive ARIA control must be keyboard operable — a role
   is a promise of behaviour you now have to implement.
4. Don't put `role="presentation"`/`aria-hidden="true"` on focusable
   elements.
5. Every interactive element gets an accessible name; visible label
   text must be part of it (2.5.3 Label in Name).

`aria-label` overrides content; `aria-labelledby` composes from other
elements; `aria-describedby` adds hints/errors. Name computation
order matters — test in the accessibility tree, not by reading code.

## Keyboard interaction baseline

| Key | Expectation |
|-----|-------------|
| Tab / Shift+Tab | Move between components (not within composite widgets) |
| Arrows | Move within composites (menus, radio groups, grids, tabs) — roving tabindex or `aria-activedescendant` |
| Enter / Space | Activate buttons (links: Enter only) |
| Esc | Dismiss modal/popup; return focus to invoker |
| Home/End | First/last in lists/grids where natural |

Only `tabindex="0"` (in flow) and `tabindex="-1"` (programmatic
target) — positive tabindex is a bug. Focus must always be visible
(2.4.7) and not obscured by sticky chrome (2.4.11).

## Focus management patterns

- **Modal dialog**: on open — move focus to dialog (first control or
  heading); trap Tab within; background `inert` (or aria-hidden +
  scroll lock); on close — restore focus to the invoker. Prefer
  native `<dialog showModal>` which delivers most of this.
- **SPA route change**: move focus to the new view's `h1` (or a
  `tabindex="-1"` main heading) and update `document.title` —
  otherwise screen reader users get silence.
- **Disclosure/accordion**: `aria-expanded` on the trigger button;
  content follows in DOM order.
- **Menu/menubar vs disclosure nav**: APG `menu` role is for
  application-style menus with full arrow-key semantics; site
  navigation is usually better as a disclosure pattern (button +
  list) — simpler and more robust.
- **Combobox/autocomplete**: use the APG combobox pattern exactly
  (`role="combobox"`, `aria-expanded`, `aria-controls`,
  `aria-activedescendant`); this is the most-misimplemented widget on
  the web — prefer a proven library component.
- **Tabs**: `tablist`/`tab`/`tabpanel`, arrows move tabs, Tab leaves
  the tablist; `aria-selected` reflects state.

## Live regions and announcements

- `role="status"` / `aria-live="polite"` for non-urgent updates
  (search result counts, save confirmations) — satisfies 4.1.3
  without focus theft.
- `role="alert"` / `assertive` only for genuinely urgent messages —
  overuse trains users to ignore it.
- Live regions must exist in the DOM **before** content is injected;
  injecting a new live region with text rarely announces.
- Loading states: announce start and completion, not every spinner
  frame; for long operations consider `aria-busy`.

## States and properties quick table

| Need | Use |
|------|-----|
| Toggle button pressed | `aria-pressed` |
| Expand/collapse | `aria-expanded` (+ `aria-controls`) |
| Current page/item in nav | `aria-current="page"` etc. |
| Invalid field | `aria-invalid` + `aria-describedby` to the error |
| Required | native `required` (announces) |
| Disabled but discoverable | `aria-disabled="true"` (stays focusable) vs native `disabled` (removed from tab order) — choose deliberately |
| Progress | `role="progressbar"` + `aria-valuenow/min/max` |

## Testing the contract

A custom widget passes when: name/role/value correct in the browser
accessibility tree; full APG keyboard table works; screen reader
announces state changes; focus never lost to `body`. Procedures →
`testing-tooling.md`.
