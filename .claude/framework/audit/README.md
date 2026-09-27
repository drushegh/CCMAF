# Framework Audit Tools

Advisory scanners that formalise the "grep the whole repo for this
pattern class" discipline documented in GOTCHAS.md. Called on-demand
or from `/healthcheck`.

## Available tools

### `pattern-scan.sh`

Scans framework-owned shell scripts for known anti-patterns. Each
pattern represents a bug class that has bitten us at least once and
is documented in `GOTCHAS.md`.

**Run:**

```bash
bash .claude/framework/audit/pattern-scan.sh
```

Always exits 0. Prints findings to stdout with a summary count.

**Current patterns checked:**

| Check | Pattern | GOTCHAS ref | Fix |
| ----- | ------- | ----------- | --- |
| `check_crlf_strip` | `while IFS= read -r <var>` reading from a FILE (not process substitution or heredoc) without a `<var>="${<var>%$'\r'}"` strip in the next 3 lines | "CRLF breaks `while IFS= read -r line` loops" | Add the strip on the line after the while |
| `check_grep_c_fallback` | `$(...grep -c... \|\| echo "0")` | "`grep -c` with `\|\| echo 0` produces `0\n0`" | Drop the fallback — `grep -c` already prints 0 on no match |

### `config-security.sh`

Audits the agent harness's OWN configuration surface for security risk —
distinct from `/security` (which scans project code: SAST, secrets, SCA)
and from `doctor.sh` (which checks config *integrity*). Deterministic, no
network, no subagents; safe to run in CI.

Surfaces scanned: `settings.json` permission breadth + secret-deny
baseline; hook scripts (`.claude/hooks/*.{sh,py}`) for shell injection,
`curl | bash` and `eval`; agent prompts (`.claude/agents/**/*.md`) for
tool-scope creep; MCP configs (`.mcp.json` / settings `mcpServers`); and
`CLAUDE.md` / `CLAUDE.framework.md` for instruction-override and
hidden-character traps.

**Run:**

```bash
bash .claude/framework/audit/config-security.sh [--format text|json]
```

Unlike `pattern-scan.sh`, this one is a build gate: exit `0` = no
CRITICAL findings (WARNING/INFO may be present), `2` = at least one
CRITICAL finding, `1` = fatal script error.

## Adding a new pattern

When a recurring bug class warrants a check:

1. Add a fresh `check_<name>` function in `pattern-scan.sh` following
   the existing pattern (use `_sh_files`, `_report`, `_print_header`).
2. Call it from `main` in the same order you want it reported.
3. Update this README's pattern table.
4. Add or cross-reference the corresponding `GOTCHAS.md` entry so the
   rationale survives the check definition.

The discipline: scan the WHOLE repo for the pattern, not just new code
— past latent instances count as bugs as soon as the pattern is added.

## Scope + exclusions

- `pattern-scan.sh` scans `.sh` files under `.claude/hooks/`,
  `.claude/framework/` and `.claude/skills/` (the plugin copy scans
  `${CLAUDE_PLUGIN_ROOT}`, `.claude/hooks/` and `.claude/skills/` when
  `CLAUDE_PLUGIN_ROOT` is set).
- Excludes `.claude/framework/audit/pattern-scan.sh` itself — the script's
  own regex literals would otherwise match as findings. If you edit
  the script and suspect a pattern bug inside it, test by running
  manually with a renamed copy.

## Why this exists

From `FRAMEWORK-SUGGESTIONS.md` 2026-04-18 entry "Audit discipline":
a CRLF pattern-class sweep would have caught 4 latent bugs in the
update system that shipped before we noticed them. Same story for
the `grep -c \|\| echo "0"` pattern — documented after the first
occurrence, then the same pattern showed up in a second script. A
cheap per-pattern scan prevents both classes of repeat offender.
