#!/usr/bin/env bash
# verify-turn.sh — prove a Fable consultation turn actually ran on claude-fable-5.
#
# Ground truth for any MODEL-OVERRIDDEN subagent is the PER-MESSAGE transcript field
# `.message.model` — NOT the model's self-report (only proves the START of a turn) and
# NOT a grep over the file (the conversation discusses model ids in its CONTENT, which
# false-fails a naive grep as "mixed models"). We histogram `.message.model` with jq.
#
# Usage: verify-turn.sh <topic> <nonce> [response-file]
#   <topic>        workbench topic dir under _fable/ (or _probe for the availability probe)
#   <nonce>        unique token embedded in this turn's spawn prompt AND echoed in its response
#   response-file  optional; defaults to the newest _fable/<topic>/turns/*-response.md
#
# Env:
#   FABLE_MODEL              required model id (default: claude-fable-5)
#   FABLE_TRANSCRIPT_GLOB    override the subagent-transcript search glob if your harness
#                            stores them somewhere other than the default below
#
# Exit 0 = PASS (every assistant message was FABLE_MODEL, and the response carries the
# nonce). Exit 1 = FAIL (wrong/mixed model, missing transcript, or missing nonce).
set -euo pipefail

FABLE_MODEL="${FABLE_MODEL:-claude-fable-5}"

die() { printf 'verify-turn: FAIL — %s\n' "$1" >&2; exit 1; }

[ "$#" -ge 2 ] || die "usage: verify-turn.sh <topic> <nonce> [response-file]"
topic="$1"
nonce="$2"
resp="${3:-}"

command -v jq >/dev/null 2>&1 || die "jq not found (required to read .message.model)"

wb="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # the _fable/ workbench root
topic_dir="$wb/$topic"
[ -d "$topic_dir" ] || die "no such topic dir: $topic_dir"

# 1) Locate this turn's response file. Files are zero-padded NNN-response.md, so the
#    newest is the lexical max of the glob — no `ls` parsing needed.
if [ -z "$resp" ]; then
  shopt -s nullglob
  _turns=( "$topic_dir"/turns/*-response.md )
  shopt -u nullglob
  [ "${#_turns[@]}" -gt 0 ] || die "no response file under $topic_dir/turns/"
  resp="$(printf '%s\n' "${_turns[@]}" | sort | tail -1)"
fi
[ -n "$resp" ] && [ -f "$resp" ] || die "no response file: $resp"

# 2) The response must carry THIS turn's nonce (proves it's this turn, not a stale file).
grep -qF -- "$nonce" "$resp" || die "response $resp does not echo nonce '$nonce'"

# 3) Find the subagent transcript for this turn BY the nonce (it appears in the spawn
#    prompt, which the transcript records), newest first. Override the search root with
#    FABLE_TRANSCRIPT_GLOB if your harness layout differs.
default_glob="$HOME/.claude/projects/*/*/subagents/*.jsonl"
glob="${FABLE_TRANSCRIPT_GLOB:-$default_glob}"

# Newest transcript that contains the nonce. Portable newest-by-mtime via bash `-nt`
# (no `ls` parsing); with a unique nonce there is normally exactly one match anyway.
transcript=""
# shellcheck disable=SC2086  # deliberate word-splitting: $glob is a shell glob to expand
while IFS= read -r _f; do
  [ -f "$_f" ] || continue
  if [ -z "$transcript" ] || [ "$_f" -nt "$transcript" ]; then transcript="$_f"; fi
done < <(grep -lF -- "$nonce" $glob 2>/dev/null || true)
[ -n "$transcript" ] || die "no subagent transcript containing nonce '$nonce' under: $glob (set FABLE_TRANSCRIPT_GLOB if your layout differs)"

# 4) Histogram the per-message model over assistant records.
models="$(jq -r 'select(.type=="assistant") | .message.model // empty' "$transcript" | sort | uniq -c || true)"
[ -n "$models" ] || die "no assistant records with a .message.model in $transcript"

# PASS iff the ONLY model seen is FABLE_MODEL.
other="$(printf '%s\n' "$models" | awk -v m="$FABLE_MODEL" 'NF && $2 != m {print}')"
if [ -n "$other" ]; then
  printf 'verify-turn: FAIL — %s shows non-%s model(s):\n%s\n' "$transcript" "$FABLE_MODEL" "$models" >&2
  exit 1
fi

printf 'verify-turn: PASS — %s ran wholly on %s\n  response:   %s\n  transcript: %s\n' \
  "$topic" "$FABLE_MODEL" "$resp" "$transcript"
