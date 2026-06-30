# Tooling and Project Setup

**Always match an existing repo's toolchain.** For greenfield, two sane
stacks — pick one, don't mix:

| | Standard stack | Fast stack |
|---|---|---|
| Package manager / runtime | pnpm or npm + Node | Bun |
| Typecheck | tsc | tsgo (native port, much faster) |
| Lint + format | ESLint + Prettier | Biome (one tool, fast) |
| Tests | Vitest | Vitest |
| Monorepo | Turborepo (either stack) | Turborepo |

Standard is the safe default for client/enterprise work; the fast stack
trades ubiquity for speed. Vitest is the test runner in both.

## package.json Scripts

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint . --fix",
    "format": "prettier --write .",
    "check": "npm run typecheck && npm run lint && npm run test"
  }
}
```

Run `check` in order — typecheck, lint, test — to fail fast. In CI use
frozen lockfiles (`npm ci` / `pnpm install --frozen-lockfile` /
`bun install --frozen-lockfile`).

Bun quirk worth knowing: `bun test` runs Bun's native test runner, NOT your
package.json test script — use `bun run test`.

## tsconfig.json

```jsonc
{
  "compilerOptions": {
    // Safety — non-negotiable
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,

    // Module / output
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",   // "nodenext" for Node libraries
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,

    // Apps: noEmit + a bundler. Libraries: declaration output
    "noEmit": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

Libraries additionally need `declaration: true`, `sourceMap: true`, and an
emit config. Large repos: project references + incremental compilation cut
build times.

## Biome (if chosen over ESLint + Prettier)

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": true, "ignore": ["dist", "node_modules", "*.gen.ts"] },
  "formatter": { "enabled": true, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "organizeImports": { "enabled": true }
}
```

Commands: `biome check .` (lint + format check), `biome check --write .`
(fix), `biome ci .` (CI mode). In monorepos, share config via a workspace
package.

## Turborepo (Monorepos)

```jsonc
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build":     { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "lint":      {},
    "test":      { "dependsOn": ["^build"], "env": ["DATABASE_URL"] },
    "dev":       { "cache": false, "persistent": true }
  }
}
```

Structure: `apps/` (deployables) + `packages/` (shared code, configs).
`dependsOn: ["^build"]` means "build my dependencies first". Declare env
vars a task reads in `env` or caching will serve stale results. Useful
filters: `turbo build --filter=api...` (api + its deps),
`--filter=...[origin/main]` (only what changed). Remote caching makes CI
dramatically faster — set it up early.

## CI Skeleton (GitHub Actions)

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test
```

## Bundle Hygiene

- `import type { ... }` for type-only imports (`verbatimModuleSyntax`
  enforces this) — keeps types out of the runtime bundle.
- `as const` objects over `enum` — enums emit runtime code and resist
  tree-shaking.
- Analyse bundle size before optimising it; lazy-load heavy dependencies.