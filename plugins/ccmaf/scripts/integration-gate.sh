#!/usr/bin/env bash
# integration-gate.sh — the wave-level integration gate (TASK-153 / CORE-DESIGN §4).
#
# Whole-project truth as ONE boolean: exit 0 = the project builds/boots and
# its cheapest smoke passes; non-zero = the wave does not merge. Prints ONE
# line either way — the orchestrator consumes the line + exit code, never
# raw tool output (push→pull inversion; raw logs go to a file).
#
# Stack dispatch by manifest (the start-project.sh convention); a project
# can replace the whole gate with .claude/integration-gate.local.sh.
# Runs from the project root (callers cd there / hooks are cd-anchored).
set -u

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
cd "$root" 2>/dev/null || { echo "GATE FAIL: cannot cd to project root ($root)"; exit 1; }

log_dir="$root/.claude/telemetry"
[ -d "$log_dir" ] || log_dir="${TMPDIR:-/tmp}"
log="$log_dir/integration-gate.log"

run_gate() {
  # Project override wins outright.
  if [ -f "$root/.claude/integration-gate.local.sh" ]; then
    bash "$root/.claude/integration-gate.local.sh"
    return $?
  fi

  if [ -f package.json ]; then
    # Build if a build script exists, then the cheapest test signal.
    if grep -q '"build"[[:space:]]*:' package.json; then
      npm run build --if-present || return 1
    fi
    if grep -q '"test"[[:space:]]*:' package.json; then
      npm test || return 1
    fi
    return 0
  fi
  if [ -f pyproject.toml ] || [ -f setup.py ]; then
    if command -v pytest >/dev/null 2>&1; then
      pytest -x -q || return 1
    else
      python -m compileall -q . || return 1
    fi
    return 0
  fi
  if [ -f go.mod ]; then
    go build ./... || return 1
    go test ./... || return 1
    return 0
  fi
  if [ -f Cargo.toml ]; then
    cargo build --quiet || return 1
    cargo test --quiet || return 1
    return 0
  fi
  # .NET: any csproj in the top two levels.
  if find . -maxdepth 2 -name '*.csproj' 2>/dev/null | grep -q .; then
    dotnet build --nologo -v q || return 1
    return 0
  fi
  # Shell-first project (this framework's own case): syntax-check the tree.
  # Round-3 review P1 (live-reproduced): `.claude/*` MUST be excluded — every
  # scaffolded project carries .claude/statusline.sh, which made this branch
  # fire for ALL scaffolds and shadowed the deeper-manifest NO-OP notice
  # (false GATE PASS while a subdir app's failing tests never ran).
  if find . -maxdepth 2 -name '*.sh' -not -path '*/.git/*' -not -path './.claude/*' -not -path '*/node_modules/*' 2>/dev/null | grep -q .; then
    local rc=0
    while IFS= read -r f; do
      bash -n "$f" || rc=1
    done < <(find . -name '*.sh' -not -path '*/.git/*' -not -path './.claude/*' -not -path '*/node_modules/*' 2>/dev/null)
    return "$rc"
  fi
  # No recognised stack at the ROOT: the gate cannot claim truth — pass
  # openly but say so ON THE OUTPUT LINE. Round-2 review: run_gate's
  # stdout+stderr are redirected into the log, so a warning printed here
  # never reaches the orchestrator — set GATE_NOOP_NOTE instead (run_gate
  # executes in the current shell, so the variable survives) and the final
  # PASS line carries it.
  deeper=$(find . -mindepth 2 -maxdepth 3 \
      \( -name package.json -o -name pyproject.toml -o -name go.mod -o -name Cargo.toml -o -name '*.csproj' \) \
      -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -n 1)
  if [ -n "$deeper" ]; then
    GATE_NOOP_NOTE="NO-OP: no root stack manifest but $deeper exists below — root-only dispatch cannot gate subdir apps; add .claude/integration-gate.local.sh. This pass proves NOTHING."
  else
    GATE_NOOP_NOTE="NO-OP: no recognised stack manifest — add .claude/integration-gate.local.sh for a real gate. This pass proves NOTHING."
  fi
  return 0
}

GATE_NOOP_NOTE=""
if run_gate > "$log" 2>&1; then
  if [ -n "$GATE_NOOP_NOTE" ]; then
    echo "GATE PASS ($GATE_NOOP_NOTE)"
  else
    echo "GATE PASS ($(wc -l < "$log" 2>/dev/null || echo 0) log lines: $log)"
  fi
  exit 0
else
  rc=$?
  # The one permitted detail: the log's last non-empty line, as a hint.
  hint=$(grep -v '^[[:space:]]*$' "$log" 2>/dev/null | tail -n 1 | head -c 200)
  echo "GATE FAIL (exit $rc) — ${hint:-see log} — full log: $log"
  exit 1
fi
