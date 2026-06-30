---
name: frontend-development
description: >-
  Frontend craft for HTML, CSS, and Tailwind: distinctive visual design,
  design tokens, semantic markup, accessibility, and component styling
  architecture, with detailed topic references loaded on demand. Use this
  skill whenever building or restyling any web UI — pages, components,
  landing pages, dashboards, emails-as-HTML, prototypes — even if the user
  doesn't mention design. Triggers include: writing or editing HTML, CSS,
  or Tailwind classes; creating a design system, theme, or dark mode;
  choosing colours, fonts, or layout; styling React/Blazor/static
  components; accessibility review; making a UI look less generic or
  "more professional".
---

# Frontend Development

Consolidated HTML/CSS/Tailwind craft for agents building web UI. The rules
in this file always apply. Load files from `references/` only when the task
touches that topic. React *engineering* (hooks, state, TS typing) lives in
the typescript-development skill — this skill owns markup, styling, and
visual design regardless of framework.

## Core Principles

1. **Design is a set of choices, not defaults.** Make deliberate,
   subject-specific decisions about palette, typography, and layout that
   couldn't be mistaken for a template. Take one justifiable aesthetic
   risk per design.
2. **Semantic HTML first.** Structure carries meaning: landmarks,
   headings in order, real buttons and labels. Styling hangs off
   structure, never substitutes for it.
3. **Tokens over hardcoded values.** Colours, spacing, radii, and type
   sizes come from a named token system (`bg-primary`, not
   `bg-blue-500`, never `#3b82f6` inline). One place to change, themes
   for free.
4. **Accessibility is the quality floor, not a feature**: keyboard
   focus visible, contrast sufficient, motion respectful, screen-reader
   sensible. Ship it without being asked.

## The AI-Slop Checklist — never ship these as defaults

Current AI-generated design clusters around recognisable looks. Avoid
producing them *as defaults* (if the brief explicitly asks, the brief
wins):

- Cream background (~#F4F1EA) + high-contrast serif display + terracotta
  accent
- Near-black background + single acid-green or vermilion accent
- Broadsheet layout: hairline rules, zero border-radius, newspaper columns
- Purple/indigo gradients, uniform rounded corners on everything,
  Inter-for-everything, excessive centred layouts
- Numbered section markers (01/02/03) when the content isn't actually a
  sequence
- A big number with a small label + supporting stats + gradient accent as
  the hero

The test: if a similar prompt would produce the same design, it's a
default, not a choice. Details and the full design process:
[references/design-craft.md](references/design-craft.md).

## Design Workflow (two passes)

1. **Plan**: pin down the subject, audience, and the page's single job.
   Draft a compact token system — 4–6 named colours, 2–3 typefaces with
   roles (characterful display used with restraint, complementary body,
   utility), a layout concept, and the one **signature element** the page
   will be remembered by.
2. **Critique, then build**: review the plan against the brief — revise
   anything that reads as a generic default — then write code that derives
   every colour and type decision from the revised plan. Spend boldness in
   one place; keep everything around the signature quiet. Screenshot and
   self-critique if the environment allows.

## Tailwind Baseline

**Detect the Tailwind version before writing any config or theme code** —
v3 (`tailwind.config.ts`, `@tailwind` directives) and v4 (CSS-first,
`@import "tailwindcss"`, `@theme`) are incompatible dialects. Match the
repo; default to v4 for greenfield.

```css
/* v4: app.css — CSS-first configuration */
@import "tailwindcss";

@theme {
  --color-background: oklch(100% 0 0);
  --color-foreground: oklch(14.5% 0.025 264);
  --color-primary: oklch(45% 0.2 260);
  --color-primary-foreground: oklch(98% 0.01 264);
  --radius-md: 0.375rem;
}

@custom-variant dark (&:where(.dark, .dark *));
```

Semantic tokens (`--color-primary`, not raw scale colours) + OKLCH for
perceptual uniformity. Dark mode = same token names, overridden under
`.dark`. Full token system, animations, custom utilities, and the v3→v4
migration checklist: [references/tailwind.md](references/tailwind.md).

## Critical Pitfalls — always check

- **Hardcoded colours/sizes** sprinkled through markup instead of tokens —
  unthemeable, inconsistent. Extend `@theme` rather than reaching for
  arbitrary values (`w-[437px]`).
- **CSS specificity cancellation** — type-based selectors (`.section`)
  and element selectors fighting over the same margins/paddings silently
  cancel each other. Keep specificity flat and intentional.
- **Missing focus states** — every interactive element needs visible
  `:focus-visible` styling. Removing outlines without replacement is a
  defect.
- **Motion without `prefers-reduced-motion`** — animations must respect
  the user's setting.
- **Div soup** — `div` with onclick instead of `button`, divs where
  `nav`/`main`/`section` belong, missing `alt`, inputs without
  `label`.
- **Unreadable contrast** — body text ≥ 4.5:1 against its background
  (3:1 for large text); muted-on-muted fails silently in dark mode.
- **Fixed heights causing overflow** — content varies; prefer min-height
  and intrinsic sizing. Test at 375px width and with longer text.

## UX Writing

Interface copy is design material. Name things by what users control
("notifications", not "webhook config"); buttons say exactly what they do
("Save changes", not "Submit"); the same action keeps the same name across
the flow. Errors say what went wrong and how to fix it — never vague,
never apologising. Empty states invite action. Sentence case, plain verbs,
no filler.

## Agent Workflow Rules

1. **Inspect before styling**: existing design system, token definitions,
   Tailwind version and config, component conventions. Extend what's
   there; don't introduce a second visual language.
2. **Real content over lorem ipsum** — design with the brief's actual
   subject matter; if copy doesn't exist, write purposeful copy (see UX
   Writing).
3. **Quality floor before completion**: responsive down to mobile (375px),
   visible keyboard focus, reduced motion respected, contrast checked,
   semantic structure validated.
4. **Self-critique pass**: before delivering, remove one decoration that
   doesn't serve the brief (Chanel's rule), and confirm the design isn't
   one of the slop defaults.

## Reference Index

| Load when the task involves... | File |
|---|---|
| Visual design decisions: palette, typography, layout, hero, motion, copy | [references/design-craft.md](references/design-craft.md) |
| Tailwind v4 theme/config, tokens, dark mode, animations, v3→v4 migration | [references/tailwind.md](references/tailwind.md) |
| Component variant architecture: CVA, compound components, cn(), theming provider | [references/components.md](references/components.md) |
| Semantic HTML, accessibility, modern CSS layout (grid/flex/container queries) | [references/html-css-foundations.md](references/html-css-foundations.md) |
