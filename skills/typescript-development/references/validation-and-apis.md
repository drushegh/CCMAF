# Validation and API Layers

External data — HTTP responses, request bodies, env vars, file contents,
anything `unknown` — is validated with Zod at the boundary. Inside the
boundary, the types are trusted. Never bridge the gap with `as`.

## Schema-First with Zod

Define the schema once; derive the type from it. Schema and type can never
drift apart.

```typescript
import { z } from "zod";

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(["admin", "user"]),
});
type User = z.infer<typeof UserSchema>;

// safeParse for expected-invalid input (user data) — no exceptions
const result = UserSchema.safeParse(input);
if (!result.success) {
  return { errors: result.error.flatten().fieldErrors };
}
// result.data is User

// parse for should-be-valid data (own config) — throws on violation
const config = ConfigSchema.parse(rawConfig);
```

Zod schemas double as type guards:

```typescript
function isUser(obj: unknown): obj is User {
  return UserSchema.safeParse(obj).success;
}
```

## Validated Fetch Wrapper

```typescript
type Result<T, E = Error> = { ok: true; data: T } | { ok: false; error: E };

async function apiClient<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<Result<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
    if (!res.ok) return { ok: false, error: new Error(`HTTP ${res.status}`) };
    return { ok: true, data: schema.parse(await res.json()) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
```

Request AND response get schemas — the API contract lives in code:

```typescript
const GetUserResponseSchema = z.object({ id: z.string(), name: z.string() });

async function getUser(userId: string) {
  return apiClient(`/api/users/${userId}`, GetUserResponseSchema);
}
```

## tRPC — Same-Repo Full-Stack

When frontend and backend share a TypeScript repo, tRPC gives end-to-end
types with no codegen:

```typescript
// server
const appRouter = router({
  user: router({
    getById: procedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => db.user.findUnique({ where: { id: input.id } })),
  }),
});

// client — fully typed
const user = await trpc.user.getById.query({ id: "123" });
```

For external/public APIs or polyglot stacks, use OpenAPI with code
generation instead.

## Forms

Validate with the same schema on client and server; map Zod errors to
field-level messages:

```typescript
const FormSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

async function handleSubmit(formData: FormData) {
  const result = FormSchema.safeParse(Object.fromEntries(formData));
  if (!result.success) {
    setErrors(result.error.flatten().fieldErrors);
    return;
  }
  try {
    await login(result.data);
  } catch {
    setErrors({ _form: ["Login failed"] });
  }
}
```

Also validate route/query params with Zod in routers that support loaders
(React Router/Remix, TanStack Router).

## Environment Variables

`process.env` values are `string | undefined` and silently wrong env kills
apps at runtime. Validate once at startup:

```typescript
const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]),
});

export const env = EnvSchema.parse(process.env);   // crash early, not mid-request
```

Never hardcode secrets; never commit `.env` files.

## Error Responses

Consistent shape across the API: programmatic code, human-readable message,
optional field-level details. Log internals server-side; never return stack
traces to clients.
