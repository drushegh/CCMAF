# Framework Update System

Lets a downstream project track its upstream framework version and pull
updates on demand. Invoked from the cold start sequence in
[CLAUDE.framework.md](../../CLAUDE.framework.md) (step 1).

## How it works

Each project has a `.framework-version` file at its root recording the
upstream URL, branch, and pinned SHA. Cold start runs
[check-updates.sh](check-updates.sh), which resolves the latest SHA
from upstream and — if different from the pinned SHA — writes
`.framework-update-available.md` summarising what changed.

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
| `apply-update.sh` | Fetches upstream, mirrors manifest paths, updates `.framework-version`. Refuses to run if any framework path has uncommitted state (modified OR untracked). |
| `init-framework-version.sh` | Bootstraps `.framework-version` for a new project. Run once per project. |
| `migrate-layout.sh` | One-time consumer migration from the pre-restructure `00_framework/` layout. Idempotent. |
| `skills-sync.sh` | Selectively syncs language/topic skills from a SEPARATE skills repo into `.claude/skills/` per `.claude/.skills-version` (`SKILLS_SELECTED`). `--suggest` prints stack-detected skill suggestions. Dirs not selected are never touched; apply-update never touches skills at all. See `contract:skills-sync`. |
| `skills-check.sh` | Cold-start check: is the project's pinned skills SHA behind the skills upstream? Writes `.claude/.skills-update-available.md` if so (lists selected skills + the sync command). Silent if not opted in. Same throttle + DA-C4 flag discipline as `check-updates.sh`. |

## First-time setup (per project)

```bash
bash .claude/framework/update/init-framework-version.sh
# Optional: override defaults
bash .claude/framework/update/init-framework-version.sh \
  --url https://github.com/OWNER/REPO.git --branch main --interval 24
```

This creates `.framework-version` (commit it) and adds
`.framework-update-available.md` to `.gitignore`.

## Day-to-day (automatic)

Just let cold start do its thing. If there's an update, you'll see an
AskUserQuestion prompt listing the new commits. Choose *yes* to apply,
*no* to skip until the next check.

## Manual override

```bash
# Force an immediate check, ignoring throttle:
#   (edit FRAMEWORK_LAST_CHECKED in .framework-version to a past date,
#    or just run apply-update.sh directly)

# Apply without cold start:
bash .claude/framework/update/apply-update.sh

# Skip the pending update for this session:
rm .framework-update-available.md
```

## Safety model

- **Only manifest paths are touched.** Anything not listed in
  `framework-manifest.txt` is never read or written by the update scripts.
  Adding a new framework-owned file? Add it to the manifest in the same
  commit.
- **Refuses to clobber uncommitted state.** `apply-update.sh` runs
  `git status --porcelain` on every manifest path. If any shows
  *modified*, *staged*, or *untracked* content, the script bails out
  and tells you to commit, stash, or clean first. This guards
  untracked new files — a blind spot that `git diff` alone would miss.
- **Directory paths mirror upstream.** Deletions upstream propagate
  (e.g., a removed agent disappears from your project too). Combined
  with the safety check, local-only files in a manifest directory are
  only ever removed after you've committed them — so recovery via
  `git reflog` or `git show` is always available.
- **Network failure is non-fatal.** If the upstream is unreachable,
  `check-updates.sh` exits quietly with code 3 and cold start continues.

## When NOT to use this system

If you've forked the framework and are maintaining it as a divergent
branch, don't use the update system — it assumes upstream is
authoritative. Use regular git merging instead, and move any
project-specific changes out of manifest paths.

## Dependencies

`git`, `date`, `awk`, `mktemp`. All pre-installed on macOS, Linux,
and Windows (git-bash / WSL). No `gh`, `jq`, or `curl` required.
