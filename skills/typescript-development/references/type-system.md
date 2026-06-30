# Type System

## Generics

```typescript
// Constrain with extends to narrow what's accepted
function logLength<T extends { length: number }>(item: T): T {
  console.log(item.length);
  return item;
}

// Key-safe property access
function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}
```

Only generalise when there are 2+ concrete uses — over-generic code is
harder to read and slower to compile.

## Conditional Types and `infer`

```typescript
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;
type ElementType<T> = T extends (infer U)[] ? U : never;

// Distributive over unions:
type ToArray<T> = T extends unknown ? T[] : never;
type A = ToArray<string | number>;   // string[] | number[]
```

## Mapped Types

```typescript
// Transform every property
type Mutable<T> = { -readonly [P in keyof T]: T[P] };

// Key remapping
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

// Filter properties by value type
type PickByType<T, U> = {
  [K in keyof T as T[K] extends U ? K : never]: T[K];
};

// Deep variants — use sparingly, they're recursive
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
```

## Template Literal Types

```typescript
type EventName = "click" | "focus" | "blur";
type Handler = `on${Capitalize<EventName>}`;   // "onClick" | "onFocus" | "onBlur"

// Dot-path of a config object (recursive)
type Path<T> = T extends object
  ? { [K in keyof T]: K extends string ? `${K}` | `${K}.${Path<T[K]>}` : never }[keyof T]
  : never;
```

## Built-in Utility Types — reach for these before writing your own

`Partial<T>`, `Required<T>`, `Readonly<T>`, `Pick<T, K>`, `Omit<T, K>`,
`Record<K, V>`, `Exclude<T, U>`, `Extract<T, U>`, `NonNullable<T>`,
`ReturnType<T>`, `Parameters<T>`, `Awaited<T>`.

```typescript
type UserPreview = Pick<User, "id" | "name">;
type UserDraft = Omit<User, "id" | "createdAt">;
type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;
```

## Narrowing: Guards and Assertion Functions

```typescript
// Type predicate
function isString(value: unknown): value is string {
  return typeof value === "string";
}

// Generic array guard
function isArrayOf<T>(value: unknown, guard: (i: unknown) => i is T): value is T[] {
  return Array.isArray(value) && value.every(guard);
}

// Assertion function — narrows after the call
function assertIsString(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new Error("Not a string");
}
```

For external data, prefer Zod over hand-written guards — one schema gives
you the guard, the parser, and the type.

## `satisfies` and Const Assertions

```typescript
// satisfies: validate against a type WITHOUT widening the inferred type
const config = {
  port: 3000,
  host: "localhost",
} satisfies ServerConfig;
// config.port is number (precise), but the shape is checked

// as const: preserve literal types
const ROLES = ["admin", "editor", "viewer"] as const;
type Role = (typeof ROLES)[number];   // "admin" | "editor" | "viewer"
```

## Typed Event Emitter Pattern

```typescript
type EventMap = {
  "user:created": { id: string; name: string };
  "user:deleted": { id: string };
};

class TypedEventEmitter<T extends Record<string, unknown>> {
  private listeners: { [K in keyof T]?: Array<(data: T[K]) => void> } = {};

  on<K extends keyof T>(event: K, cb: (data: T[K]) => void): void {
    (this.listeners[event] ??= []).push(cb);
  }
  emit<K extends keyof T>(event: K, data: T[K]): void {
    this.listeners[event]?.forEach((cb) => cb(data));
  }
}
```

## Type Testing

```typescript
type AssertEqual<T, U> =
  [T] extends [U] ? ([U] extends [T] ? true : false) : false;

type _test1 = AssertEqual<Role, "admin" | "editor" | "viewer">;  // true
```

Vitest also ships `expectTypeOf` / `assertType` for type-level tests in the
test suite.

## Compiler Performance

Deeply nested conditional and recursive types slow compilation and produce
unreadable errors. Prefer simple types where possible, limit recursion
depth, and use `interface extends` over repeated large intersections.
