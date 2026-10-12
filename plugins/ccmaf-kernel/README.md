# ccmaf-kernel — CCMAF Tier 0

The smallest useful slice of [CCMAF](https://github.com/drushegh/CCMAF),
packaged as a Claude Code plugin so **no per-project files are ever needed**.
Install once per machine; every repo gets:

- **A safety floor** — the framework's dangerous-command guard as a blocking
  PreToolUse hook on the Bash, PowerShell and Monitor tools. It blocks
  commands aimed at a protected location — a filesystem or drive root, your
  home directory or anything above it (`/home`, `/Users`, `C:\Users`), a core
  system directory at the root (`/etc`, `/usr`, `/bin`, `/sbin`, `/lib`,
  `/lib64`, `/var`, `/boot`, `/opt`, macOS `/System`, `/Library`,
  `/Applications`, `/private`, `C:\Windows`, `C:\Program Files*`,
  `C:\ProgramData`), or a whole block device — by recursive delete, move,
  recursive chmod/chown/ACL rewrite, raw disk write or filesystem format;
  plus fork bombs. It also judges strings re-run through `eval`, `bash -c`,
  `pwsh -Command` and `cmd /c`. It deliberately does NOT judge git
  (`push --force`, `reset --hard`, `clean -fdx`) or deletes of deeper or
  project paths (`rm -rf build`, `/usr/local/src/app`) — opt-in wave mode,
  below, is the one git exception. Heuristic
  defence in depth, not a security boundary.
- **Opt-in wave mode** (off by default) — for parallel build waves that share
  one working tree. Set `CCMAF_WAVE_GUARD=1` (for one project: its
  `.claude/settings.json` → `"env": {"CCMAF_WAVE_GUARD": "1"}`). While more
  than one `/ccmaf:build` dispatch marker
  (`.claude/telemetry/.task-dispatch.<ID>`, younger than 2 days) is armed,
  `scripts/wave-guard.sh` (chained from the guard wrapper only when the flag
  is set) blocks a subset of the git commands that sweep the shared tree:
  `git stash` (except `list`/`show`), `git checkout -- <paths>` /
  `git checkout .`, `git restore` (except `--staged`-only), `git reset
  --hard`, `git clean` (except `-n`), `git add -A` / `--all` / `-u` / `.`,
  and `git commit -a` / `--all`. Heredoc bodies are not screened. With zero
  or one marker armed it does nothing; a block it should not have made
  usually means stale `.claude/telemetry/.task-dispatch.*` markers. It applies to every
  caller (it cannot tell a worker from the orchestrator) and screens only
  `;`/`&&`/`||`/`|`-separated segments that start with `git`; git run
  inside `bash -c` or a script is not seen. Defence in depth, not a
  boundary.
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

Update later — refresh the marketplace catalogue, then update the plugin
itself (`marketplace update` alone only refreshes the catalogue), then
restart Claude Code to load the new version:

```bash
claude plugin marketplace update ccmaf
claude plugin update ccmaf-kernel@ccmaf
```

## Behaviour in full-CCMAF projects

In a project scaffolded with the full framework (marked by
`.claude/.framework-version`), the kernel **self-defers**: context injection
and the budget counter become silent no-ops (the framework's own instruction
set and lifecycle hooks take over), while the guard stays live.

- **v2 projects** (`FRAMEWORK_LINE=v2` — the `ccmaf` core plugin): this
  plugin is the **sole** owner of the dangerous-command guard; core ships no
  guard of its own and only monitors this one (its SessionStart
  interpreter check). The kernel also warns at session start if the core
  plugin shows no recent activity.
- **Legacy v1 projects** (the framework's hooks vendored into
  `.claude/hooks/` and registered in `.claude/settings.json`): the project
  registers its own byte-identical copy, so the guard runs twice. That never
  changes the blocking decision (both copies see the same input), but each
  screened command pays the guard's subprocess cost twice and bash-guard
  telemetry totals count every command double.

Per-project opt-out, if you ever need one: add
`"enabledPlugins": {"ccmaf-kernel@ccmaf": false}` to that project's
`.claude/settings.json` — the key must be marketplace-qualified
(`plugin-name@marketplace-name`); a bare `"ccmaf-kernel"` is silently
ignored. The interactive equivalent is `/plugin disable ccmaf-kernel@ccmaf`.
In a v2 project this removes the **only** dangerous-command guard, so do it
deliberately.

## Maintenance invariants

- `scripts/block-dangerous-commands.py` is a **byte-identical copy** of the
  framework's `.claude/hooks/block-dangerous-commands.py`, enforced by
  `kernel_plugin.bats`. Edit the canonical, then re-copy — never edit here.
- `KERNEL.md` is the canonical Tier 0 prose (the design rationale lives in
  the dev repo's `docs/tiering/`).
- The guard honours `CLAUDE_DISABLED_HOOKS=block-dangerous` exactly like the
  framework registration does.
