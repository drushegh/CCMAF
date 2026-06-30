---
name: testing-development
description: >-
  Cross-cutting test engineering above the unit level: test strategy and the
  test pyramid, end-to-end browser testing with Playwright, load and
  performance testing (k6, Apache JMeter, Azure Load Testing), API contract
  testing and regression discipline, and test-data management. Use whenever a
  task is about how to test a system rather than language-specific unit-test
  mechanics: "test strategy", "e2e", "Playwright", ".spec.ts", "load test",
  "performance test", "k6", "JMeter", "stress/soak/spike test", "flaky test",
  "contract test", "Pact", "regression suite", "test data". Triggers include
  playwright.config.ts, *.spec.ts E2E specs, k6 scripts, .jmx files, and Azure
  Load Testing config.yaml. PROACTIVELY activate when planning what and how to
  test, or designing an E2E/load suite. Owns cross-cutting testing; per-language
  unit/integration mechanics stay in the language skill.
---

# Testing Development

The cross-cutting testing layer: deciding **what to test and how**, and the
test types that span a whole system — end-to-end, load/performance, contract
and regression. Per-language unit and integration *mechanics* (the framework,
mocking, assertions) live in each language skill's testing reference; this
skill owns strategy and the system-level test types.

Tooling context (June 2026 — re-verify): **Playwright** for browser E2E (TS
default; also .NET/Python); **Grafana k6** (open-source) and **Apache JMeter**
for load; **Azure Load Testing** is the managed Azure service and runs JMeter
or Locust scripts (and URL-based quick tests) — not k6. **Pact** for consumer-
driven contracts.

## Non-negotiables

1. **Test behaviour, not implementation.** Assert on observable outcomes and
   public contracts, so tests survive refactors. Tests coupled to internals
   break on every change and get deleted — the worst outcome.
2. **Shape the suite like a pyramid.** Many fast unit tests, fewer
   integration, fewest E2E. E2E is for critical user journeys, not coverage —
   it's slow and the most flake-prone.
3. **Deterministic or deleted.** A flaky test is worse than no test — it trains
   people to ignore red. Fix the root cause (waits, shared state, time/random,
   ordering) or quarantine and fix; never `sleep()` past it or blanket-retry to
   green.
4. **Isolation.** Each test sets up and tears down its own state; no order
   dependence, no shared mutable fixtures, no reliance on a previous test's
   side effects. Run in parallel by default.
5. **Coverage is a signal, not a target.** Chasing a % rewards trivial tests.
   Cover the risky, complex and previously-broken paths; a green bar with no
   assertions on the hard logic is a lie.
6. **Regression: test what broke.** Every fixed bug gets a test that fails on
   the old code and passes on the fix, so it can't silently return.
7. **NFRs are requirements.** Performance, scalability and resilience targets
   (SLIs/SLOs) are tested and gated, not hoped for — especially where a contract
   specifies them.
8. **Tests run in CI and gate merges.** A test suite that isn't enforced is
   documentation. Pipeline wiring → `devops-development`.

## Decision tables

| Test type | Use for | Keep it... |
|---|---|---|
| Unit | Logic, branches, edge cases | Fast, isolated, the bulk (→ language skill) |
| Integration | Real collaborators (DB, queue, HTTP) | Targeted; ephemeral deps (testcontainers) |
| Contract | Service-to-service compatibility | Consumer-driven (Pact); in both CIs |
| E2E (Playwright) | Critical user journeys end to end | Few, stable, role-based locators |
| Load/performance | Throughput/latency under load vs SLOs | Scripted, scheduled, fail-criteria gated |

| Load tool | Pick when |
|---|---|
| **k6** | Code-first JS scripts, developer-owned, easy in CI/Git; no Azure dependency |
| **Apache JMeter** | GUI/XML test plans, broad protocol support (JDBC, JMS, TCP), existing JMX assets |
| **Azure Load Testing** | Managed high-scale runs of JMeter/Locust (or URL quick tests), server-side Azure metrics, VNet/private endpoints, CI/CD fail criteria |

## High-frequency pitfalls

- **Inverted pyramid** (mostly slow E2E) — slow, flaky, expensive to maintain.
- **`sleep()`/fixed waits in E2E** — the #1 flake source; use web-first
  auto-retrying assertions and event-based waits.
- **CSS/XPath locators tied to markup** — break on restyles; prefer role/label/
  text locators.
- **Shared test state / order dependence** — passes alone, fails in parallel.
- **Load test from one laptop** with no warm-up, think time or SLO — produces a
  number that means nothing. Model the workload and define pass/fail first.
- **Mocking what you don't own without a contract test** — your mock and the
  real service drift apart silently. Pair mocks with contract tests.
- **Snapshot tests over large blobs** — everyone rubber-stamps the update;
  snapshot small, meaningful structures only.
- **Chasing a coverage number** instead of covering risk.

## Workflow

1. Identify risk and requirements (incl. NFR/SLOs); decide which test types
   earn their place — not everything needs E2E.
2. Push detail down the pyramid: prove logic in unit/integration; reserve E2E
   for the few journeys that must work.
3. For E2E, model user actions with role-based locators and fixtures; for load,
   model the workload (ramp/soak/spike) and the pass/fail criteria.
4. Make every test deterministic and isolated; manage its own data.
5. Wire into CI as a merge gate (→ devops-development); track and kill flake.
6. On every bug: add the failing regression test first, then fix.

## Reference index

Load on demand:

- `references/test-strategy.md` — pyramid/trophy, what-to-test, test doubles, flakiness, coverage
- `references/e2e-playwright.md` — locators, web-first assertions, fixtures, trace, projects, auth, CI
- `references/load-performance.md` — k6, JMeter, Azure Load Testing; workload models, SLOs, fail criteria
- `references/contract-regression.md` — consumer-driven contracts (Pact), regression discipline, snapshots
- `references/test-data.md` — factories/fixtures, ephemeral deps (testcontainers), seeding, synthetic data

## Boundaries

- **Per-language unit/integration mechanics** (test framework, mocking,
  assertions, running `pytest`/`dotnet test`/`vitest`) → the language skill
  (`python-development`, `dotnet-development`, `typescript-development`).
- **Running tests in CI / pipelines** → `devops-development`.
- **Accessibility testing** (axe, screen readers) → `accessibility-development`
  (testing-tooling). This skill's E2E reference cross-references it.
- **API design and the contract's shape** → `api-development`; this skill owns
  *testing* that contract.
- **Browser automation for scraping** (vs assertion) → `web-scraping-development`
  (shares Playwright, different intent).
