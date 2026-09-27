# Framework Update System

Lets a downstream project track its upstream framework version and pull
updates on demand. Invoked from the cold start sequence in
[CLAUDE.framework.md](../../../CLAUDE.framework.md) (step 1).

## How it works

Each project has a `.claude/.framework-version` file recording the
upstream URL, branch, and pinned SHA. Cold start runs
[check-updates.sh](check-updates.sh), which resolves the latest SHA
from upstream and — if framework-owned paths changed since the pinned
SHA — writes `.claude/.framework-update-available.md` summarising what
changed. (A v2 "drop" release on a project that has not run
`migrate-v2.sh` is reported as a one-line notice instead: `apply-update.sh`
would refuse it.)

Claude reads that flag file and asks the user (via AskUserQuestion)
whether to update. If yes, it runs [apply-update.sh](apply-update.sh),
which fetches upstream and overwrites only the paths listed in
[framework-manifest.txt](framework-manifest.txt). Project state files
(TASKS.md, STATUS.md, ECOSYSTEM.md, CLAUDE.md, etc.) are never touched.

## Files

| File | Role |
| --- | --- |
| `framework-manifest.txt` | Authoritative list of framework-owned paths. Only these are overwritten on update. |
| `check-updates.sh` | Compares pinned SHA to upstream. Writes the flag file if behind. Silent when up-to-date. Throttled (default 24h). |
| `apply-update.sh` | Fetches upstream, mirrors manifest paths, updates `.framework-version`. Refuses to run if any framework path (including any path new-in-this-update) has uncommitted state (modified OR untracked), or if the project isn't a git repo (override: `--no-git`). Lists what will change and asks for confirmation before touching anything (`--yes`/`-y` to skip, for automation). |
| `init-framework-version.sh` | Bootstraps `.claude/.framework-version` for a new project and gitignores the framework's ephemeral files. Run once per project. Flags: `--url`, `--branch`, `--interval`, `--subdir`, `--force` (`--help` for details). |
| `merge-hook-registrations.sh` | Called by `apply-update.sh`: adds framework hook registrations that are new in the update to the consumer's `.claude/settings.json` (a registration the consumer deliberately removed is not re-added), and warns about stale ones. Needs `jq`; without it the merge is skipped and the doctor flags unregistered hooks. |
| `migrate-layout.sh` | One-time consumer migration from the pre-restructure `00_framework/` layout. Idempotent. |
| `migrate-v2.sh` | One-shot v1 → v2 crossover: retires the bundled v1 copies (listed in `retired-paths.txt`) once the `ccmaf-kernel` + `ccmaf` plugins are verified active, and commits the migration as one revertible commit. `--dry-run` shows the plan. |
| `skills-sync.sh` | Selectively syncs language/topic skills from a SEPARATE skills repo into `.claude/skills/` per `.claude/.skills-version` (`SKILLS_SELECTED`). `--suggest` prints stack-detected skill suggestions. Dirs not selected are never touched; apply-update never touches skills at all. See `contract:skills-sync`. |
| `skills-check.sh` | Cold-start check: is the project's pinned skills SHA behind the skills upstream? Writes `.claude/.skills-update-available.md` if so (lists selected skills + the sync command). Silent if not opted in. Same throttle + DA-C4 flag discipline as `check-updates.sh`. |

## First-time setup (per project)

```bash
bash .claude/framework/update/init-framework-version.sh
# Optional: override defaults
bash .claude/framework/update/init-framework-version.sh \
  --url https://github.com/OWNER/REPO.git --branch main --interval 24
```

This creates `.claude/.framework-version` (commit it) and adds the
framework's ephemeral files (`.claude/.framework-update-available.md`,
the doctor/insight flag files, staging dirs, telemetry, …) to `.gitignore`.

## Day-to-day (automatic)

Just let cold start do its thing. If there's an update, you'll see an
AskUserQuestion prompt listing the new commits. Choose *yes* to apply,
*no* to skip until the next check.

## Manual override

```bash
# Force an immediate check, ignoring throttle:
#   (edit FRAMEWORK_LAST_CHECKED in .claude/.framework-version to a past
#    date, or just run apply-update.sh directly)

# Apply without cold start (prompts for confirmation; --yes to skip):
bash .claude/framework/update/apply-update.sh
bash .claude/framework/update/apply-update.sh --yes

# Skip the pending update for this session:
rm .claude/.framework-update-available.md
```

## Safety model

- **Only manifest paths are touched.** Anything not listed in
  `framework-manifest.txt` is never read or written by the update scripts.
  Adding a new framework-owned file? Add it to the manifest in the same
  commit.
- **Refuses to clobber uncommitted state.** For every path the update
  will touch (the manifest, plus any path new in this update),
  `apply-update.sh` checks `git diff HEAD` (modified), `git diff --cached`
  (staged) and `git ls-files --others --exclude-standard` (untracked). If
  any reports content, the script bails out and tells you to commit,
  stash, or clean first. The explicit untracked listing guards new files
  — a blind spot that `git diff` alone would miss. (Plumbing rather than
  `git status --porcelain`, which reports CRLF-normalisation noise as
  modifications on Windows.)
- **Directory paths mirror upstream.** Deletions upstream propagate
  (e.g., a removed agent disappears from your project too). Combined
  with the safety check, local-only files in a manifest directory are
  only ever removed after you've committed them — so recovery via
  `git reflog` or `git show` is always available.
- **Network failure is non-fatal.** If the upstream is unreachable,
  `check-updates.sh` exits quietly with code 3 and cold start continues.
- **Requires git, unless overridden.** Without git there's no dirty-check,
  no rollback, and no recovery path — `apply-update.sh` refuses to run
  unless you pass `--no-git` and accept that risk explicitly.
- **Asks before it mutates.** `apply-update.sh` lists every path it's
  about to touch and prompts for confirmation before Phase 1 starts.
  `migrate-layout.sh` shows the staged diff and prompts before it
  commits; a decline leaves the complete migration staged and uncommitted,
  and `--stage-only` requests exactly that outcome up front. Both scripts
  accept `--yes`/`-y` for unattended/automated runs, and refuse
  non-interactive runs without an explicit flag before touching anything.

## When NOT to use this system

If you've forked the framework and are maintaining it as a divergent
branch, don't use the update system — it assumes upstream is
authoritative. Use regular git merging instead, and move any
project-specific changes out of manifest paths.

## Dependencies

- **All scripts:** `git`, `bash`, `date`, `awk`, `mktemp`, `sed`, `grep`.
  `date`/`awk`/`mktemp`/`sed`/`grep` ship with every Linux distro, macOS,
  and Git for Windows. `git` is not part of a stock macOS install — it
  comes with the Xcode Command Line Tools (`xcode-select --install`) or
  Homebrew.
- **`apply-update.sh` needs bash 4+** (associative arrays). macOS ships
  bash 3.2: `brew install bash`, then run it with that bash. The script
  refuses up front on bash 3.x. `check-updates.sh` runs on bash 3.2.
- **Optional:** `jq` — `merge-hook-registrations.sh` needs it to register
  new framework hooks during `apply-update.sh`; without it that step is
  skipped with a notice (the doctor flags unregistered hooks).
- **`migrate-v2.sh` only:** a working Python 3 (for the settings.json
  rewrite) and the `claude` CLI (to verify the plugin floor).
- No `gh` or `curl` required.
