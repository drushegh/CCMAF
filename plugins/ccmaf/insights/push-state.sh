#!/usr/bin/env bash
# push-state.sh — canonical one-line push state, computed from git
# (TASK-040). Fleet sweep (harveyTest): hand-written "push state" prose
# in STATUS.md goes stale the moment anything is committed — so derive
# it, don't write it. /wrapup includes this line in its final verdict;
# STATUS.md should reference it instead of carrying a prose copy.
#
# Output (one line, always exit 0):
#   push-state: branch <name> | <N> ahead / <M> behind origin/<name> | <K> uncommitted change(s)
#   push-state: branch <name> | no upstream configured | <K> uncommitted change(s)
#   push-state: not a git repository
#
# Read-only; no network (uses the local remote-tracking ref — run
# `git fetch` first if you need remote-fresh numbers).

set -uo pipefail

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "push-state: not a git repository"
  exit 0
fi

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "detached")
uncommitted=$(git status --porcelain 2>/dev/null | grep -c . || true)

if upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null); then
  ahead=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo "?")
  behind=$(git rev-list --count 'HEAD..@{u}' 2>/dev/null || echo "?")
  echo "push-state: branch $branch | $ahead ahead / $behind behind $upstream | $uncommitted uncommitted change(s)"
else
  echo "push-state: branch $branch | no upstream configured | $uncommitted uncommitted change(s)"
fi
exit 0
