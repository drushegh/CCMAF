# GitHub Actions

## Shape

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }

permissions:
  contents: read            # least privilege at top level

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-22.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6
        with: { fetch-depth: 1 }
      - uses: actions/setup-node@v4   # pin to SHA in production repos
        with: { node-version: 20, cache: npm }
      - run: npm ci && npm test
      - uses: actions/upload-artifact@v4
        with:
          name: dist-${{ github.sha }}
          path: dist/

  deploy:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-22.04
    environment: production    # required reviewers + env secrets
    permissions:
      id-token: write          # OIDC
      contents: read
    steps:
      - uses: actions/download-artifact@v4
        with:
          name: dist-${{ github.sha }}
      - uses: azure/login@v2
        with:
          client-id: ${{ vars.AZURE_CLIENT_ID }}
          tenant-id: ${{ vars.AZURE_TENANT_ID }}
          subscription-id: ${{ vars.AZURE_SUBSCRIPTION_ID }}
      - run: ./deploy.sh
```

## Reuse: pick the right mechanism

| Mechanism | Use for |
| --- | --- |
| **Reusable workflow** (`on: workflow_call`, caller `uses: org/repo/.github/workflows/x.yml@sha`) | Whole-job/multi-job pipelines shared across repos; supports secrets passing, environments |
| **Composite action** (`action.yml`, `runs.using: composite`) | A bundle of steps (setup + cache + auth) reused inside jobs |
| Matrix (`strategy.matrix`, `fail-fast: false`) | Same job across OS/runtime versions |

Version internal shared workflows/actions like code: tags + SHAs,
changelog, no `@main` consumers in production.

## Contexts and expressions

`${{ github.* }}`, `needs.<job>.outputs.*`, `vars.*` (plain config),
`secrets.*` (masked). Outputs flow: step `id` →
`$GITHUB_OUTPUT` → `steps.x.outputs.y` → job `outputs:` →
`needs.x.outputs.y`. `if:` conditions omit the `${{ }}` wrapper safely;
`always()`/`failure()` for cleanup/notification steps. Don't interpolate
untrusted input (`github.event.*` strings) into `run:` — inject via
`env:` instead (script-injection defence).

## Environments, runners, operations

- **Environments** carry protection rules (required reviewers, wait
  timers, branch restrictions) and scoped secrets — the prod gate.
- Hosted runners for standard work; **self-hosted runners** only with
  hardening (never on public repos — fork PRs can execute on them);
  larger runners for heavy builds; ARC for Kubernetes-scale fleets.
- Caching: `actions/cache` (or setup-* built-ins) keyed on lockfiles;
  cache poisoning is a thing — don't cache across trust boundaries.
- Debug failures from logs (`gh run view --log-failed`), re-run with
  debug logging (`ACTIONS_STEP_DEBUG`); `gh` CLI scripts the rest
  (dispatch, watch, artifact download).
- `workflow_dispatch` with typed inputs for operational jobs;
  `workflow_run` for chaining; schedule (`cron`) runs in UTC and gets
  disabled after 60 days of repo inactivity — don't bet compliance
  jobs on it without monitoring.

Docs: https://docs.github.com/actions ·
https://docs.github.com/actions/sharing-automations/reusing-workflows ·
https://docs.github.com/actions/security-for-github-actions ·
https://github.com/marketplace?type=actions
