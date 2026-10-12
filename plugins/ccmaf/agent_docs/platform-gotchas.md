# Platform gotchas — Claude Code, Windows, toolchain

Consolidated from the gotchas consumer projects keep logging about the
platform underneath the framework: the Claude Code harness, the `claude`
CLI, Windows, shells, git/gh and plugin authoring. It covers platform
behaviour only; framework behaviour lives in the command runbooks and your
project's `.claude/GOTCHAS.md`.

Format: **symptom** → cause → fix. Entries marked **(verify)** rest on one
project's report or an unconfirmed cause, so re-check them on your setup
before relying on them. Harness behaviour shifts between Claude Code
releases; when an entry stops matching what you see, trust what you see and
log it.

## Claude Code harness and subagents

- **Worktree-isolated agents commit to `main` anyway.** `isolation: "worktree"`
  is best-effort: the Bash tool's cwd can fall back to the main checkout. Make
  `pwd && git branch --show-current` the agent's first action and prefix every
  git/build call with `cd "<worktree>" && …`.
- **A fresh worktree has no `node_modules` (or venv, build cache).** Gates fail or
  need a long install. Install in the worktree, or junction the main
  checkout's `node_modules` (`New-Item -ItemType Junction`). Junctioned
  worktrees can break Playwright visual gates. **(verify)**
- **Worktree branches start from `origin/main`, not your local HEAD.** Unpushed
  local commits are missing in the worktree. Push first, or have the agent
  branch from the commit you name. **(verify)**
- **Worktree isolation fails silently at about 30 worktrees (Windows).** The agent
  gets an empty `agentId` and a `WorktreeIsolationError` can kill the run. For
  big fan-outs, create worktrees yourself (`git worktree add`) and prune the
  finished ones between waves. **(verify)**
- **Workflow resume re-runs finished worktree agents.** `resumeFromRunId` does not
  replay worktree-isolated agents from cache, so agents that already merged
  run again. Don't resume a workflow whose agents mutate `main`; start fresh
  from the finished branches. **(verify)**
- **Running subagents act on an owner message meant for the orchestrator.** A
  message sent mid-run can reach running subagents, and many will drop their
  task to follow it. Put a line in every brief: messages unrelated to your
  task are for the orchestrator; ignore them. Verify outcomes afterwards.
- **Subagent tool calls don't reach PostToolUse hooks in some harness modes.**
  Headless runs deliver them; the interactive desktop does not. Meter
  dispatches by the Agent result's tool-use count, and never promise a worker
  that a hook will nag it (workers then report nags they never got).
- **Bash tool cwd silently resets to the repo root.** Gates then fail with
  spurious errors (`document is not defined`, "no files matching", the wrong
  `tsc`). Prefix every package-scoped command with `cd <pkg> && …`.
- **Background servers die mid-session.** Servers started with
  `run_in_background: true` can be reaped (exit 127, probes return 000). A
  detached subshell, `( cmd > log 2>&1 & )`, survived a full session.
  **(verify)**
- **The auto-mode classifier blocks an edit you just approved.** It doesn't treat an
  AskUserQuestion answer as a scope grant, and it can apply a subagent's
  constraints to the main session. Re-approve through the permission prompt;
  report it upstream. **(verify)**

## claude CLI facts

- **`--output-format=stream-json` fails with `--print`.** Exit 1, "requires
  --verbose". Add `--verbose`.
- **`CLAUDE_SETTINGS_PATH` does nothing.** Per-session overrides are CLI flags:
  use `--settings <path>`. Check `claude --help` before wiring an env var.
- **A `claude -p` child spawned from inside a session saves no transcript.** It
  inherits `CLAUDECODE` / `CLAUDE_CODE_*` identity variables and runs as a
  nested child. Strip them (`env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT
  -u CLAUDE_CODE_SESSION_ID -u CLAUDE_CODE_CHILD_SESSION …`) or set
  `CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1`. Dump the child's env first when
  debugging.
- **A `claude -p` child picks up the project's CLAUDE.md.** With cwd inside the
  repo it loads the root CLAUDE.md and its imports, which contaminates evals
  and second opinions. Clean room: run from a `mktemp -d` cwd and pass
  `--mcp-config` by absolute path. Probe with "quote any project instructions
  you were given, else NONE". `CLAUDE_CODE_SIMPLE=1` forces API-key auth.
- **Project transcript directory slug.** `~/.claude/projects/<slug>/`: every
  character outside `[A-Za-z0-9]` becomes `-`, case kept, no collapsing
  (`F:\Git\my_app` → `F--Git-my-app`). The drive-letter case can differ on
  Windows, so match case-insensitively. Long-path truncation is unverified.
