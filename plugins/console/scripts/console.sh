#!/usr/bin/env bash
# console.sh — thin wrapper around this plugin's scripts/console.mjs (the
# cross-platform Node driver).
#
# Prefer `node "${CLAUDE_PLUGIN_ROOT}/scripts/console.mjs" <verb>` directly (it's
# shell-agnostic — PowerShell, cmd, bash). This wrapper exists for bash
# muscle-memory. All logic — resolving the installed `ccmaf-console` npm package
# (CONSOLE_DIR dev checkout -> global bin -> npx fallback), resolving the project
# root (--root / CLAUDE_PROJECT_DIR / git toplevel), and driving the Console's
# launcher — lives in console.mjs; see its header for env vars and behaviour.
#
# Note: on Windows, `bash` from PowerShell may resolve to WSL (different SSH
# config / /mnt paths). If unattended, invoke console.mjs via node instead.
exec node "$(dirname "${BASH_SOURCE[0]}")/console.mjs" "$@"
