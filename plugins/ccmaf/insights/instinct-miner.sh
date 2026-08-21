#!/usr/bin/env bash
# instinct-miner.sh — mine the session transcript for repeated user
# corrections and PROPOSE candidate GOTCHAS / FRAMEWORK-SUGGESTIONS
# entries for human approval.
#
# Inspired by ECC's continuous-learning-v2 "instinct" mining, re-scoped
# to our human-in-the-loop, file-based capture model: this NEVER writes
# to GOTCHAS.md or FRAMEWORK-SUGGESTIONS.md. It only writes a candidates
# flag file (.claude/.instinct-candidates.md). The /wrapup runbook and
# cold start surface it via AskUserQuestion (approve / edit / dismiss);
# the human decides what becomes a real entry and where it goes.
#
# What it looks for: user turns that read like corrections or standing
# directives — "actually …", "no, don't …", "always/never …", "instead",
# "stop doing …", "that's wrong". These are the moments the framework
# could have prevented a wrong turn. Repeated ones (higher seen-count =
# higher confidence) are the strongest signal.
#
# Transcript resolution (first hit wins):
#   1. --transcript <file>
#   2. $CLAUDE_TRANSCRIPT_FILE (a .jsonl file) or $CLAUDE_TRANSCRIPT_DIR (a dir)
#   3. Auto-discover: newest *.jsonl under ~/.claude/projects/<dir matching
#      this repo's basename>/  (robust, platform-independent — matches on
#      the repo folder name, not a mangled absolute path).
#
# Transcript JSONL schema (characterised 2026-06-12 against live Claude Code
# transcripts, 5 files across versions — TASK-033 AC0). One JSON object per
# line; top-level .type is one of: user / assistant / attachment /
# last-prompt / file-history-snapshot / queue-operation. Only "user" entries
# matter here, and they come in FOUR flavours:
#   a. Tool results — the overwhelming majority (682/712 sampled). Marked by
#      a top-level "toolUseResult" key; .message.content[] items are
#      {type:"tool_result"}. Never human-typed.
#   b. Harness meta turns — "isMeta": true. Hook feedback ("Stop hook
#      feedback: ..."), slash-command/skill EXPANSIONS (the full runbook
#      text of /wrapup, /healthcheck etc. — these are loaded with
#      "always/never/don't" phrasing and were the 33/34 noise source this
#      task exists to kill). Content may be a string OR an array.
#   c. Sidechain turns — "isSidechain": true on every entry of a subagent
#      transcript (stored under <session>/subagents/). Their "user" turns
#      are orchestrator prompts, not the human.
#   d. Genuine human turns — none of the above markers; content is an array
#      of {type:"text"} items (a plain string in older entries). Even here,
#      individual text items can be harness-INJECTED context rather than
#      typed text: "<ide_opened_file>...", "<ide_selection>...",
#      "<system-reminder>..." blocks, "<command-name>..." (legacy command
#      echo). Tag-prefixed items are dropped; <system-reminder> ranges and
#      fenced ``` blocks (pasted file/log content) are stripped line-wise.
# NOT usable as a discriminator: "promptSource" ("sdk") — only stamped by
# newer Claude Code versions; 16/26 sampled genuine human turns lack it.
#
# Config:
#   INSTINCT_MIN_SIGNALS (default 3) — suppress the whole report below this
#                                      many total correction signals.
#   INSTINCT_MIN_CONFIDENCE (default 1) — drop candidates seen fewer than N times.
#
# Exit codes: always 0 (advisory). Prints a one-line summary on stdout.
# Requires: jq.

set -euo pipefail

# Bash 4+ guard (DA-C8): mapfile below needs bash 4; stock macOS ships 3.2.
# Advisory script → fail open with a clear message.
if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  echo "instinct-miner: bash >= 4 required (found ${BASH_VERSION:-unknown}) — skipping. On macOS: brew install bash." >&2
  exit 0
fi

