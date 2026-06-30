# Contract testing and regression

## The problem contract tests solve

When service A calls service B, A's unit tests mock B. Over time B changes and
A's mock doesn't — both test suites are green while production breaks.
**Consumer-driven contract testing** closes the gap: the consumer declares what
it needs, and the provider verifies it still meets that contract.

## Pact (consumer-driven)

1. **Consumer** test runs against a mock provider and records expected
   interactions as a **contract** (pact file).

```javascript
const { PactV4 } = require('@pact-foundation/pact');

const pact = new PactV4({ consumer: 'web', provider: 'orders-api' });

test('gets an order', async () => {
  await pact
    .addInteraction()
    .uponReceiving('a request for order 1')
    .withRequest('GET', '/orders/1')
    .willRespondWith(200, (b) => b.jsonBody({ id: 1, status: 'open' }))
    .executeTest(async (mock) => {
      const res = await getOrder(mock.url, 1);
      expect(res.status).toBe('open');
    });
});
```

2. The contract is shared (a Pact Broker / Git) and the **provider** replays it
   against the real service in *its* CI. If the provider can't satisfy the
   contract, its build fails — the break is caught at the source, before
   deploy.

Use **provider states** to set up the data a given interaction needs. Contract
tests verify *compatibility*, not business logic — keep them about the
request/response shape and status.

## Schema/OpenAPI validation

Cheaper than full Pact for one-directional cases: validate responses against
the OpenAPI schema (the contract `api-development` defines), and run a
**breaking-change diff** (`oasdiff`) on the spec in CI. Good for public APIs
where you own the spec and many unknown consumers depend on it.

## Regression discipline — "test what broke"

The highest-value regression tests come from real defects. The rule:

1. Reproduce the bug with a **failing test** first (red on the buggy code).
2. Fix the code until that test passes (green).
3. Keep the test forever — it now guards against the bug returning, even when
   an AI or a teammate refactors nearby later.

This beats chasing blanket coverage: it concentrates effort exactly where the
system has already proven fragile. Tag these tests so their intent is obvious.

## Snapshot testing — use narrowly

Snapshots are useful for stable, small, meaningful output (a serialised DTO, a
rendered component's structure). They rot when:

- The snapshot is huge → reviewers rubber-stamp `--update` and bugs sail through.
- The output is volatile (timestamps, IDs, ordering) → constant churn.

Snapshot small, deterministic structures; assert specific fields for anything
volatile. A snapshot you always update tests nothing.
