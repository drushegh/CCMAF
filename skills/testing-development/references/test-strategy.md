# Test strategy

Decide what to test, at what level, and how much — before writing tests.

## The shape: pyramid (or trophy)

- **Pyramid**: many **unit** tests (fast, isolated, cheap), fewer
  **integration** tests (real collaborators), fewest **E2E** (slow, broad).
- **Testing trophy** (common for web/IO-heavy apps): the centre of gravity is
  **integration** — tests that exercise real wiring with test doubles only at
  the system edge — because that's where the risk and confidence-per-test are
  highest. Static analysis/types form the base.

Either way the principle holds: **push detail down**. Prove branching logic and
edge cases cheaply at the unit level; reserve slow, flaky E2E for the few
journeys that must work. An inverted pyramid (mostly E2E) is slow, brittle and
expensive.

## What to test (risk-based)

Spend effort where failure costs most and behaviour is complex:

- Core business rules, money/security-affecting paths, complex branching.
- Boundaries and edge cases (empty, null, max, off-by-one, timezone, encoding).
- Previously-broken paths (regression — see `contract-regression.md`).
- Integration seams (DB, queue, external API) where assumptions hide.

Don't test the framework, the language, or trivial getters. A test with no
meaningful assertion is negative value.

## Test doubles — use the right one

- **Stub** — returns canned data (no assertion on interaction).
- **Mock** — asserts an interaction happened (use sparingly; over-mocking
  couples tests to implementation).
- **Fake** — a working lightweight implementation (in-memory repo).
- **Spy** — records calls for later inspection.
Prefer the real thing where cheap (in-memory DB, testcontainers). **Only mock
what you own**, and where you mock a service you don't own, back it with a
**contract test** so the mock can't drift from reality.

## Determinism and flakiness

Flaky tests are a liability — they erode trust until red is ignored. Root
causes and fixes:

- **Timing** → web-first/auto-retrying assertions, polling, event waits — never
  `sleep()`.
- **Shared state / order dependence** → isolate; fresh data per test.
- **Time/randomness** → inject a clock and seed; freeze time.
- **External flakiness** → stub at the boundary; contract-test the real one.
Policy: a flaky test is **fixed or quarantined-with-an-owner-and-deadline**,
never blanket-retried to green.

## Coverage

Coverage is a **signal, not a target**. High coverage with weak assertions is a
false comfort; a critical untested path is the real risk. Track coverage to
find blind spots, gate on *not regressing* on critical modules — don't mandate
a blanket percentage that rewards trivial tests.

## NFRs are tests too

Performance, scalability, resilience and security expectations are
requirements: express them as SLIs/SLOs and **test and gate** them
(`load-performance.md`), especially where a contract specifies response times,
throughput or availability.
