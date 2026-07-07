#!/usr/bin/env bash
# merge-hook-registrations.sh — additively ensure framework hook registrations
# are present in a consumer's settings.json (FRAMEWORK-SUGGESTIONS 2026-06-29).
#
# WHY: settings.json is consumer-owned (permissions + the consumer's own hooks)
# and is therefore NOT in framework-manifest.txt — apply-update never overwrites
# it. So when the framework ADDS a hook, an existing consumer gets the hook FILE
# (manifest-carried) but NOT its registration → the hook silently never fires.
# (Surfaced shipping console-heartbeat, TASK-066/069.) This closes that gap with
# an ADDITIVE merge: every hook registration in the canonical settings.json that
# the consumer is missing is inserted into the consumer's settings.json, keyed by
# (event, matcher, command). It NEVER removes or rewrites existing entries, and
# never touches permissions / env / the consumer's own hooks.
#
# Source of truth = the canonical settings.json shipped in the update (DEC: no
# separate hooks-registry.json — the canonical settings IS the registry; zero
# drift). Idempotent: if nothing is missing the file is left byte-for-byte intact.
# Fail-soft: any gap (no jq, unreadable/!json input) → exit 0, change nothing; the
# doctor's "unregistered hook" check remains the backstop.
#
# RETIREMENT DETECTION (optional 3rd arg = the PINNED / previous canonical
# settings): the additive merge alone leaves a STALE registration behind when a
# framework hook's COMMAND changes (old cmd stays + new cmd added → the hook
# double-fires) or a hook is retired entirely. Given the pinned canonical, this
# script also WARNS about any command that the pinned framework shipped, the
# current framework no longer does, and the consumer still has registered — so
# the human can remove it. It never auto-removes (consumer settings are sacred;
# the additive-only, never-rewrite guarantee above still holds).
#
# Usage: merge-hook-registrations.sh <consumer-settings> <canonical-settings> [pinned-canonical-settings]
# Prints summary/advisory lines to stderr; exit 0 always (advisory, never blocks update).

set -u
CONSUMER="${1:-}"
CANON="${2:-}"
PINNED="${3:-}"   # optional — previous (pinned) canonical settings.json

[ -n "$CONSUMER" ] && [ -n "$CANON" ] || { echo "merge-hook-registrations: usage: <consumer-settings> <canonical-settings> [pinned-canonical]" >&2; exit 0; }
[ -f "$CONSUMER" ] && [ -f "$CANON" ] || exit 0
command -v jq >/dev/null 2>&1 || {
  echo "merge-hook-registrations: jq not found — skipping; register new framework hooks manually (doctor will flag them)." >&2
  exit 0
}

# Validate both are JSON before touching anything.
jq -e . "$CONSUMER" >/dev/null 2>&1 || { echo "merge-hook-registrations: $CONSUMER is not valid JSON — skipping." >&2; exit 0; }
jq -e . "$CANON"    >/dev/null 2>&1 || { echo "merge-hook-registrations: canonical settings not valid JSON — skipping." >&2; exit 0; }

# --- Retirement / command-change warning (needs the pinned canonical) -------
# Flat list of every registered hook command in a settings file (one per line).
_hook_cmds() { jq -r '[.hooks // {} | .[][]? | (.hooks // [])[] | .command] | .[]' "$1" 2>/dev/null; }
if [ -n "$PINNED" ] && [ -f "$PINNED" ] && jq -e . "$PINNED" >/dev/null 2>&1; then
  # Set membership via grep -Fx (fixed-string, whole-line) over REAL temp files.
  # NOT comm (collation-fragile) and NOT `grep -Fxf <(...)` — a native grep on
  # Git-Bash/MSYS cannot open a process-substitution /dev/fd/N as a pattern
  # file, silently reading zero patterns. Temp files are portable everywhere.
  _rt_pinned="$(mktemp)"; _rt_canon="$(mktemp)"; _rt_consumer="$(mktemp)"
  _hook_cmds "$PINNED"   > "$_rt_pinned"
  _hook_cmds "$CANON"    > "$_rt_canon"
  _hook_cmds "$CONSUMER" > "$_rt_consumer"
  # Commands the PINNED framework shipped that the CURRENT canonical no longer
  # ships (retired outright, or the command string was changed).
  retired="$(grep -Fxvf "$_rt_canon" "$_rt_pinned" 2>/dev/null || true)"
  if [ -n "$retired" ]; then
    # ...of those, the ones the consumer STILL has registered → stale double-fire.
    stale="$(printf '%s\n' "$retired" | grep -Fxf "$_rt_consumer" 2>/dev/null || true)"
    if [ -n "$stale" ]; then
      echo "merge-hook-registrations: ⚠ STALE framework hook registration(s) — shipped by your" >&2
      echo "  PINNED framework version, RETIRED or command-CHANGED by this update, still present" >&2
      echo "  in $CONSUMER (they will double-fire alongside the current registration):" >&2
      printf '%s\n' "$stale" | sed 's/^/    - /' >&2
      echo "  Remove each stale command from the hooks section of .claude/settings.json." >&2
      echo "  (This script never auto-edits existing entries; the doctor hook checks are the backstop.)" >&2
    fi
  fi
  rm -f "$_rt_pinned" "$_rt_canon" "$_rt_consumer"
