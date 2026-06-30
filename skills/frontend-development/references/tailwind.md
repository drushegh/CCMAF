# Tailwind CSS

Targets **v4** (CSS-first). Detect the repo's version first: a
`tailwind.config.ts` + `@tailwind base/components/utilities` means v3 —
work in that dialect or migrate deliberately (checklist at the end), never
mix the two.

| v3 | v4 |
|---|---|
| `tailwind.config.ts` | `@theme` block in CSS |
| `@tailwind base/components/utilities` | `@import "tailwindcss"` |
| `darkMode: "class"` | `@custom-variant dark (&:where(.dark, .dark *))` |
| `theme.extend.colors` | `@theme { --color-*: value }` |
| `tailwindcss-animate` plugin | `@keyframes` in `@theme` + `@starting-style` |
| `h-10 w-10` | `size-10` |

## Theme: Semantic Tokens in OKLCH

Token hierarchy: brand value → semantic token → utility class
(`oklch(45% 0.2 260)` → `--color-primary` → `bg-primary`). Components
consume semantic names only — that's what makes theming and dark mode a
token swap rather than a rewrite.

```css
@import "tailwindcss";

@theme {
  /* Semantic colour tokens — OKLCH for perceptual uniformity */
  --color-background: oklch(100% 0 0);
  --color-foreground: oklch(14.5% 0.025 264);
  --color-primary: oklch(14.5% 0.025 264);
  --color-primary-foreground: oklch(98% 0.01 264);
  --color-muted: oklch(96% 0.01 264);
  --color-muted-foreground: oklch(46% 0.02 264);
  --color-destructive: oklch(53% 0.22 27);
  --color-border: oklch(91% 0.01 264);
  --color-ring: oklch(14.5% 0.025 264);
  --color-card: oklch(100% 0 0);
  --color-card-foreground: oklch(14.5% 0.025 264);

  /* Radius + animation tokens */
  --radius-sm: 0.25rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;

  --animate-fade-in: fade-in 0.2s ease-out;

  @keyframes fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
}
```

Pair every surface colour with a `-foreground` partner so text contrast
travels with the background.

## Dark Mode

Class-based variant + token overrides — components don't change:

```css
@custom-variant dark (&:where(.dark, .dark *));

.dark {
  --color-background: oklch(14.5% 0.025 264);
  --color-foreground: oklch(98% 0.01 264);
  --color-muted: oklch(22% 0.02 264);
  --color-muted-foreground: oklch(65% 0.02 264);
  --color-border: oklch(22% 0.02 264);
}
```

Test both themes — muted-on-muted contrast failures hide in dark mode.
(Theme toggle provider pattern: see components.md.)

## Base Layer

```css
@layer base {
  body {
    @apply bg-background text-foreground antialiased;
  }
}
```

## Custom Utilities and Modifiers

Independent examples — don't combine the namespace override with the
others (it clears the tokens they depend on).

```css
/* Reusable custom utility (requires --color-primary / --color-accent tokens) */
@utility text-gradient {
  @apply bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent;
}

/* Reference other CSS variables */
@theme inline {
  --font-sans: var(--font-inter), system-ui;
}

/* Always emit a variable even when unused */
@theme static {
  --color-brand: oklch(65% 0.15 240);
}

/* Alpha variants via color-mix */
@theme {
  --color-primary-100: color-mix(in oklab, var(--color-primary) 10%, transparent);
}

/* Container query sizes */
@theme {
  --container-sm: 24rem;
  --container-md: 28rem;
}
```

Replacing the default palette entirely (minimal, brand-only setups) —
note this clears every default colour, so only utilities built from your
own tokens remain available:

```css
@theme {
  --color-*: initial;
  --color-white: #fff;
  --color-primary: oklch(45% 0.2 260);
}
```

## Entry/Exit Animations — native CSS

`@starting-style` covers entry transitions without a plugin; `allow-discrete`
lets `display` participate:

```css
[popover] {
  transition: opacity 0.2s, transform 0.2s, display 0.2s allow-discrete;
  opacity: 0;
  transform: scale(0.95);
}
[popover]:popover-open {
  opacity: 1;
  transform: scale(1);
}
@starting-style {
  [popover]:popover-open {
    opacity: 0;
    transform: scale(0.95);
  }
}
```

## Do / Don't

**Do**: `@theme` blocks; OKLCH; semantic tokens (`bg-primary`, never
`bg-blue-500` in components); `size-*` shorthand; pair surfaces with
foregrounds; test both themes.

**Don't**: `tailwind.config.ts` in v4 projects; arbitrary values
(`w-[437px]`) where a token belongs — extend `@theme` instead; hardcoded
colours in markup; class soup duplicated across siblings (extract a
component or variant — see components.md).

## v3 → v4 Migration Checklist

- [ ] `tailwind.config.ts` → CSS `@theme` block
- [ ] `@tailwind base/components/utilities` → `@import "tailwindcss"`
- [ ] Colour definitions → `@theme { --color-*: value }` (consider OKLCH)
- [ ] `darkMode: "class"` → `@custom-variant dark`
- [ ] `@keyframes` moved inside `@theme` (emitted when referenced by `--animate-*`)
- [ ] `tailwindcss-animate` → native keyframes + `@starting-style`
- [ ] `h-10 w-10` → `size-10`
- [ ] Custom plugins → `@utility` directives
- [ ] React 19 projects: drop `forwardRef` (ref is a normal prop)