- **Subagent transcripts live in a second file.** The parent
  `<sessionId>.jsonl` holds the spawn and the result (`toolUseResult.agentId`,
  camelCase). Each subagent writes `<sessionId>/subagents/agent-<agentId>.jsonl`
  (`isSidechain: true`, per-turn `message.model` and `message.usage`). Hook
  JSON uses snake_case `agent_id`; `SubagentStop` carries
  `agent_transcript_path`. Verify models with `jq` on `.message.model`.
- **Session ids.** `claude --resume X` keeps writing to transcript X. A
  pre-assigned `--session-id` exists before any transcript does, so check the
  file exists before treating an id as resumable.
- **`claude plugin list --available --json` is about 2 MB.** It overflows capped
  captures. Read `<installLocation>/.claude-plugin/marketplace.json` instead.
- **On Windows, `claude` resolves to npm's extensionless shim.** PATH search that
  ignores PATHEXT (some PTY libraries) picks the POSIX shim: `os error 193`.
  Resolve `claude.cmd` explicitly, and reject shell metacharacters in args
  because `cmd.exe` re-parses argv for `.cmd` files.
- **The TUI reprints its banner on every resize.** It sizes its first frame to
  the PTY's spawn size. Spawn the PTY at the real size and debounce resizes
  (~150 ms). Only matters when embedding a terminal.

## Windows processes and ports

- **Killing a dev server leaves the port held.** Several causes, one shape:
  TaskStop on `npm run dev` orphans the vite child; a child spawned with
  `shell: true` survives `child.kill()` (only `cmd.exe` dies); `taskkill /T`
  can't reach grandchildren once the root has exited. Kill the tree while the
  root is alive: `taskkill /pid <pid> /T /F`. For orphans, find the PID with
  `Get-CimInstance Win32_Process` (or `netstat -ano`) and `Stop-Process`. For
  tooling you write, a Job Object with `KILL_ON_JOB_CLOSE` is the robust fix.
- **`listen EACCES` on a port nothing is using.** WinNAT/Hyper-V reserves random
  TCP ranges at boot. Check `netsh interface ipv4 show excludedportrange
  protocol=tcp`; pick a port outside the ranges, or reserve yours with
  `netsh int ipv4 add excludedportrange protocol=tcp startport=<p>
  numberofports=1 store=persistent` (admin). `net stop winnat` frees them
  until reboot.
- **A CLI works in PowerShell but "command not found" in the Bash tool.** `.cmd`
  shims (`pac`, some npm globals) and tools on a PowerShell-only PATH
  (`cargo` on some machines) are invisible to Git Bash. Run them through the
  PowerShell tool, or call `cmd //c tool.cmd`. Agents that can't run a
  generator start hand-editing its output, so check toolchain parity across
  shells at setup.
- **`EXDEV` when a build writes output to another drive.** `rename()` can't
  cross drives (repo on F:, `%TEMP%` on C:). Keep build and temp output on the
  project's drive, e.g. under `node_modules/.cache/`.
- **`mv` fails with "Permission denied" on a directory.** A running dev server or
  file watcher holds a lock on it. Stop the server, or retry.

## Shell and encoding

- **Escape sequences land as raw bytes.** `\0`, `\x1b`, `\u2028` typed through
  Edit, a heredoc or a Python literal can arrive as real NUL/ESC/U+2028 bytes.
  NUL makes git treat the file as binary; a raw U+2028 breaks a JS regex
  ("Unterminated regular expression"). Write such files with the Write tool,
  then grep for control and non-ASCII bytes before committing.
