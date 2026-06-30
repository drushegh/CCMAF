# Component Styling Architecture

How to structure Tailwind classes into a maintainable component system.
Examples are React (the common case) — the *architecture* (variants,
composition, semantic tokens) transfers to any framework. React
engineering itself (hooks, state, typing) lives in the
typescript-development skill.

Composition order: **base styles → variants → sizes → states → overrides**.

## The `cn()` Utility

Every component takes a `className` override merged last —
`tailwind-merge` resolves conflicting utilities correctly (plain string
concat doesn't):

```typescript
// lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

## CVA Variants

`class-variance-authority` gives type-safe variants instead of class soup
duplicated across call sites:

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // base — note semantic tokens and focus-visible ring
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-border bg-background hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "size-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
```

(React 19: `ref` is a normal prop — no `forwardRef`.)

## Compound Components

Multi-part components export their parts; consumers compose:

```tsx
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-card text-card-foreground shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-2xl font-semibold leading-none tracking-tight", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-6 pt-0", className)} {...props} />;
}
```

## Form Fields with Accessible Errors

Error state is styled AND announced — `aria-invalid`, `aria-describedby`,
`role="alert"`:

```tsx
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
}

export function Input({ className, type, error, ...props }: InputProps) {
  return (
    <div className="relative">
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-destructive focus-visible:ring-destructive",
          className,
        )}
        aria-invalid={!!error}
        aria-describedby={error ? `${props.id}-error` : undefined}
        {...props}
      />
      {error && (
        <p id={`${props.id}-error`} className="mt-1 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
```

Layout primitives (Grid/Container) follow the same CVA pattern with
responsive column variants
(`3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"`).

## Theme Toggle Provider

Class-based dark mode needs a small provider: read stored preference,
fall back to `prefers-color-scheme`, toggle the `dark` class on
`<html>`, persist to `localStorage`, and update `<meta name="theme-color">`
for mobile chrome. Resolve `"system"` → light/dark at runtime via
`window.matchMedia("(prefers-color-scheme: dark)")`. Keep the toggle
button accessible (`<span class="sr-only">Toggle theme</span>`).

## Rules

- Components consume **semantic tokens only** — a component with
  `bg-blue-500` can't be themed.
- Focus styles (`focus-visible:ring-*`) and disabled states belong in the
  base CVA string, not bolted on per use.
- Extract a variant when the same class string appears a third time.
- `cn()` merge order: base → variants → caller `className` (caller wins).
