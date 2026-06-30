# Functional Patterns — Making Illegal States Unrepresentable

Encode business rules in types so the compiler proves correctness: invalid
states can't be constructed, missing cases are compile errors, refactoring
becomes mechanical.

## Discriminated Unions (Sum Types)

One of several variants, distinguished by a discriminant field. Use a
**consistent discriminant name** per codebase (`kind`, `type`, or `_tag`).

```typescript
type PaymentMethod =
  | { kind: "card"; last4: string; brand: string }
  | { kind: "ach"; accountNumber: string; routingNumber: string }
  | { kind: "wallet"; provider: "apple" | "google" };

function describe(method: PaymentMethod): string {
  switch (method.kind) {
    case "card":   return `${method.brand} ending ${method.last4}`;
    case "ach":    return `Bank account ending ${method.accountNumber.slice(-4)}`;
    case "wallet": return `${method.provider} Pay`;
    default:       return assertNever(method);
  }
}

const assertNever = (x: never): never => {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}`);
};
```

`assertNever` in the default case means adding a variant breaks the build
everywhere it isn't handled — that's the point.

### Replace Boolean Soup with Explicit States

```typescript
// Bad — what does { isPaid: true, isCancelled: true } mean?
type Order = { id: string; isPaid: boolean; isShipped: boolean; isCancelled: boolean };

// Good — impossible combinations cannot exist
type OrderStatus =
  | { kind: "pending" }
  | { kind: "paid"; paidAt: Date }
  | { kind: "shipped"; trackingNumber: string; shippedAt: Date }
  | { kind: "cancelled"; reason: string; cancelledAt: Date };

type Order = { id: string; status: OrderStatus };
```

### Generic Async/Remote State

```typescript
type RemoteData<T, E> =
  | { status: "not-asked" }
  | { status: "loading" }
  | { status: "success"; data: T }
  | { status: "failure"; error: E };
```

## Result and Option

Make failure and absence explicit in signatures. Decision guide: value may
legitimately be absent → **Option**; operation may fail recoverably →
**Result**; programmer error / unrecoverable → **exception**.

```typescript
// Paste-ready core (or use a library like neverthrow / effect)
type Option<T> = { _tag: "None" } | { _tag: "Some"; value: T };
const None: Option<never> = { _tag: "None" };
const Some = <T>(value: T): Option<T> => ({ _tag: "Some", value });

type Result<T, E> = { _tag: "Ok"; value: T } | { _tag: "Err"; error: E };
const Ok = <T>(value: T): Result<T, never> => ({ _tag: "Ok", value });
const Err = <E>(error: E): Result<never, E> => ({ _tag: "Err", error });

const isOk = <T, E>(r: Result<T, E>): r is { _tag: "Ok"; value: T } => r._tag === "Ok";

const mapResult = <T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> =>
  r._tag === "Ok" ? Ok(fn(r.value)) : r;

const flatMapResult = <T, U, E>(r: Result<T, E>, fn: (v: T) => Result<U, E>): Result<U, E> =>
  r._tag === "Ok" ? fn(r.value) : r;
```

```typescript
// Error types are themselves discriminated unions — not string or Error
type HttpError =
  | { kind: "network"; message: string }
  | { kind: "server"; statusCode: number }
  | { kind: "parse"; message: string };

async function fetchUser(id: string): Promise<Result<User, HttpError>> {
  try {
    const res = await fetch(`/api/users/${id}`);
    if (!res.ok) return Err({ kind: "server", statusCode: res.status });
    return Ok(UserSchema.parse(await res.json()));
  } catch (e) {
    return Err({ kind: "network", message: String(e) });
  }
}
```

```typescript
// Early-return chaining keeps it readable without monadic machinery
function processOrder(orderId: string): Result<Order, OrderError> {
  const order = findOrder(orderId);
  if (order._tag === "Err") return order;

  const payment = processPayment(order.value);
  if (payment._tag === "Err") return payment;

  return Ok(order.value);
}
```

Don't mix conventions: pick Option **or** `null` handling per codebase, not
both.

## Branded Types and Smart Constructors

TypeScript is structurally typed — `UserId` and `OrderId` aliased to
`string` are interchangeable, which is how IDs and units get mixed. Brands
add compile-time nominal typing with zero runtime cost:

```typescript
type Brand<K, T> = K & { __brand: T };

type UserId = Brand<string, "UserId">;
type Cents = Brand<number, "Cents">;
type Millis = Brand<number, "Millis">;

// Smart constructor: validate once at creation; the only sanctioned `as`
const Cents = (n: number): Cents => {
  if (!Number.isInteger(n) || n < 0) throw new Error("Cents must be a non-negative integer");
  return n as Cents;
};

type Email = Brand<string, "Email">;
const Email = (s: string): Email => {       // type + value share the name
  const t = s.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw new Error("Invalid email");
  return t as Email;
};
```

Use for: money (integer cents — kills float errors), time units
(Millis/Seconds), IDs (UserId/OrderId), validated strings (Email, Url,
NonEmptyString), constrained numbers (Port, Percentage).

For **external input**, provide a Result-returning parse alongside the
throwing constructor — user error is expected, programmer error is not:

```typescript
const parseEmail = (s: string): Result<Email, string> => {
  try { return Ok(Email(s)); } catch { return Err("Invalid email format"); }
};
```

## State Machines

```typescript
type TxnState =
  | { kind: "pending"; createdAt: Millis }
  | { kind: "settled"; ledgerId: string; settledAt: Millis }
  | { kind: "failed"; reason: string; failedAt: Millis };

// Transitions validate the source state — invalid transitions throw
function settle(state: TxnState, ledgerId: string, at: Millis): TxnState {
  if (state.kind !== "pending") throw new Error("Can only settle pending transactions");
  return { kind: "settled", ledgerId, settledAt: at };
}
```

A "pending transaction with a ledgerId" simply cannot exist — the variant
doesn't carry the field.

## Adoption in Existing Codebases

Apply to new features immediately; refactor existing code opportunistically
when touching it; prioritise high-risk areas (money, state machines).
Centralise the helpers in one `lib/functional.ts` and import every