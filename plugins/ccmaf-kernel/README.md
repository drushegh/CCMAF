# ccmaf-kernel — CCMAF Tier 0

The smallest useful slice of [CCMAF](https://github.com/drushegh/CCMAF),
packaged as a Claude Code plugin so **no per-project files are ever needed**.
Install once per machine; every repo gets:

- **A safety floor** — the framework's dangerous-command guard as a blocking
  PreToolUse hook (recursive deletes of roots/home, raw disk writes,
  filesystem formats, fork bombs).
- **A spend bound** — a PostToolUse tool-call counter that reminds the model
  at 30/60/120+ calls to stop and report if the stated done-check isn't green.
- **The kernel discipline** — injected at session start ([KERNEL.md](KERNEL.md)):
  state a command-checkable definition of done, work surgically, verify
  before referencing, end with a five-line receipt.

## Install (once per machine)

```bash
claude plugin marketplace add drushegh/CCMAF
claude plugin install ccmaf-kernel@ccmaf --scope user
```

Update later with `claude plugin marketplace update ccmaf`.

## Behaviour in full-CCMAF projects

In a project scaffolded with the full framework (marked by
`.claude/.framework-version`), the kernel **self-defers**: context injection
and the budget counter become silent no-ops (the framework's own instruction
set and lifecycle hooks take over), while the guard stays live — it is
byte-identical to the framework's own, and double-running it never changes
the blocking decision (both copies see the same input). The double run is
not free, though: each Bash command pays the guard's subprocess cost twice,
and bash-guard telemetry totals count every command double.

Per-project opt-out, if you ever need one: add
`"enabledPlugins": {"ccmaf-kernel@ccmaf": false}` to that project's
`.claude/settings.json` — the key must be marketplace-qualified
(`plugin-name@marketplace-name`); a bare `"ccmaf-kernel"` is silently
ignored. The interactive equivalent is `/plugin disable ccmaf-kernel@ccmaf`.

## Maintenance invariants

- `scripts/block-dangerous-commands.py` is a **byte-identical copy** of the
  framework's `.claude/hooks/block-dangerous-commands.py`, enforced by
  `kernel_plugin.bats`. Edit the canonical, then re-copy — never edit here.
- `KERNEL.md` is the canonical Tier 0 prose (the design rationale lives in
  the dev repo's `docs/tiering/`).
- The guard honours `CLAUDE_DISABLED_HOOKS=block-dangerous` exactly like the
  framework registration does.
