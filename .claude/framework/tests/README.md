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

Two layers, both **opt-in by tool availability** (the framework's standard
pattern — a missing tool is a skip with an install hint, never a hard fail
unless `--require`):

1. **bats behavioural tests** (`*.bats`) — feed each hook a simulated event
   (stdin JSON + env vars) and assert on `(exit code + stdout)`. Run via
   `bats` if installed, else `npx bats` if Node is present.
2. **shellcheck** static analysis over `.claude/hooks` + `.claude/framework`
   shell scripts.

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

- `run-tests.sh` — entry point (bats + shellcheck, opt-in).
- `helpers.bash` — shared setup (`init_repo`, `hookrun`, `pyrun`).
- `lib_hook_common.bats` — profile / opt-out resolver unit tests.
- `hooks_behavior.bats` — per-hook behavioural tests.
- `audit_config_security.bats` — config-surface auditor tests.
- `update_system.bats` + `update_helpers.bash` — update-system tier:
  synthetic upstream/consumer git repos in `$BATS_TEST_TMPDIR` (a `git clone`
  of a local directory path stands in for the GitHub remote, so the whole
  tier runs offline) exercising apply-update's staging/swap and dirty-tree
  refusals, check-updates' throttle/flag lifecycle, migrate-layout's
  invariants, and doctor's CRITICAL classes.

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
