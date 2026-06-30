# End-to-end testing with Playwright

E2E proves critical user journeys work through a real browser. Keep the suite
small, stable and meaningful — it's the slowest, most flake-prone layer.
Playwright is the default (TypeScript shown; .NET and Python bindings exist).

## Locators — resilient by default

Prefer **user-facing, role-based** locators; they survive restyles and assert
accessibility at the same time. Avoid CSS/XPath tied to markup.

```typescript
// Good
page.getByRole('button', { name: 'Submit' });
page.getByLabel('Email');
page.getByText('Welcome back');
// Avoid
page.locator('div.btn-primary > span:nth-child(2)');
```

## Web-first assertions — never sleep

Use auto-retrying assertions that `await`; Playwright waits for the condition.
No fixed `waitForTimeout`.

```typescript
import { test, expect } from '@playwright/test';

test.describe('Checkout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/cart');
  });

  test('completes a purchase', async ({ page }) => {
    await test.step('submit payment', async () => {
      await page.getByRole('button', { name: 'Pay now' }).click();
    });
    await expect(page.getByRole('heading', { name: 'Order confirmed' })).toBeVisible();
    await expect(page).toHaveURL(/\/orders\/\d+/);
  });
});
```

Group steps with `test.step()` for readable reports. `toMatchAriaSnapshot`
verifies a component's accessibility tree compactly.

## Fixtures over Page Object boilerplate

Centralise setup (auth, seeded data, page helpers) in **fixtures** built around
business actions, not raw API calls. Reuse auth via `storageState` so most
tests skip the login flow.

```typescript
import { test as base } from '@playwright/test';

export const test = base.extend<{ loggedInPage: import('@playwright/test').Page }>({
  loggedInPage: async ({ browser }, use) => {
    const context = await browser.newContext({ storageState: 'auth.json' });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});
```

## Config: projects, parallelism, traces

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: { trace: 'on-first-retry', baseURL: process.env.BASE_URL },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
```

- **Projects** run the suite across browser engines (and can model setup
  dependencies).
- **`trace: 'on-first-retry'`** captures a full DOM/network/console timeline
  only when a test retries — invaluable for debugging CI flake without the
  overhead of always-on tracing.
- **Workers** parallelise locally; **shard** across CI machines
  (`--shard=1/4`). Retries mask flake — investigate retried tests, don't
  celebrate the green.

## In CI and adjacent concerns

Install only the needed browsers (`npx playwright install --with-deps
chromium`); publish the HTML report and traces as artefacts. Pipeline wiring →
`devops-development`. For **accessibility** assertions beyond the ARIA
snapshot (axe-core, screen-reader checks) → `accessibility-development`. Test
*data* setup → `test-data.md`.