fi

# The merge. Flatten the canonical hooks into (event, matcher, hook) tuples, then
# reduce them over the consumer settings: insert any tuple whose command is not
# already registered under that event, into a group with the matching matcher
# (creating the group when absent). jq preserves object key order, so untouched
# settings keep their layout; additions land at the end of the relevant arrays.
merged="$(jq --slurpfile fw "$CANON" '
  ($fw[0].hooks // {}) as $fwhooks
  | [ $fwhooks | to_entries[] as $e | $e.value[] as $g | $g.hooks[] as $h
      | {ev: $e.key, m: ($g.matcher // null), h: $h, cmd: $h.command} ] as $tuples
  | reduce $tuples[] as $t (
      .;
      # Matcher-aware dedup (audit minor c): "already registered" means the
      # command is present under a group with the SAME matcher, not just
      # present ANYWHERE under the event. The unqualified check used to
      # treat a command as covered no matter which matcher it was
      # registered under, so an upstream matcher change for an existing
      # hook command never propagated -- the old, differently-matchered
      # registration silently masked the new one. (This also brings the
      # code in line with the (event, matcher, command) key that the
      # header comment above has always documented.)
      if ( [ (.hooks[$t.ev] // [])[] | select((.matcher // null) == $t.m) | (.hooks // [])[] | .command ] | index($t.cmd) ) != null
      then .                                              # same matcher already has it → skip
      else
        .hooks = (.hooks // {})
        | .hooks[$t.ev] = (.hooks[$t.ev] // [])
        | ( .hooks[$t.ev] | map(.matcher // null) | index($t.m) ) as $gi
        | if $gi != null
          then .hooks[$t.ev][$gi].hooks = ((.hooks[$t.ev][$gi].hooks // []) + [$t.h])
          else .hooks[$t.ev] += [ (if $t.m == null then {hooks: [$t.h]} else {matcher: $t.m, hooks: [$t.h]} end) ]
          end
      end
    )
' "$CONSUMER" 2>/dev/null)" || { echo "merge-hook-registrations: jq merge failed — skipping (settings unchanged)." >&2; exit 0; }

[ -n "$merged" ] || { echo "merge-hook-registrations: empty merge result — skipping." >&2; exit 0; }

# Count additions = (registered hook commands after) − (before). Merge only adds.
_count() { jq '[.hooks // {} | .[][]? | (.hooks // [])[] | .command] | length' 2>/dev/null; }
before="$(_count < "$CONSUMER")"; before="${before:-0}"
after="$(printf '%s' "$merged" | _count)"; after="${after:-0}"
added=$(( after - before ))

if [ "$added" -le 0 ]; then
  echo "merge-hook-registrations: all framework hook registrations already present — no change."
  exit 0
fi

# Write only when something changed (preserve mtime + avoid churn on no-op runs).
# mktemp alongside the destination (audit minor a): mktemp's default
# (system temp — C: on Windows) plus `mv` to a project-drive file is a
# cross-filesystem copy+unlink, not an atomic rename — an interruption
# mid-copy can truncate settings.json. Same-directory mktemp keeps the
# final `mv` a same-filesystem rename. Portable full-path template (GNU + BSD);
# `mktemp -p` is GNU-only.
tmp="$(mktemp "$(dirname "$CONSUMER")/.settings.json.XXXXXX")"
printf '%s\n' "$merged" > "$tmp" && mv "$tmp" "$CONSUMER" || { rm -f "$tmp"; echo "merge-hook-registrations: write failed — settings unchanged." >&2; exit 0; }
echo "merge-hook-registrations: registered $added new framework hook(s) in $CONSUMER (additive; permissions + your own hooks untouched)."
exit 0
