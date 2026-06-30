#!/usr/bin/env bash
# config-security.sh — audit the agent harness's OWN config surface.
#
# Distinct from /security (which scans PROJECT code for SAST/secrets/SCA)
# and from doctor.sh (which checks config INTEGRITY — do referenced files
# exist). This auditor asks: "is the harness configuration itself a
# security risk?" — prompt-injection vectors, over-broad permissions,
# shell-injection in hook scripts, risky MCP servers, and tampered
# instruction files.
#
# Inspired by ECC's "AgentShield" (github.com/affaan-m/ECC), re-scoped to
# our framework's surface and house style. Deterministic, no network, no
# subagents — safe to run in CI.
#
# Surfaces scanned:
#   1. settings.json — permission breadth + secret-deny baseline
#   2. hooks (.claude/hooks/*.{sh,py}) — shell-injection, curl|bash, eval
#   3. agent prompts (.claude/agents/**/*.md) — tool-scope creep
#   4. MCP configs (.mcp.json / settings mcpServers) — auto-install, risky cmds
#   5. CLAUDE.md / CLAUDE.framework.md — instruction-override / hidden-char traps
#
# Usage:
#   bash .claude/framework/audit/config-security.sh [--format text|json]
#
# Exit codes (CI-friendly build gate, matching the /security convention):
#   0 — no CRITICAL findings (WARNING/INFO may be present)
#   2 — at least one CRITICAL finding
#   1 — fatal script error (missing dependency, unreadable root)

set -euo pipefail

FORMAT="text"
while [ $# -gt 0 ]; do
  case "$1" in
    --format) FORMAT="${2:-text}"; shift 2 ;;
    --format=*) FORMAT="${1#*=}"; shift ;;
    -h|--help) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "config-security: unknown arg '$1'" >&2; exit 1 ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

SETTINGS=".claude/settings.json"
HAS_JQ=$(command -v jq >/dev/null 2>&1 && echo 1 || echo 0)

# --- Finding collection ----------------------------------------------
# Each element: "SEVERITY|SURFACE|LOCATION|MESSAGE".
findings=()
add() { findings+=("$1|$2|$3|$4"); }

# ---------------------------------------------------------------------
# Surface 1 — settings.json permission breadth + secret-deny baseline
# ---------------------------------------------------------------------
audit_settings() {
  if [ ! -f "$SETTINGS" ]; then
    add "WARNING" "settings" "$SETTINGS" "No settings.json — permission allow/deny model is absent; the harness runs with defaults. Restore it from the framework baseline."
    return
  fi
  if [ "$HAS_JQ" = "0" ]; then
    add "INFO" "settings" "$SETTINGS" "jq missing — cannot introspect permissions. Install jq for full settings.json audit."
    return
  fi
  if ! jq -e . "$SETTINGS" >/dev/null 2>&1; then
    add "CRITICAL" "settings" "$SETTINGS" "settings.json is not valid JSON — Claude Code will ignore it, dropping ALL permission guards and hook registrations. Fix the syntax."
    return
  fi

  # Over-broad allow entries. A bare unconstrained "Bash" is the framework
  # default and acceptable; but wildcards like "Bash(*)" or "Bash(:*)" that
  # purport to constrain while allowing everything are worth surfacing.
  local allow
  allow=$(jq -r '.permissions.allow // [] | .[]' "$SETTINGS" 2>/dev/null || true)
  while IFS= read -r entry; do
    entry="${entry%$'\r'}"
    [ -z "$entry" ] && continue
    case "$entry" in
      *'(*)'|*'(:*)'|*'(**)'*)
        add "WARNING" "settings" "$SETTINGS" "Permission allow entry \`$entry\` looks like a catch-all wildcard — it grants the tool unconstrained. If you meant to constrain it, use a real pattern; if you meant 'allow all', a bare \`${entry%%(*}\` is clearer."
        ;;
    esac
  done <<<"$allow"

  # Secret-deny baseline. The framework ships deny rules for env/ssh/aws/
  # secret/credential reads+writes. Missing coverage is a real exposure.
  # Use bash substring matching (case-folded) rather than piping to grep —
  # `grep -F` from a pipe segfaults under MSYS/Git-Bash on some inputs.
  local deny_lc
  deny_lc=$(jq -r '.permissions.deny // [] | join(" ")' "$SETTINGS" 2>/dev/null | tr '[:upper:]' '[:lower:]' || true)
  local need=(".env" ".ssh" ".aws" "secret" "credential")
  local label=("dotenv files" "SSH keys" "AWS creds" "*secret* files" "*credential* files")
  local i=0
  for token in "${need[@]}"; do
    case "$deny_lc" in
      *"$token"*) : ;;
      *) add "WARNING" "settings" "$SETTINGS" "permissions.deny has no rule mentioning \`$token\` — ${label[$i]} are not blocked from Read/Edit/Write. Add the framework baseline deny entries (see settings.json template)." ;;
    esac
    i=$((i + 1))
  done
}

