# Test data management

Test data is where suites become slow, flaky and order-dependent. Each test
should create exactly the data it needs and clean up after itself.

## Build data in code, not shared fixtures

Prefer **factories/builders** that produce a valid object with sensible
defaults and let a test override only the fields it cares about. This keeps
tests readable (the override *is* the intent) and resilient to schema growth.

```typescript
function makeOrder(overrides = {}) {
  return { id: crypto.randomUUID(), status: 'open', total: 10, ...overrides };
}

test('paid orders are not cancellable', () => {
  const order = makeOrder({ status: 'paid' });   // only the relevant field
  expect(canCancel(order)).toBe(false);
});
```

Avoid large shared fixture files that many tests read and a few mutate — they
create hidden coupling and order dependence. A test's data should be obvious
from the test.

## Isolation and teardown

- Give each test its own records (unique keys / random IDs) so parallel runs
  don't collide.
- Roll back per test (a transaction rolled back in teardown) or recreate state;
  don't depend on a previous test having run.
- Reset global/singleton state, clocks and seeded randomness between tests.

## Real dependencies with testcontainers

For integration tests, run the **real** database/broker in a throwaway
container rather than mocking it or sharing a long-lived instance — you test
against actual behaviour, isolated per run.

```python
from testcontainers.postgres import PostgresContainer

def test_repository_roundtrip():
    with PostgresContainer("postgres:18") as pg:
        engine = create_engine(pg.get_connection_url())
        run_migrations(engine)        # real schema
        repo = OrderRepository(engine)
        repo.save(make_order(status="paid"))
        assert repo.get_open() == []
```

Seed via your real migration + a small factory, so the test exercises the
actual schema (migrations → `sql-development`).

## Synthetic data and privacy

- **Never use real production personal data in tests.** Generate synthetic data
  (Faker/Bogus) or **mask/anonymise** a production-shaped sample. This is a
  GDPR obligation, not a nicety → `secure-development`.
- Make synthetic data realistic enough to exercise edge cases (unicode names,
  long strings, boundary numbers, awkward dates/timezones).
- Keep secrets/connection strings for test environments out of the repo (CI
  secrets / Key Vault), same as production.

## E2E and load data

- E2E: seed via an API/fixture before the journey (see `e2e-playwright.md`),
  not by clicking through setup UI; reuse authenticated `storageState`.
- Load: parameterise scripts with CSV/data sets so virtual users don't all hit
  the same record and skew caches (`load-performance.md`).
