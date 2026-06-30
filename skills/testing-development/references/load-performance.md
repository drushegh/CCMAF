# Load and performance testing

Find how the system behaves under load *before* production does. Define the
target and pass/fail criteria first; a load run without an SLO is just traffic.

## Define the test before the tool

- **SLIs/SLOs**: the metrics that matter (p95/p99 latency, throughput/RPS,
  error rate) and the thresholds that pass. Derive from requirements / the
  contract's NFRs.
- **Workload model**: realistic mix of journeys, think time between actions,
  and a ramp — not an instant thundering herd (unless you're testing exactly
  that).
- **Test types**: **load** (expected peak), **stress** (beyond peak, find the
  breaking point), **soak** (sustained, find leaks/degradation), **spike**
  (sudden surge, test elasticity).
- **Environment**: production-like and isolated; warm caches/JIT; never load-
  test from a single laptop and never (accidentally) production.

## k6 — code-first, developer-owned

JavaScript scripts, great in Git/CI, no platform dependency.

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },  // ramp up
    { duration: '5m', target: 100 },  // steady
    { duration: '2m', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],   // fail if p95 >= 500ms
    http_req_failed: ['rate<0.01'],     // fail if error rate >= 1%
  },
};

export default function () {
  const res = http.get(`${__ENV.BASE_URL}/api/products`);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
```

`thresholds` are the pass/fail gate — a breached threshold fails the run (and
the pipeline). Keep think time (`sleep`) realistic.

## Apache JMeter — broad protocols, existing assets

GUI/XML (`.jmx`) test plans; supports HTTP, JDBC, JMS, TCP and more via
plugins. Strong when you have existing JMX assets or need non-HTTP protocols.
Run headless in CI (`jmeter -n -t plan.jmx -l results.jtl`); keep plans in
source control and parameterise with user-properties/CSV data sets.

## Azure Load Testing — managed, high scale

The managed Azure service: runs **JMeter or Locust** scripts, or generates a
script from a **URL-based quick test**. It abstracts the test-engine
infrastructure (instances ≈ virtual users / 250), captures **server-side Azure
metrics** via Azure Monitor (App Insights/Container Insights) alongside
client-side, supports **private endpoints/VNet**, and integrates with CI/CD
with **fail criteria**. (It does *not* run k6.)

```yaml
version: v0.1
testId: products-load
displayName: Products API load
testPlan: products.jmx
engineInstances: 2
failureCriteria:
  - avg(response_time_ms) > 500
  - percentage(error) > 1
```

Reference this `config.yaml` from a GitHub Actions / Azure Pipelines step; use a
**managed identity** for the test resource and Key Vault for secret parameters.

## Reading results

Report percentiles (p95/p99), not just averages — averages hide the tail.
Correlate client-side latency with server-side resource metrics to find the
bottleneck (CPU, connections, DB, GC). Compare runs over time to catch
regressions; gate the pipeline on the SLO. Pipeline wiring →
`devops-development`; the app/infra being scaled → `azure-development`.
