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
# Usage: merge-hook-registrations.sh <consumer-settings.json> <canonical-settings.json>
# Prints one summary line to stderr; exit 0 always (advisory, never blocks update).

set -u
CONSUMER="${1:-}"
CANON="${2:-}"

[ -n "$CONSUMER" ] && [ -n "$CANON" ] || { echo "merge-hook-registrations: usage: <consumer-settings> <canonical-settings>" >&2; exit 0; }
[ -f "$CONSUMER" ] && [ -f "$CANON" ] || exit 0
command -v jq >/dev/null 2>&1 || {
  echo "merge-hook-registrations: jq not found — skipping; register new framework hooks manually (doctor will flag them)." >&2
  exit 0
}

# Validate both are JSON before touching anything.
jq -e . "$CONSUMER" >/dev/null 2>&1 || { echo "merge-hook-registrations: $CONSUMER is not valid JSON — skipping." >&2; exit 0; }
jq -e . "$CANON"    >/dev/null 2>&1 || { echo "merge-hook-registrations: canonical settings not valid JSON — skipping." >&2; exit 0; }

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
      if ( [ (.hooks[$t.ev] // [])[] | (.hooks // [])[] | .command ] | index($t.cmd) ) != null
      then .                                              # already registered → skip
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
tmp="$(mktemp)"
printf '%s\n' "$merged" > "$tmp" && mv "$tmp" "$CONSUMER" || { rm -f "$tmp"; echo "merge-hook-registrations: write failed — settings unchanged." >&2; exit 0; }
echo "merge-hook-registrations: registered $added new framework hook(s) in $CONSUMER (additive; permissions + your own hooks untouched)."
exit 0
