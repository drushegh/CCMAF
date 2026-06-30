---
name: typescript-development
description: >-
  Modern TypeScript (5.x) engineering standards, type-safety patterns,
  pitfalls, and agent workflow rules, with detailed topic references loaded
  on demand. Use this skill whenever any .ts or .tsx file is created, edited,
  reviewed, or debugged — even if the user doesn't mention standards or
  patterns. Triggers include: writing TypeScript modules, Node services,
  APIs, or React components; fixing tsc/build errors or eliminating any
  types; type annotations, generics, or advanced type logic; Zod or runtime
  validation; Vitest/Jest test writing; tsconfig, ESLint/Biome, bundling, or
  monorepo setup; refactoring or reviewing any TypeScript or JavaScript
  code.
---

# TypeScript Development

Consolidated TypeScript engineering standards for agents writing production
code. The rules in this file always apply. Load files from `references/`
only when the task touches that topic — do not load them speculatively.

## Core Principles

1. **Strict mode, always.** The compiler is the first test suite — weaken
   it and every other guarantee weakens with it.
2. **Make illegal states unrepresentable.** Model with discriminated
   unions, not boolean flags; encode invariants in types so the compiler
   catches what tests would otherwise have to.
3. **Validate at boundaries, trust inside.** External data (HTTP, files,
   env, DB rows) enters through a Zod schema; everything past that boundary
   relies on the types.
4. **Let inference work.** Explicit types on public APIs and exports;
   inference for locals. Don't annotate what TypeScript already knows.

## Baseline tsconfig

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,   // arr[i] is T | undefined — it is
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,        // forces `import type` discipline
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true
  }
}
```

In an existing repo, never weaken compiler options to make an error go away.

## Code Standards

- **No `any`.** Use `unknown` and narrow (type guards, Zod), or proper
  generics/utility types. If truly unavoidable, add a `// TODO:` with the
  resolution path — that is the only acceptable form.
- **No type assertions** (`as T`, `as any`, `as unknown as T`) to silence
  errors — they bypass checking and turn compile-time bugs into runtime
  ones. Legitimate uses are confined to branded-type smart constructors and
  test fixtures.
- **`interface` for object shapes** and extendable contracts; **`type`**
  for unions, intersections, mapped and conditional types.
- **`as const` objects instead of `enum`** (tree-shakeable, no runtime
  output):

  ```typescript
  const Status = { Active: "active", Inactive: "inactive" } as const;
  type Status = (typeof Status)[keyof typeof Status];
  ```

- **Exhaustive switches** over discriminated unions, with a `never` check
  in `default` so adding a variant becomes a compile error.
- **`readonly`** on properties not meant to change; **optional chaining +
  nullish coalescing** (`user?.profile?.name ?? "Unknown"`) over manual
  null checks; **`import type`** for type-only imports.
- **Schema-first validation**: define the Zod schema, derive the type with
  `z.infer` of the schema — never write the type twice.

## Tooling

Match the established toolchain in an existing repo. Greenfield default:

```bash
pnpm install                  # or npm; bun where the repo uses it
tsc --noEmit                  # typecheck (tsgo where adopted — much faster)
eslint . --fix                # or: biome check --write .
prettier --write .            # (not needed if using Biome)
vitest run                    # tests
```

Run checks in order — typecheck, lint, test — to fail fast. Details and the
Bun/tsgo/Biome/Turborepo fast stack: [references/tooling.md](references/tooling.md).

## Decision Rules

**Error handling** — `Result of T, E` discriminated unions for expected,
recoverable failures (parsing, validation, not-found); exceptions only for
programmer errors and truly unrecoverable states. Errors in the signature
force callers to handle them. Details:
[references/functional-patterns.md](references/functional-patterns.md).

**React state** — `useState` for simple local state, `useReducer` for
complex local state, Zustand/Jotai for shared client state, TanStack Query
for server state. Don't reach for a global store when a hook will do.
React engineering beyond typing lives in the react-development skill;
TS-specific typing notes: [references/react.md](references/react.md).

**API layer** — same-repo TypeScript front+back → tRPC (end-to-end types,
no codegen). Otherwise fetch wrapper that validates responses with Zod.
Details: [references/validation-and-apis.md](references/validation-and-apis.md).

## Critical Pitfalls — always check

```typescript
// 1. Floating promises — unhandled rejections crash Node
void loadData();                    // explicit, or await it

// 2. Index access — with noUncheckedIndexedAccess, handle undefined
const first = items[0];             // T | undefined, not T

// 3. Non-exhaustive unions — enforce with never in the default case
switch (shape.kind) { /* ...all cases... */
  default: { const _x: never = shape; throw new Error(`Unhandled: ${_x}`); }
}

// 4. JSON.parse / fetch results are not typed — validate, don't assert
const data = Schema.parse(await res.json());   // not: as MyType

// 5. Async functions passed where void expected (event handlers,
//    forEach) silently swallow rejections — wrap with try/catch
```

Also forbidden: mutating props/state in React, hardcoded secrets (use
validated `process.env`), `dangerouslySetInnerHTML` with unsanitised input,
`== `/`!=` (always `===`/`!==`).

## Testing Essentials

Vitest (or the repo's existing framework). Testing Library for components
(user-centric queries), MSW for API mocking. Tests co-located next to the
code (`thing.ts` / `thing.test.ts`). Cover failure paths and edge cases,
not just the happy path. Every bug fix gets a regression test first.
Details: [references/testing.md](references/testing.md).

## Agent Workflow Rules

1. **Fixing build/type errors**: follow the systematic workflow in
   [references/error-fixing.md](references/error-fixing.md) — collect all
   errors first, fix dependency-root files (type definitions, shared
   utilities) before consumers, never patch with `any`, verify with a full
   re-check.
2. **Research types, don't guess**: when the right type is unclear, trace
   it — library `.d.ts` files, hover/go-to-definition, actual runtime
   shapes — rather than asserting.
3. **Before completion**: run typecheck, lint, and tests. Remove debug
   artefacts: stray `console.log`, ad-hoc test files, commented-out code.
4. **Respect existing patterns**: in established codebases, follow the
   project's conventions over generic best practice; only diverge with a
   clear, stated benefit.
5. **Don't over-engineer types**: deeply nested conditional types slow the
   compiler and confuse maintainers. Only generalise with generics when
   there are 2+ concrete uses.

## Reference Index

| Load when the task involves... | File |
|---|---|
| Generics, conditional/mapped/template literal types, utility types, `infer`, type guards, type testing | [references/type-system.md](references/type-system.md) |
| Discriminated unions, Result/Option, branded types, state machines, exhaustiveness | [references/functional-patterns.md](references/functional-patterns.md) |
| Zod schemas, API clients, tRPC, forms, env validation | [references/validation-and-apis.md](references/validation-and-apis.md) |
| Typing React components, hooks, events, context (React engineering itself → react-development skill) | [references/react.md](references/react.md) |
| Node services: shutdown, async middleware, process-level errors | [references/node-backend.md](references/node-backend.md) |
| Writing or fixing tests | [references/testing.md](references/testing.md) |
| Fixing tsc errors / eliminating `any` at scale | [references/error-fixing.md](references/error-fixing.md) |
| Toolchain setup, tsconfig, Biome/ESLin