TRANSCRIPT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --transcript) TRANSCRIPT="${2:-}"; shift 2 ;;
    --transcript=*) TRANSCRIPT="${1#*=}"; shift ;;
    -h|--help) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "instinct-miner: unknown arg '$1'" >&2; exit 0 ;;
  esac
done

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

if ! command -v jq >/dev/null 2>&1; then
  echo "instinct-miner: jq required — skipping."
  exit 0
fi

# State files live at .claude/ (root); framework-self redirect retired (TASK-054).
STATE_PREFIX=".claude/"
GOTCHAS_PATH="${STATE_PREFIX}GOTCHAS.md"
SUGGESTIONS_PATH="${STATE_PREFIX}FRAMEWORK-SUGGESTIONS.md"

# --- Resolve transcript ----------------------------------------------
if [ -z "$TRANSCRIPT" ]; then
  if [ -n "${CLAUDE_TRANSCRIPT_FILE:-}" ] && [ -f "${CLAUDE_TRANSCRIPT_FILE}" ]; then
    TRANSCRIPT="$CLAUDE_TRANSCRIPT_FILE"
  else
    search_dir="${CLAUDE_TRANSCRIPT_DIR:-}"
    if [ -z "$search_dir" ]; then
      repo_base="$(basename "$REPO_ROOT")"
      projects="$HOME/.claude/projects"
      if [ -d "$projects" ]; then
        # Suffix-anchored match first (project dirs are mangled absolute
        # paths ending in the repo basename), then glob fallback. If the
        # glob is AMBIGUOUS, skip rather than guess — first-match picked
        # the wrong repo when basenames overlapped, e.g. myapp vs
        # myapp-v2, silently mining another project's transcript (DA-M7).
        search_dir="$(find "$projects" -maxdepth 1 -type d -name "*${repo_base}" 2>/dev/null | head -1)"
        if [ -z "$search_dir" ]; then
          matches="$(find "$projects" -maxdepth 1 -type d -name "*${repo_base}*" 2>/dev/null)"
          match_count=$(printf '%s\n' "$matches" | grep -c . || true)
          if [ "$match_count" -gt 1 ]; then
            echo "instinct-miner: ${match_count} project dirs match '*${repo_base}*' — ambiguous; refusing to guess." >&2
            echo "instinct-miner: pass --transcript <file> or set CLAUDE_TRANSCRIPT_DIR. Skipping." >&2
            exit 0
          fi
          search_dir="$matches"
        fi
      fi
    fi
    if [ -n "$search_dir" ] && [ -d "$search_dir" ]; then
      TRANSCRIPT="$(find "$search_dir" -maxdepth 1 -type f -name '*.jsonl' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
    fi
  fi
fi

if [ -z "$TRANSCRIPT" ] || [ ! -f "$TRANSCRIPT" ]; then
  echo "instinct-miner: no transcript found (pass --transcript <file> or set CLAUDE_TRANSCRIPT_DIR). Skipping."
  exit 0
fi

