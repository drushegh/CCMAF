#!/usr/bin/env bats
# Drift guard for the shared shell helpers run_tmo and kv_file_get.
#
# The canonical copy of each lives in plugins/ccmaf/hooks/lib/hook-common.sh
# (and its v1 twin .claude/hooks/lib/hook-common.sh). Scripts source that
# library when they can; scripts that must also run standalone keep an inline
# fallback between `# >>> <name>` / `# <<< <name>` markers. This file
# enforces that every marked copy is byte-identical to the canonical one, and
# that no script defines either helper outside such a marked block.

load helpers

CANON="$FW_REPO_ROOT/plugins/ccmaf/hooks/lib/hook-common.sh"
V1_LIB="$FW_REPO_ROOT/.claude/hooks/lib/hook-common.sh"

setup() {
  [ -f "$CANON" ] || skip "plugins/ccmaf not present (consumer checkout)"
}

# _block <file> <name> — print the marked block (markers excluded).
_block() {
  awk -v n="$2" '$0 == "# >>> " n {f=1; next} $0 == "# <<< " n {f=0} f' "$1"
}

# Every .sh under the framework + plugin trees that defines the helper.
_definers() {
  grep -rlE "^$1\(\) \{" "$FW_REPO_ROOT/plugins" "$FW_REPO_ROOT/.claude/hooks" \
    "$FW_REPO_ROOT/.claude/framework" --include='*.sh' 2>/dev/null | sort
}

_check_helper() {
  local name="$1" canon f n=0
  canon="$(_block "$CANON" "$name")"
  [ -n "$canon" ] || { echo "no canonical $name block in $CANON" >&2; return 1; }
  [ "$(_block "$V1_LIB" "$name")" = "$canon" ] \
    || { echo "$name differs in $V1_LIB" >&2; return 1; }
  while IFS= read -r f; do
    n=$((n + 1))
    [ "$(grep -cE "^$name\(\) \{" "$f")" -eq 1 ] \
      || { echo "$f defines $name more than once" >&2; return 1; }
    [ "$(_block "$f" "$name")" = "$canon" ] \
      || { echo "$f: $name copy is missing its markers or has drifted from $CANON" >&2; return 1; }
  done < <(_definers "$name")
  [ "$n" -ge 3 ] || { echo "expected several $name copies, found $n" >&2; return 1; }
}

@test "shared helpers: every run_tmo copy is byte-identical to hook-common.sh" {
  _check_helper run_tmo
}

@test "shared helpers: every kv_file_get copy is byte-identical to hook-common.sh" {
  _check_helper kv_file_get
}

@test "shared helpers: kv_file_get never executes the file and strips comments / quotes" {
  local f="$BATS_TEST_TMPDIR/kv"
  cat > "$f" <<'EOF'
SKILLS_UPSTREAM_URL=git@github.com:you/your-skills.git   # OPTIONAL comment
SKILLS_SELECTED="python-development rust-development"    # space-separated
SQ='a # b'  # c
export EXP=val
touch PWNED
CMD=$(touch PWNED2)
EOF
  # shellcheck source=/dev/null
  . "$CANON"
  cd "$BATS_TEST_TMPDIR"
  [ "$(kv_file_get "$f" SKILLS_UPSTREAM_URL)" = "git@github.com:you/your-skills.git" ]
  [ "$(kv_file_get "$f" SKILLS_SELECTED)" = "python-development rust-development" ]
  [ "$(kv_file_get "$f" SQ)" = "a # b" ]
  [ "$(kv_file_get "$f" EXP)" = "val" ]
  [ "$(kv_file_get "$f" CMD)" = '$(touch PWNED2)' ]
  run kv_file_get "$f" MISSING
  [ "$status" -eq 1 ]
  [ ! -e "$BATS_TEST_TMPDIR/PWNED" ]
  [ ! -e "$BATS_TEST_TMPDIR/PWNED2" ]
}
