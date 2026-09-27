#!/usr/bin/env bash
# console.sh — thin wrapper around tools/console.mjs (the cross-platform Node launcher).
#
# Prefer `node tools/console.mjs` directly (it's shell-agnostic — PowerShell, cmd, bash).
# This wrapper exists for bash muscle-memory. All logic — resolving the installed
# `ccmaf-console` npm package (CONSOLE_DIR dev checkout -> global bin -> npx fallback,
# version spec from .claude/.console-version) and driving the Console's launcher verb
# (start/stop/open/restart) for THIS board — lives in console.mjs; see its header for
# env vars and behaviour.
#
# Note: on Windows, `bash` from PowerShell may resolve to WSL (different SSH config /
# /mnt paths). If unattended, invoke `node tools/console.mjs` instead.
exec node "$(dirname "${BASH_SOURCE[0]}")/console.mjs" "$@"
