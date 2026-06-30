# React Server Components and Next.js

App Router conventions, boundary rules, and the gotchas that surface as
build failures or hydration errors. Version-sensitive: written for
Next.js 15/16.

## RSC Boundary Rules

| Pattern | Valid? | Fix |
|---|---|---|
| `'use client'` + `async function` | ❌ | Fetch in server parent, pass data down |
| Function prop to client component | ❌ | Define in the client component, or pass a Server Action |
| `Date` across the boundary | ❌ | `.toISOString()`, re-parse client-side |
| `Map`/`Set`/class instance across | ❌ | Plain objects/arrays |
| Server Action (`'use server'`) passed to client | ✅ | — |
| string/number/boolean/plain object/array | ✅ | — |

`'use client'` needed for: hooks, event handlers, browser APIs.
`'use cache'` (Next.js, requires `cacheComponents: true`) marks
functions/components for caching.

## Async Request APIs (Next.js 15+)

`params`, `searchParams`, `cookies()`, `headers()` are all async:

```tsx
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string }> };

export default async function Page({ params, searchParams }: Props) {
  const { slug } = await params;
  const { q } = await searchParams;
  const theme = (await cookies()).get("theme");
}
// Sync components: const { slug } = use(params)
// Migration codemod: npx @next/codemod@latest next-async-request-api .
```

## Data Patterns

Decision tree: Server Component read → fetch/query directly (no API
layer). UI mutation → Server Action + `revalidatePath`/`revalidateTag`.
External clients/webhooks/cacheable GET → Route Handler. Client reads →
SWR/TanStack Query, or pass from a server parent.

`route.ts` and `page.tsx` cannot coexist in one folder. Prefer Server
Actions for UI mutations; Route Handlers for integrations.

## Error Handling

- `error.tsx` (must be `'use client'`) per segment; `global-error.tsx`
  for the root layout (must render `<html>`/`<body>`); `not-found.tsx` +
  `notFound()`; `unauthorized()`/`forbidden()` with their pages.
- **Navigation APIs throw internally** — `redirect()`,
  `permanentRedirect()`, `notFound()` must be called **outside**
  try/catch, or re-thrown with `unstable_rethrow(error)` at the top of
  the catch. A try/catch around `redirect()` silently breaks navigation.

## Suspense Bailout Hooks

`useSearchParams()` always needs a `<Suspense>` boundary in static
routes — without one the entire page becomes client-rendered.
`usePathname()` needs one in dynamic routes. `useParams`/`useRouter` do
not.

## Hydration Errors

Causes and fixes: browser-only APIs → mounted-check client component;
dates/locale → render client-side or `suppressHydrationWarning`; random
IDs → `useId()`; invalid HTML nesting (`<div>` inside `<p>`) → fix the
markup; DOM-modifying third-party scripts → `next/script` with
`afterInteractive`. Dev overlay shows the server/client diff.

## File Conventions

`page` / `layout` / `loading` (Suspense boundary) / `error` /
`not-found` / `route` / `template` (re-renders on nav) / `default`
(parallel-route fallback). Dynamic segments `[slug]`, catch-all
`[...slug]`, groups `(marketing)`, private folders `_lib`, parallel
routes `@modal`, interceptors `(.)same-level` / `(..)one-up` /
`(...)from-root`. **Next 16 renames `middleware.ts` → `proxy.ts`.**

Parallel-route modals: every slot needs `default.tsx` (404 on hard nav
otherwise); close modals with `router.back()`, never `router.push()`.

## Images, Fonts, Scripts, Metadata

- **`next/image` always**: local imports get dimensions automatically;
  remote needs `width`/`height` + `remotePatterns` config; `fill` needs
  `sizes` or the largest variant downloads; `priority` on the LCP/hero
  image; `placeholder="blur"` against layout shift.
- **`next/font`**: one instance in the root layout exposed as a CSS
  variable (never per-component); variable fonts over weight lists;
  `subsets: ['latin']`; never `<link>` Google Fonts tags.
- **`next/script`** with a strategy; inline scripts need `id`;
  `@next/third-parties` for GA/GTM; `beforeInteractive` only in the root
  layout.
- **Metadata**: export `metadata` / `generateMetadata` from Server
  Components only; file conventions (`opengraph-image.png`, `sitemap.ts`,
  `robots.ts`) cover most needs — one static OG image serves Twitter
  too; dynamic `generateMetadata` only when content varies per page.

## Runtime and Bundling

- **Node.js runtime by default**; Edge only for genuine edge-latency
  needs — limited APIs (no `fs`, partial `crypto`), many packages break.
- Native-binding packages (`sharp`, `bcrypt`, `canvas`) →
  `serverExternalPackages`; window-dependent packages (`recharts`,
  `monaco`, `mapbox-gl`) → `dynamic(..., { ssr: false })`.
- Self-hosting: `output: 'standalone'` for Docker; multi-instance ISR
  needs a shared cache handler (Redis/S3) — filesystem cache breaks
  across instances.