# --- Extract genuine human-typed text turns ---------------------------
# See "Transcript JSONL schema" in the header. Entry-level filters drop
# tool results (toolUseResult), harness meta turns (isMeta — hook feedback
# and slash-command expansions), and subagent sidechains (isSidechain).
# Item-level: only {type:"text"} items whose text doesn't START with a
# harness-injection tag. Line-level (awk): strip <system-reminder> ranges
# and fenced ``` blocks — pasted file/runbook content inside an otherwise
# genuine turn, the distinguishable part of quoted noise.
user_text="$(jq -r '
  select(.type=="user")
  | select(has("toolUseResult") | not)
  | select((.isMeta // false) | not)
  | select((.isSidechain // false) | not)
  | .message.content as $c
  | if ($c|type)=="string" then $c
    elif ($c|type)=="array" then
      ($c[]? | select(.type=="text") | .text
       | select(test("^<(ide_|system-reminder|command-name|command-message|command-args|local-command)") | not))
    else empty end
' "$TRANSCRIPT" 2>/dev/null \
  | awk '
      /<system-reminder>/ { sr=1 }
      sr { if (/<\/system-reminder>/) sr=0; next }
      /^```/ { fence = !fence; next }
      fence { next }
      { print }
    ' \
  | tr -d '\r' || true)"

if [ -z "$user_text" ]; then
  echo "instinct-miner: transcript had no parseable user text. Skipping."
  exit 0
fi

# --- Correction / directive signal patterns --------------------------
# Case-insensitive. Each is a moment where the user redirected the agent.
SIGNAL='(\bactually\b|\bno,|\bnope\b|\bdon'\''t\b|\bdo not\b|\binstead\b|\byou should\b|\byou must\b|\balways \b|\bnever \b|\bstop \b|that'\''s (wrong|not right|incorrect)|\bI (told|said|asked)\b|\bwhy did you\b|\bplease (don'\''t|stop)\b|\bnot what I\b)'

# Success / approval signals — moments an approach was CONFIRMED to work.
# These feed the dual-source distillation idea (ReasoningBank): the
# framework already learns from failures (corrections → GOTCHAS); this
# also surfaces what WORKED so a transferable strategy can be captured.
SUCCESS='(\bthat works\b|\bthat worked\b|\bworks now\b|\bworking now\b|\bperfect\b|\bexactly\b|that'\''s (it|right|perfect)|\blooks good\b|\blgtm\b|\bship it\b|nice,? (that|this|work)|great,? (that|this|now)|yes,? (that|exactly|perfect)|\bthat did it\b|\bthat fixed it\b)'

MIN_SIGNALS="${INSTINCT_MIN_SIGNALS:-3}"
MIN_SUCCESS="${INSTINCT_MIN_SUCCESS:-3}"
MIN_CONF="${INSTINCT_MIN_CONFIDENCE:-1}"
FLAG="$REPO_ROOT/.claude/.instinct-candidates.md"

# Always clear a stale flag — recompute fresh each run.
rm -f "$FLAG"

# collect_matches <regex> — filtered user-text lines matching the signal.
# Drops very short lines and lines that are pure markup/command echoes.
collect_matches() {
  printf '%s\n' "$user_text" \
    | grep -iE "$1" 2>/dev/null \
    | grep -vE '^\s*[`/]' \
    | awk '{ if (length($0) >= 12) print }' || true
}

# clusterize — stdin: matching lines; stdout: "count|snippet" lines at or
# above MIN_CONF, sorted by count desc. Normalize = lowercase, strip
# punctuation, collapse whitespace, first 14 words; identical normalized
# snippets aggregate into one candidate with a higher seen-count.
clusterize() {
  local normalized line cnt snippet
  normalized="$(tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9 ]+/ /g; s/[[:space:]]+/ /g; s/^ //; s/ $//' \
    | awk '{ n=(NF>14?14:NF); s=""; for(i=1;i<=n;i++) s=s $i " "; sub(/ $/,"",s); if (length(s)) print s }' \
    | sort | uniq -c | sort -rn)"
  while IFS= read -r line; do
    line="${line%$'\r'}"
    [ -z "$line" ] && continue
    cnt=$(printf '%s' "$line" | awk '{print $1}')
    snippet=$(printf '%s' "$line" | sed -E 's/^[[:space:]]*[0-9]+[[:space:]]+//')
    [ -z "$snippet" ] && continue
    [ "${cnt:-0}" -lt "$MIN_CONF" ] && continue
    printf '%s|%s\n' "$cnt" "$snippet"
  done <<<"$normalized"
}

corr_matches="$(collect_matches "$SIGNAL")"
succ_matches="$(collect_matches "$SUCCESS")"
corr_total=0; [ -n "$corr_matches" ] && corr_total=$(printf '%s\n' "$corr_matches" | grep -c . || true)
succ_total=0; [ -n "$succ_matches" ] && succ_total=$(printf '%s\n' "$succ_matches" | grep -c . || true)

corr_cands=(); succ_cands=()
if [ "$corr_total" -ge "$MIN_SIGNALS" ]; then
  mapfile -t corr_cands < <(printf '%s\n' "$corr_matches" | clusterize)
fi
if [ "$succ_total" -ge "$MIN_SUCCESS" ]; then
  mapfile -t succ_cands < <(printf '%s\n' "$succ_matches" | clusterize)
fi

if [ ${#corr_cands[@]} -eq 0 ] && [ ${#succ_cands[@]} -eq 0 ]; then
  echo "instinct-miner: ${corr_total} correction + ${succ_total} success signal(s); none cleared thresholds (corrections≥$MIN_SIGNALS, successes≥$MIN_SUCCESS) — nothing to propose."
  exit 0
fi

# emit_table — args: "<column-3 header>" then candidate entries on stdin.
emit_table() {
  local home_header="$1" c cnt snip snip_esc
  echo "| Seen | Candidate (normalized snippet) | $home_header |"
  echo "| ---- | ------------------------------ | $(printf '%0.s-' {1..14}) |"
  while IFS= read -r c; do
    [ -z "$c" ] && continue
    cnt="${c%%|*}"; snip="${c#*|}"; snip_esc="${snip//|/\\|}"
    echo "| $cnt | ${snip_esc} | |"
  done
}

# --- Write the candidates flag file ----------------------------------
now_iso=$(date -u +%Y-%m-%dT%H:%M:%SZ)
{
  echo "# Instinct Candidates — proposed for your approval"
  echo
  echo "**Mined:** $now_iso from \`${TRANSCRIPT##*/}\`"
  echo "**Signals:** $corr_total correction + $succ_total success moment(s);"
  echo "${#corr_cands[@]} correction + ${#succ_cands[@]} strategy candidate(s)."
  echo
  echo "**Proposals only** — nothing has been written to any state file."
  echo "\"Seen\" = how many turns matched this normalized phrasing (rough"
  echo "confidence). Higher = more likely a real standing instinct."

  if [ ${#corr_cands[@]} -gt 0 ]; then
    echo
    echo "## Corrections — what to avoid (learn from failure)"
    echo
    echo "Moments you redirected the agent. For each keeper, decide its home:"
    echo "- Recurring technical surprise / workaround → \`$GOTCHAS_PATH\`"
    echo "- The framework itself could have prevented it → \`$SUGGESTIONS_PATH\`"
    echo "- One-off, not generalisable → dismiss."
    echo
    printf '%s\n' "${corr_cands[@]}" | emit_table "Suggested home"
  fi

  if [ ${#succ_cands[@]} -gt 0 ]; then
    echo
    echo "## Strategies — what worked (learn from success)"
    echo
    echo "Moments an approach was confirmed to work. Capture only the"
    echo "**transferable** ones — a reusable \"when X, do Y\" pattern that would"
    echo "help a *future, different* task. Mind the boundary:"
    echo "- Transferable working pattern → \`$GOTCHAS_PATH\` (as a positive"
    echo "  pattern) or \`$SUGGESTIONS_PATH\` (if it implies a framework change)."
    echo "- A project-specific \"we chose X because Y\" → that's a **decision**,"
    echo "  it belongs in DECISIONS.md, NOT here."
    echo "- Not generalisable → dismiss."
    echo
    printf '%s\n' "${succ_cands[@]}" | emit_table "Capture as"
  fi

  echo
  echo "## How to act"
  echo
  echo "1. Read each candidate against your memory of the session."
  echo "2. For keepers, write a proper entry yourself (the snippet is just a"
  echo "   pointer — phrase the lesson/strategy, the why, and how to apply it)."
  echo "3. Delete this file when done: \`rm $FLAG\`."
  echo
  echo "_Heuristic miner — expect false positives. It surfaces moments worth"
  echo "a human glance, not finished lessons._"
} > "$FLAG"

echo "instinct-miner: ${#corr_cands[@]} correction + ${#succ_cands[@]} strategy candidate(s) → $FLAG"
exit 0