- **A heredoc with an apostrophe in the body fails** ("unexpected EOF while looking
  for matching quote") in the Bash tool. Use the Write tool, or keep single
  quotes out of heredoc bodies. **(verify)**
- **Backslashes halve in heredoc'd scripts.** Doubled backslashes in a Python
  script written via a Bash-tool heredoc reach Python as single ones. Write the
  script with the Write tool and run it as a file. **(verify)**
- **Git Bash rewrites leading-slash arguments.** MSYS path conversion turns
  `/api/x` into `C:/Program Files/Git/api/x` and mangles `/mnt/...` paths
  passed to `wsl.exe`. Set `MSYS_NO_PATHCONV=1`, or pipe the script via stdin.
- **`$false` vanishes inside `powershell -Command "…"`.** Bash expands `$false`,
  `$_` and every `$var` in a double-quoted string before PowerShell sees it,
  so the command mis-parses silently. Escape (`\$false`), single-quote the
  command, or use `powershell -File script.ps1`.
- **Windows Python crashes printing non-ASCII.** The console codepage is cp1252:
  `UnicodeEncodeError: 'charmap'`. Set `PYTHONUTF8=1` (or
  `PYTHONIOENCODING=utf-8`), or keep console output ASCII.
- **`subprocess.run(text=True)` mis-decodes output.** It uses the locale codepage,
  not UTF-8. Pass `encoding="utf-8"`.
- **Files vanish between Git Bash and Python.** Git Bash's `/tmp` is not native
  Windows Python's `/tmp`. Hand files over via repo-relative or scratchpad
  paths.
- **`python3` exists but hangs or exits 49.** The Microsoft Store alias resolves
  on PATH and does nothing useful. Probe by running it (`"$p" -c 'import sys'`)
  and fall back to `python`.
- **`core.autocrlf=true` causes CRLF drift.** Generated files check out as CRLF
  and byte-compare tests fail (fresh clones and worktrees especially; `git
  diff` hides it). Anything that hashes or packages file bytes gives
  machine-specific results. `sed -i` in Git Bash can flip tracked files to CRLF
  mid-session; the tell is `warning: CRLF will be replaced by LF`. Pin
  generated and shipped files with `text eol=lf` in `.gitattributes`, and
  LF-normalise before hashing.
- **`read` keeps the `\r` from CRLF input.** winget's jq emits CRLF. `$()` strips
  it, but `while IFS= read -r` and `read < <(jq …)` do not. Strip with
  `${line%$'\r'}`.
- **gawk can turn a CRLF file into LF on Git Bash.** Depending on the mount mode
  and build, MSYS gawk drops the CR on read, so an awk rewrite that "keeps every
  line" comes out LF. Pass `awk -v BINMODE=3` (other awks ignore it) and check
  the round trip under Git Bash: `grep -c $'\r$' f` equals `wc -l < f`.
- **Editing a running bash script corrupts it.** bash reads by byte offset, so
  you get "syntax error near unexpected token". Don't edit a script, or a file
  it sources, while it runs.

## git and gh with several accounts

- **gh API calls 404 on a repo git can push to.** An SSH host alias authenticates
  git only; `gh` uses its own active account. Use
  `GH_TOKEN=<token> gh … -R owner/repo` per call. `gh auth switch` changes the
  global account for every terminal.
- **`gh repo create` has no per-call account flag.** Same fix: `GH_TOKEN` for the
  one call, or switch and switch back.
- **Clones fail with `Permission denied (publickey)`.** On a multi-account machine
  plain `git@github.com:` picks the wrong key. Use the SSH host alias from
  `~/.ssh/config` (`git@github.com-<alias>:owner/repo`) and probe with
  `git ls-remote` first.
- **Commit messages with quotes get mangled.** PowerShell here-strings break on
  embedded quotes. Write the message to a file and `git commit -F <file>`.
- **`git commit -- <path>` rejects new files.** The explicit-path form fails with
  "pathspec did not match any file(s) known to git" for an untracked path. Use
  `git add -- <paths> && git commit -m "…" -- <paths>`.

## Plugin authoring

- **Files beside the plugin disappear after install.** Marketplace installs copy
  only the plugin's own directory into `~/.claude/plugins/cache/…`; a script
  reading `../shared` finds nothing. Component paths that resolve outside the
  plugin root are rejected outright. Keep shared data inside each plugin and
  resolve it via `${CLAUDE_PLUGIN_ROOT}`. (Docs: plugins/loading.)
- **A command in a `commands/` subdirectory doesn't answer to its bare name.** It
  is discovered, but each subdirectory adds a namespace segment: plugin
  `commands/db/migrate.md` → `/<plugin>:db:migrate`; project
  `.claude/commands/frontend/component.md` → `/frontend:component`, not
  `/component`. An unmatched slash command falls through as plain text, so it
  looks like nothing happened. Keep command files flat unless you want the
  prefix. (Checked against the Claude Code skills and plugin-components docs,
  2026-10-12.)
- **Hook `matcher` matches the tool name only**, not the file path. Filter by
  path inside the hook body. On Windows VS Code, register hooks as
  `bash -c '…'` with `$CLAUDE_PROJECT_DIR` paths.

## Miscellaneous

- **A large MCP result can't be read back.** Results over ~25k tokens are saved
  to a file the Read tool also refuses. Parse the saved JSON with a script and
  write an answer-only file you read in chunks.
- **VS Code's extension hangs during idle periods.** A long background poll left
  armed across idle time is the suspected cause. Use a scheduled wake or a
  bounded poll with a timeout. **(verify)**
- **WebFetch on a binary reports "binary/corrupted".** It still saves the raw
  bytes. Look for `[Binary content (...) also saved to <path>]` at the end,
  then `gunzip` / `tar -x` that file.
- **Obsidian aborts with `EACCES` on Windows symlinks.** It `lstat`s every file
  before exclusions apply, so cloned skill repos (`CLAUDE.md -> AGENTS.md`)
  break the vault. Don't open a folder containing skill clones as a vault.
  **(verify)**
- **`settings.json` edits blocked as self-modification.** Use the built-in
  `update-config` skill; it is the supported way to change settings,
  permissions, hooks and env vars.
