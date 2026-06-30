# Fixing TypeScript Errors at Scale

Systematic workflow for build failures, type-safety audits, and `any`
elimination. Patching errors one-by-one in discovery order wastes effort —
fixing a root type definition often resolves dozens of downstream errors.

## Phase 1: Discovery

1. Detect the package manager (`package-lock.json`, `pnpm-lock.yaml`,
   `yarn.lock`, `bun.lockb`) and the typecheck command (`tsc --noEmit`, or
   `tsgo --noEmit` where adopted).
2. Run the full typecheck and capture output to a log; don't fix anything
   yet.
3. Parse every error: file, line, error code, message. Group by file.

## Phase 2: Planning

1. **Analyse dependencies** — errors in type definition files and shared
   utilities cascade into consumers. Identify these roots first.
2. **Fix order**: type definitions → core utilities → consumers (roots
   first, leaves last).
3. If errors span very many files, batch by dependency cluster and process
   roots before re-assessing — the error count after fixing roots is often
   a fraction of the original.

## Phase 3: Fixing

Per file, fix **all** errors in one edit. For each error:

1. Read the file and understand its purpose before changing it.
2. Examine the related type definitions it depends on.
3. Find the root cause — the error location is often a symptom of a wrong
   type upstream.
4. Apply a proper fix (rules below). Check it doesn't break consumers of
   this file.

Use available type-research tools rather than guessing: hover /
go-to-definition / find-references (LSP), the library's `.d.ts` files,
`@types` packages, and actual runtime shapes.

## Zero Tolerance for `any`

`any` is never a fix — it silences the compiler and moves the bug to
runtime. Instead:

1. **Research the actual type**: function signatures, API response
   structures, library type definitions, runtime data flow.
2. **Use the right tool**:
   - `unknown` + type guards or Zod for genuinely unknown data
   - `Partial<T>`, `Pick<T, K>`, `Omit<T, K>`, `Record<K, V>` for shape
     variations
   - `ReturnType<T>`, `Parameters<T>`, `Awaited<T>` for function-derived
     types
   - A dedicated interface/type for complex shapes
3. **If genuinely unavoidable** (e.g. an untyped third-party boundary),
   `any` gets a `// TODO:` comment with the reason and resolution path —
   the only sanctioned form.

The same applies to assertion "fixes": `as T` on data the compiler can't
verify is an `any` in disguise. Validate or narrow instead.

## Common Error Patterns

| Error | Usual root cause | Fix |
|---|---|---|
| TS2339 property does not exist | Type too narrow, or data actually unknown | Widen the source type correctly, or guard/validate |
| TS2345 argument not assignable | Caller and signature drifted | Fix whichever is actually wrong — check usage intent |
| TS2322 type not assignable | Often `undefined`/`null` handling | Narrow with checks; don't assert it away |
| TS7006 implicit any parameter | Missing annotation | Annotate from usage and call sites |
| TS18048 possibly undefined | `noUncheckedIndexedAccess` / optionals | Handle the undefined case — it's real |
| TS2769 no overload matches | Wrong argument shape for a library | Read the library's `.d.ts`, fix the call |

## Phase 4: Verification

1. Re-run the full typecheck — confirm all original errors are resolved
   **and no new ones appeared**.
2. Run lint and the test suite.
3. Summarise: files changed, errors fixed, any documented TODOs remaining.

## Edge Cases

- Typecheck command itself fails → check `tsconfig.json` validity first.
- Circular type dependencies → document the cycle, break it with an
  interface in a shared module, then fix.
- Generated files (`*.gen.ts`, codegen output) → fix the generator or its
  input schema, never the generated file.
