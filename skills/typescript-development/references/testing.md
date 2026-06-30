# Testing

Vitest by default (fast, ESM-native, Jest-compatible API) — or whatever the
repo already uses. Testing Library for components, MSW for API mocking.
Tests are **co-located** with the code: `formatDate.ts` /
`formatDate.test.ts`.

## What to Cover

Happy path, invalid inputs, edge cases (empty/null/undefined/boundaries),
error conditions (network/DB failures), and state transitions. All new or
changed logic gets tests; every bug fix starts with a failing regression
test.

```typescript
describe("createUser", () => {
  it("creates user with valid data", async () => {
    const user = await createUser({ name: "Alice", email: "alice@example.com" });
    expect(user.name).toBe("Alice");
  });

  it("rejects invalid email", async () => {
    await expect(createUser({ name: "Alice", email: "invalid" }))
      .rejects.toThrow("Invalid email");
  });

  it("rejects duplicate email", async () => {
    await createUser({ name: "Alice", email: "alice@example.com" });
    await expect(createUser({ name: "Bob", email: "alice@example.com" }))
      .rejects.toThrow("Email already exists");
  });
});
```

Arrange-Act-Assert; descriptive names stating behaviour; one concern per
test; factories/fixtures for test data; mock external dependencies — don't
test implementation details.

## Component Tests — User-Centric Queries

```typescript
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

it("calls onClick when button is pressed", async () => {
  const handleClick = vi.fn();
  render(<Button label="Submit" onClick={handleClick} />);
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));
  expect(handleClick).toHaveBeenCalledOnce();
});
```

Query by role/label/text (what users perceive), not by test IDs or CSS
classes, so tests survive refactors.

## API Mocking with MSW

MSW intercepts at the network level, so the same handlers serve component
tests, integration tests, and local dev:

```typescript
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

const server = setupServer(
  http.get("/api/users/:id", ({ params }) =>
    HttpResponse.json({ id: params.id, name: "Alice" }),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## Mocking Functions and Modules

```typescript
const spy = vi.fn().mockResolvedValue({ id: "1" });

vi.mock("./mailer", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));
```

Prefer MSW over mocking fetch/axios directly; prefer dependency injection
over module mocks where the design allows.

## Configuration

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",          // "jsdom" for component tests
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/types/**"],
    },
    // For DB-backed integration tests:
    // globalSetup: "./test/global-setup.ts",   // run migrations once
    // setupFiles: ["./test/setup.ts"],          // per-file setup
  },
});
```

`vite-tsconfig-paths` plugin if the project uses path aliases. Run with
`vitest run` (CI) / `vitest` (watch). Coverage focuses on critical paths —
don't chase 100%.

## Type-Level Tests

For non-trivial type utilities, test the types themselves:

```typescript
import { expectTypeOf } from "vitest";

it("infers the unwrapped type", () => {
  expectTypeOf<UnwrapPromise<Promise<number>>>().toEqualTypeOf<number>();
});
```
