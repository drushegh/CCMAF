# Microsoft Stack Accessibility Specifics (short reference)

Build detail lives in the sibling skills; this file holds only the
a11y-specific facts per surface. Verify feature claims on MS Learn —
these products ship monthly.

## Power Apps (canvas) — `power-platform-development`

- Studio has a built-in **Accessibility checker** (App checker →
  Accessibility) — run it, but treat like axe: a floor, not a claim.
- Every control: set **AccessibleLabel** (icon/image controls
  especially); empty AccessibleLabel on interactive controls is the
  most common failure. Decorative images: empty label + not focusable.
- **TabIndex**: 0 for interactive, -1 to remove from order; never
  positive. Check logical order against visual layout — absolute
  positioning makes drift easy.
- Custom interactions (gallery rows acting as buttons, icon
  click-handlers) need an explicit accessible affordance — prefer
  Button controls over OnSelect-laden labels/images.
- Announce dynamic changes with `Notify()` (screen readers announce
  notifications); avoid conveying state by colour alone in Fx
  formulas.
- **Focus()** exists for focus management on screen changes — use it
  on navigation like an SPA route change.
- Modern controls have better semantics than classic — prefer them.
- Canvas apps render into a constrained runtime: full WCAG audits
  still apply to the published app in a browser
  (`audit-checklist.md` works unchanged).

## Power Pages — `power-pages-development`

- Output is ordinary web (Liquid → HTML/Bootstrap): the whole of this
  skill applies directly; no special runtime excuses.
- OOB templates/components are a starting point, NOT a conformance
  guarantee — audit generated markup (forms lists, basic forms) and
  fix in templates/snippets.
- Dataverse forms rendered as basic/multistep forms: verify label
  association, error association and focus management on validation —
  customise via JS where the default falls short.
- As public-sector sites, Power Pages deployments typically carry full
  WAD obligations: accessibility statement + EN 301 549 conformance
  (`eu-legal-framework.md`).

## Power BI — `power-bi-development`

- Report author duties: alt text per visual, deliberate **tab order**,
  sufficient contrast in themes, "show data as table" awareness,
  avoid colour-only encoding (markers/labels), meaningful titles.
- Built-in keyboard shortcuts and high-contrast support exist at the
  consumer level, but chart content accessibility is on the author —
  the data-table fallback principle from `forms-tables-charts.md`
  applies.

## SPFx / Teams apps — `m365-development`

- SPFx web parts: standard web a11y + theme-token contrast + property
  pane controls must be keyboard/SR operable; Fluent UI components
  carry good defaults — don't break them with custom wrappers.
- Teams apps/Adaptive Cards: card renderers differ per host — verify
  reading order and actions with a screen reader in Teams itself, not
  just web chat.

## Copilot Studio / conversational — `copilot-studio-development`

- Chat surfaces: ensure custom website embeds use an accessible chat
  client (keyboard, live-region announcements of replies); adaptive
  cards in answers need text alternatives for media and sensible
  action labels.

## Office documents in the journey

EN 301 549 clause 10 applies (tagged PDF, real structure). Deep
remediation guidance: Community-Access reference repo (word/excel/
powerpoint/pdf agents) in `Skills\Accessibility\Reference skills\`.