# ---------------------------------------------------------------------
# Surface 2 — hook scripts: shell-injection + remote-code execution
# ---------------------------------------------------------------------
audit_hooks() {
  [ -d ".claude/hooks" ] || [ -d ".claude/skills" ] || return 0
  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    local rel="${f#./}"

    # curl|bash / wget|sh — downloading and executing remote content.
    if grep -nE '(curl|wget)[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(bash|sh)\b' "$f" >/dev/null 2>&1; then
      local ln
      ln=$(grep -nE '(curl|wget)[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(bash|sh)\b' "$f" | head -1 | cut -d: -f1)
      add "CRITICAL" "hooks" "$rel:$ln" "Hook pipes downloaded content straight into a shell (\`curl … | bash\`). A compromised endpoint = arbitrary code execution on every trigger. Vendor the script or pin+verify a checksum instead."
    fi

    # eval of tool input — command injection from model-controlled data.
    if grep -nE '\beval\b' "$f" >/dev/null 2>&1; then
      local ln
      ln=$(grep -nE '\beval\b' "$f" | head -1 | cut -d: -f1)
      add "WARNING" "hooks" "$rel:$ln" "Hook uses \`eval\` — if any tool-input field reaches it, this is a command-injection vector. Prefer arrays/explicit dispatch over eval."
    fi

    # Unquoted shell expansion of a value parsed from tool_input. The
    # value is model-controlled (file paths, commands); using it unquoted
    # in a command position risks word-splitting / injection.
    # Heuristic: a var assigned from `jq ... .tool_input...` later used as
    # $var (unquoted) on a line that also invokes a command.
    if grep -qE '=\$\(.*jq.*tool_input' "$f" 2>/dev/null; then
      # Pull the variable names sourced from tool_input.
      local v
      while IFS= read -r v; do
        [ -z "$v" ] && continue
        # Unquoted use: `$v` not inside double quotes, on a line that isn't
        # the assignment itself and isn't a `[ ... ]` test or a comment.
        if grep -nE "[^\"_A-Za-z0-9]\\\$$v([^\"_A-Za-z0-9]|$)" "$f" \
             | grep -vE '(^[0-9]+:[[:space:]]*#|jq |\[ |\[\[ )' \
             | grep -vE "\"\\\$$v\"" >/dev/null 2>&1; then
          local ln
          ln=$(grep -nE "[^\"_A-Za-z0-9]\\\$$v([^\"_A-Za-z0-9]|$)" "$f" | grep -vE '(jq |^[0-9]+:[[:space:]]*#)' | head -1 | cut -d: -f1)
          add "WARNING" "hooks" "$rel:${ln:-?}" "Variable \`\$$v\` is parsed from model-controlled tool_input and appears to be used unquoted. Quote it (\"\$$v\") to avoid word-splitting / injection on adversarial paths or commands."
        fi
      done < <(grep -oE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=\$\(.*jq.*tool_input' "$f" | sed -E 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=.*/\1/' | sort -u)
    fi
  done < <(find .claude/hooks .claude/skills -maxdepth 3 -type f \( -name '*.sh' -o -name '*.py' \) 2>/dev/null | sort)
}

# ---------------------------------------------------------------------
# Surface 3 — agent prompts: tool-scope creep
# ---------------------------------------------------------------------
# An agent described as read-only / review-only that nonetheless grants
# write/execute tools is a privilege-escalation risk: a prompt-injected
# task could make a "reviewer" modify files or run commands.
audit_agents() {
  [ -d ".claude/agents" ] || return 0
  local f
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    local rel="${f#./}"

    # Extract the frontmatter `tools:` line (first 15 lines).
    local tools_line
    tools_line=$(head -15 "$f" | grep -iE '^tools:' | head -1 || true)
    [ -z "$tools_line" ] && continue

    # Does the agent grant mutating tools? (Bash counts as exec but NOT
    # write — read-only agents commonly run inspection commands, so Bash
    # alone is not flagged as a write-capability mismatch.)
    local grants_write=0 grants_exec=0
    echo "$tools_line" | grep -qiE '(\bWrite\b|\bEdit\b|\bMultiEdit\b|\bNotebookEdit\b|\*)' && grants_write=1
    echo "$tools_line" | grep -qiE '(\bBash\b|\*)' && grants_exec=1
    [ "$grants_write" = "0" ] && [ "$grants_exec" = "0" ] && continue

    # Does the agent EXPLICITLY declare itself read-only / non-mutating?
    # Tightened to high-signal phrases only — "never writes PRODUCTION
    # code" (architect) or a mention of the word "reviewer" must NOT match,
    # since those agents legitimately write plans/contracts/tests.
    local desc
    desc=$(head -15 "$f" | grep -iE '^(description|name):' | tr '[:upper:]' '[:lower:]' || true)
    if echo "$desc" | grep -qE '(read-only|returns? (structured )?findings only|never modifies (files|code)|does not (modify|change) (files|code)|never modifies them)'; then
      if [ "$grants_write" = "1" ]; then
        add "WARNING" "agents" "$rel" "Agent explicitly presents as read-only but its \`tools:\` grants file-write capability (\`$(echo "$tools_line" | sed 's/^[Tt]ools:[[:space:]]*//')\`). A prompt-injected task could make it mutate files. Drop Write/Edit to match the stated role."
      elif [ "$grants_exec" = "1" ]; then
        add "INFO" "agents" "$rel" "Agent presents as read-only and has no Write/Edit, but does grant Bash — confirm its commands are inspection-only (Bash can still write files via redirection)."
      fi
    fi

    # Wildcard tool grant on any non-orchestrator agent is worth noting.
    if echo "$tools_line" | grep -qE '(^|[[:space:],])\*([[:space:],]|$)'; then
      case "$(basename "$f")" in
        claude.md|general-purpose.md) : ;;  # catch-all agents legitimately need *
        *) add "INFO" "agents" "$rel" "Agent grants the wildcard tool set (\`*\`). Confirm this agent genuinely needs every tool; most specialized agents should enumerate a minimal set." ;;
      esac
    fi
  done < <(find .claude/agents -type f -name '*.md' 2>/dev/null | sort)
}

