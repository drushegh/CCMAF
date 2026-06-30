# Performance: Data Flow and Server

Waterfalls are the #1 performance killer — each sequential `await` adds a
full network round-trip. Work through these in order.

## Eliminating Waterfalls (CRITICAL)

```typescript
// Independent ops: parallelise — 3 round-trips become 1
const [user, posts, comments] = await Promise.all([
  fetchUser(), fetchPosts(), fetchComments(),
]);

// Partial dependencies: start everything early, await late
const userPromise = fetchUser();
const profilePromise = userPromise.then(u => fetchProfile(u.id));
const [user, config, profile] = await Promise.all([
  userPromise, fetchConfig(), profilePromise,
]);

// API routes / server actions: kick off independent work before awaiting
export async function GET(request: Request) {
  const sessionPromise = auth();          // starts now
  const configPromise = fetchConfig();    // starts now
  const session = await sessionPromise;
  const [config, data] = await Promise.all([
    configPromise, fetchData(session.user.id),
  ]);
  return Response.json({ data, config });
}

// Defer await into the branch that uses it — don't block the skip path
async function handle(userId: string, skip: boolean) {
  if (skip) return { skipped: true };          // returns immediately
  const data = await fetchUserData(userId);    // only when needed
  return process(data);
}
// Same idea: check cheap sync conditions BEFORE awaiting flags
if (someCondition) {
  const flag = await getFlag();
  if (flag) { /* ... */ }
}

// Per-item nested fetches: chain inside the item promise so one slow
// item doesn't block the others
const chatAuthors = await Promise.all(
  chatIds.map(id => getChat(id).then(chat => getUser(chat.author))),
);
```

## Suspense for Streaming (HIGH)

Don't block the whole layout on one section's data:

```tsx
function Page() {
  return (
    <div>
      <Sidebar />
      <Suspense fallback={<Skeleton />}>
        <DataDisplay />            {/* async — only this waits */}
      </Suspense>
      <Footer />
    </div>
  );
}

// Or share one promise across components with use()
function Page() {
  const dataPromise = fetchData();          // start now, don't await
  return (
    <Suspense fallback={<Skeleton />}>
      <DataDisplay dataPromise={dataPromise} />
      <DataSummary dataPromise={dataPromise} />
    </Suspense>
  );
}
function DataDisplay({ dataPromise }: { dataPromise: Promise<Data> }) {
  const data = use(dataPromise);
  return <div>{data.content}</div>;
}
```

Skip Suspense when: layout depends on the data, SEO-critical above-fold
content, or fast queries where the loading-jump hurts more than it helps.

**RSC parallelisation by composition** — sibling async components fetch in
parallel; sequential awaits in one component don't:

```tsx
async function Header() { const d = await fetchHeader(); return <div>{d}</div>; }
async function Sidebar() { const i = await fetchSidebarItems(); return <nav>{i.map(render)}</nav>; }
export default function Page() {
  return (<div><Header /><Sidebar /></div>);   // both fetch simultaneously
}
```

## Server-Side Caching and State

```typescript
// Per-request dedup — auth and DB lookups called from many components
import { cache } from "react";
export const getCurrentUser = cache(async () => {
  const session = await auth();
  return session ? db.user.findUnique({ where: { id: session.user.id } }) : null;
});
// Caveat: keyed by argument identity (Object.is) — inline object args
// never hit the cache. Next.js fetch() is already memoised per request;
// React.cache() is for DB/auth/computation.

// Cross-request caching — LRU (or Redis in isolated serverless)
import { LRUCache } from "lru-cache";
const cacheStore = new LRUCache<string, unknown>({ max: 1000, ttl: 5 * 60 * 1000 });

// Static assets: hoist I/O to module level — runs once, not per request
const fontData = fetch(new URL("./fonts/Inter.ttf", import.meta.url))
  .then(res => res.arrayBuffer());
export async function GET() {
  const font = await fontData;
  /* ... */
}
```

**Never store request data in mutable module state** — server renders run
concurrently in one process; one user's data leaks into another's
response. Pass request data down the tree as props. Module level is only
for immutable config/assets and deliberately shared, correctly keyed
caches.

**Non-blocking side effects** — logging, analytics, notifications after
the response:

```typescript
import { after } from "next/server";
export async function POST(request: Request) {
  await updateDatabase(request);
  after(async () => { await logUserAction(/* ... */); });   // post-response
  return Response.json({ status: "success" });
}
```

## Server Action Security (CRITICAL)

Server Actions are public endpoints. Auth-check and validate **inside**
every action — middleware and page guards don't protect direct
invocation:

```typescript
"use server";
export async function deleteUser(userId: string) {
  const session = await verifySession();
  if (!session) throw unauthorized("Must be logged in");
  if (session.user.role !== "admin" && session.user.id !== userId)
    throw unauthorized("Cannot delete other users");
  await db.user.delete({ where: { id: userId } });
}
```

Validate `unknown` input with Zod before touching it (see
typescript-development's validation reference).

## RSC Prop Serialisation

Everything crossing the server→client boundary is serialised into the
page payload — size matters:

- Pass the fields the client uses, not whole records
  (`<Profile name={user.name} />`, not `user` with 50 fields).
- Dedup is by object reference: passing `usernames` and
  `usernames.toSorted()` serialises both. Transform on the client
  (`useMemo`) instead — `.filter()/.map()/.toSorted()/{...spread}` all
  create new references and break dedup.

## Client-Side Fetching

- **SWR / TanStack Query, not useEffect+fetch** — automatic dedup across
  component instances, caching, revalidation. `useSWRMutation` for
  mutations.
- Don't subscribe to state you only read in callbacks — read
  `window.location.search` on demand instead of `useSearchParams` when
  nothing renders from it.
- Global event listeners: one shared listener (module-level registry or
  `useSWRSubscription`) instead of one per component instance; passive
  listeners (`{ passive: true }`) for scroll/touch/wheel handlers that
  never `preventDefault()`.
- localStorage: version the key (`config:v2`), store minimal fields,
  always try/catch (throws in private browsing and on quota).
