# Framework self-tests

Regression tests for the framework's *own* machinery — the hooks, the
hook-profile resolver, the config-security auditor, and the update system
(apply-update / check-updates / migrate-layout / doctor). This is the
framework testing itself, distinct from the project test suite a consumer
runs on their application code.

## Run

```bash
bash .claude/framework/tests/run-tests.sh            # local: skip absent tools
bash .claude/framework/tests/run-tests.sh --require  # CI: absent tool = failure
```

Three layers, all **opt-in by tool availability** (the framework's standard
pattern — a missing tool is a skip with an install hint, never a hard fail
unless `--require`):

1. **bats behavioural tests** (`*.bats`) — feed each hook a simulated event
   (stdin JSON + env vars) and assert on `(exit code + stdout)`. Run via
   `bats` if installed, else a pinned `npx bats` if Node is present.
2. **Node smoke** — `console-resolver.smoke.mjs`, the resolver-order check
   for `tools/console.mjs` (plain `node`, no bats harness).
3. **shellcheck** static analysis over `.claude/hooks`, `.claude/framework`
   and `tools/` shell scripts, plus `plugins/` when `plugins/ccmaf` exists
   (the framework dev repo).

## Why hooks are cleanly testable

Every hook is a pure function of `(stdin JSON event + environment)` →
`(exit code + stdout)`. No hidden inputs. So a test just pipes a fixture
event in and checks what comes out — e.g. feed `block-dangerous-commands.py`
a `rm -rf /` command and assert exit 2; feed `filter-test-output.sh` an
`npm test` command and assert the rewrite.

Executions run inside a throwaway git repo (`$BATS_TEST_TMPDIR`, see
`helpers.bash`) so any telemetry or state a hook writes lands in the temp
repo and never touches the real working tree.

## Files

Harness:

- `run-tests.sh` — entry point (bats + Node smoke + shellcheck, opt-in).
- `helpers.bash` — shared setup (`init_repo`, `hookrun`, `pyrun`).
- `update_helpers.bash` — synthetic upstream/consumer git fixtures for the
  update-system tier (a `git clone` of a local directory path stands in for
  the GitHub remote, so those suites run offline).
- `fixtures/`, `golden/` — the fixed config-security sample tree and its
  recorded findings.

Suites (one line each; the header comment of every file has the detail):

- Hooks: `hooks_behavior.bats` (per-hook behaviour), `lib_hook_common.bats`
  (profile / opt-out resolver and shared helpers), `fault_injection.bats`
  (malformed input must fail open), `session_lifecycle.bats`,
  `console_heartbeat.bats`, `settings_merge.bats`.
- Config security: `audit_config_security.bats`,
  `golden_config_security.bats`.
- Update system: `update_system.bats` (apply-update / check-updates /
  migrate-layout / doctor), `migrate_v2.bats`, `skills_check.bats`,
  `skills_sync.bats`.
- Doctor checks: `doctor_board_coherence.bats`,
  `doctor_reconcile_cadence.bats`, `doctor_state_budgets.bats`.
- v2 plugins: `core_plugin.bats`, `kernel_plugin.bats`,
  `plugins_structure.bats`, `plugin_drift.bats`.
- Scripts: `insights_behavior.bats`, `profiling.bats`, `rotate_state.bats`,
  `boot_view.bats`.
- `fix-*.bats` — regression cases for specific review-fix batches.
- `console-resolver.smoke.mjs` — Node smoke (layer 2 above).

## Install the tools

- **bats**: `npm i -g bats` (or rely on `npx bats` — Node only).
- **shellcheck**: `scoop install shellcheck` / `choco install shellcheck` /
  `apt install shellcheck`.

## Adding a test

Drop a new `@test` into the relevant `.bats` file. For a new hook, add a
case that feeds a representative event and asserts the exit code (and stdout
for hooks that emit JSON). Keep executions inside `$REPO` so they stay
hermetic. This file is the regression net for the framework itself — when a
hook bug is found and fixed, add the case that would have caught it (the
`config-security.sh` `|| return 0` bug, caught by this very suite, is the
canonical example).