# ---------------------------------------------------------------------
# Surface 4 — MCP server configs
# ---------------------------------------------------------------------
audit_mcp() {
  local mcp_files=()
  [ -f ".mcp.json" ] && mcp_files+=(".mcp.json")
  # mcpServers can also live inside settings.json.
  if [ "$HAS_JQ" = "1" ] && [ -f "$SETTINGS" ] && jq -e '.mcpServers' "$SETTINGS" >/dev/null 2>&1; then
    mcp_files+=("$SETTINGS")
  fi
  [ ${#mcp_files[@]} -eq 0 ] && return
  [ "$HAS_JQ" = "0" ] && { add "INFO" "mcp" ".mcp.json" "MCP config present but jq missing — cannot audit server definitions."; return; }

  local mf
  for mf in "${mcp_files[@]}"; do
    jq -e . "$mf" >/dev/null 2>&1 || { add "WARNING" "mcp" "$mf" "MCP config is not valid JSON — server definitions may be ignored."; continue; }
    # Iterate server name + command + args.
    while IFS= read -r srv; do
      [ -z "$srv" ] && continue
      local name cmd args
      name=$(echo "$srv" | jq -r '.key')
      cmd=$(echo "$srv" | jq -r '.value.command // empty')
      args=$(echo "$srv" | jq -r '.value.args // [] | join(" ")')

      # Auto-install at launch: `npx -y` / `uvx` / `bunx` fetch+run latest.
      if echo "$cmd $args" | grep -qE '(npx[[:space:]]+(-y|--yes)|uvx|bunx)'; then
        add "WARNING" "mcp" "$mf::$name" "MCP server \`$name\` auto-installs and runs a package at launch (\`$cmd $args\`). Unpinned auto-install is a supply-chain risk — pin an exact version and review the package."
      fi
      # Piped shell execution in a server command.
      if echo "$cmd $args" | grep -qE '\|[[:space:]]*(bash|sh)\b|curl|wget'; then
        add "CRITICAL" "mcp" "$mf::$name" "MCP server \`$name\` command fetches or pipes content into a shell. Treat as remote code execution on every session start. Replace with a vetted, locally-installed binary."
      fi
    done < <(jq -c '(.mcpServers // {}) | to_entries[]' "$mf" 2>/dev/null)
  done
}

# ---------------------------------------------------------------------
# Surface 5 — instruction files: override traps + hidden characters
# ---------------------------------------------------------------------
audit_instructions() {
  local files=()
  [ -f "CLAUDE.md" ] && files+=("CLAUDE.md")
  [ -f "CLAUDE.framework.md" ] && files+=("CLAUDE.framework.md")
  # Any AGENTS.md / .cursorrules that may also steer the agent.
  while IFS= read -r f; do files+=("${f#./}"); done < <(find . -maxdepth 2 -name 'AGENTS.md' 2>/dev/null)
  [ ${#files[@]} -eq 0 ] && return

  local f
  for f in "${files[@]}"; do
    [ -f "$f" ] || continue
    # Classic prompt-injection override phrasing.
    if grep -niE 'ignore (all |the |your )?(previous|prior|above) (instructions|prompts|rules)|disregard (the |your )?(system|previous)' "$f" >/dev/null 2>&1; then
      local ln
      ln=$(grep -niE 'ignore (all |the |your )?(previous|prior|above) (instructions|prompts|rules)|disregard (the |your )?(system|previous)' "$f" | head -1 | cut -d: -f1)
      add "CRITICAL" "instructions" "$f:$ln" "Instruction file contains override phrasing (\"ignore previous instructions\"-style). If unintended, this is a prompt-injection payload — remove it. If intentional documentation of the pattern, move it into a fenced code block so it can't be read as a live directive."
    fi
    # Zero-width / bidi control characters (hidden-instruction smuggling).
    # Byte-level UTF-8 match under LC_ALL=C instead of grep -P: PCRE grep
    # is absent on BSD/macOS AND git-bash, so the old -P probe was silently
    # dead on both (DA-C8). Ranges: U+200B-200F (e2 80 8b-8f), U+202A-202E
    # (e2 80 aa-ae), U+2060-2064 (e2 81 a0-a4). U+FEFF (ef bb bf) is only
    # checked PAST byte 3 so a legitimate leading UTF-8 BOM (common from
    # Windows editors) doesn't false-fire.
    if LC_ALL=C grep -qE $'\xe2\x80[\x8b-\x8f\xaa-\xae]|\xe2\x81[\xa0-\xa4]' "$f" 2>/dev/null \
       || tail -c +4 "$f" 2>/dev/null | LC_ALL=C grep -q $'\xef\xbb\xbf' 2>/dev/null; then
      add "CRITICAL" "instructions" "$f" "Instruction file contains zero-width or bidirectional control characters — a known vector for smuggling hidden instructions past human review. Inspect with a hex viewer (e.g. \`od -c\`) and strip them."
    fi
  done
}

# --- Run all surfaces -------------------------------------------------
audit_settings
audit_hooks
audit_agents
audit_mcp
audit_instructions

# --- Tally ------------------------------------------------------------
crit=0; warn=0; info=0
for f in "${findings[@]:-}"; do
  [ -z "$f" ] && continue
  case "${f%%|*}" in
    CRITICAL) crit=$((crit + 1)) ;;
    WARNING)  warn=$((warn + 1)) ;;
    INFO)     info=$((info + 1)) ;;
  esac
done

now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# --- Emit -------------------------------------------------------------
if [ "$FORMAT" = "json" ]; then
  if [ "$HAS_JQ" = "1" ]; then
    printf '%s\n' "${findings[@]:-}" | jq -R 'select(length>0) | split("|") | {severity:.[0],surface:.[1],location:.[2],message:.[3]}' \
      | jq -s "{scanned_at:\"$now_iso\",summary:{critical:$crit,warning:$warn,info:$info},findings:.}"
  else
    echo "{\"error\":\"jq required for --format json\"}"
  fi
else
  echo "config-security: harness config audit @ $now_iso"
  echo "  $crit CRITICAL, $warn WARNING, $info INFO"
  if [ "$((crit + warn + info))" -gt 0 ]; then
    echo
    for sev in CRITICAL WARNING INFO; do
      for f in "${findings[@]:-}"; do
        [ -z "$f" ] && continue
        [ "${f%%|*}" = "$sev" ] || continue
        rest="${f#*|}"; surface="${rest%%|*}"
        rest="${rest#*|}"; loc="${rest%%|*}"; msg="${rest#*|}"
        echo "  [$sev] ($surface) $loc"
        echo "         $msg"
      done
    done
  else
    echo "  clean — no harness-config security findings."
  fi
fi

[ "$crit" -gt 0 ] && exit 2
exit 0
