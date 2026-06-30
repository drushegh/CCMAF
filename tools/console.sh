#!/usr/bin/env bash
# console.sh — thin wrapper around tools/console.mjs (the cross-platform Node launcher).
#
# Prefer `node tools/console.mjs` directly (it's shell-agnostic — PowerShell, cmd, bash).
# This wrapper exists for bash muscle-memory. All logic — GitHub clone-URL resolution
# (SSH-alias-first, HTTPS fallback), the project-local cache, build, and launch against
# THIS board — lives in console.mjs; see its header for env vars and behaviour.
#
# Note: on Windows, `bash` from PowerShell may resolve to WSL (different SSH config /
# /mnt paths). If unattended, invoke `node tools/console.mjs` instead.
exec node "$(dirname "${BASH_SOURCE[0]}")/console.mjs" "$@"
