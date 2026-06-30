# Migrating a Project onto the Framework Update System

---

## Multi-Project Mode Removal (2026-06-10, TASK-023)

**Who needs this:** almost nobody. Multi-project mode (one framework instance
hosting several projects under `projects/<name>/` with an `_active` pointer)
was removed — practical usage showed a single framework clone per project is
the better model. No known consumer ever flipped to multi.

**What happens automatically:** on your next `apply-update.sh` run, the
removed paths (`.claude/framework/project/`, `.claude/commands/framework-mode.md`)
are deleted from your clone via the "(removed upstream)" path. A leftover
`FRAMEWORK_MODE=single` line in `.claude/.framework-version` is inert — nothing
reads it anymore; delete it or leave it.

**Only if you had flipped to multi** (`FRAMEWORK_MODE=multi` in
`.claude/.framework-version` and a `projects/` directory at root): your stashed
project state is NOT touched by the update — but the tooling that resolves it
is gone. Un-stash manually: for each `projects/<name>/`, create a fresh clone
of the framework, copy that project's state files over the clone's `.claude/`
templates and its code into `01_Project/`, then delete `projects/` and the
`FRAMEWORK_MODE` line from the original instance.

---

## Layout Migration (commit `9663226`, 2026-04-24) — `00_framework/` → `.claude/framework/`

**Who needs this:** every consumer that pulled the framework before 2026-04-24.

**What changed:** `00_framework/` was eliminated. All framework scripts moved to
`.claude/framework/`. Root state files (`TASKS.md`, `STATUS.md`, `DECISIONS.md`,
`ECOSYSTEM.md`, `GOTCHAS.md`, `FRAMEWORK-SUGGESTIONS.md`, `claude-progress.txt`,
`framework-metrics.md`) moved to `.claude/`. `.framework-version` moved to
`.claude/.framework-version`.

**Why your old `apply-update.sh` won't work directly:** it reads your local
`00_framework/update/framework-manifest.txt`, which still lists the old paths.
Upstream no longer has files at those paths, so the update silently skips
everything. You must migrate first.

### Option A — Automated (recommended)

Download and run the migration script from the new upstream:

```bash
curl -fsSL \
  https://raw.githubusercontent.com/drushegh/CCMAF/main/.claude/framework/update/migrate-layout.sh \
  | bash
```

This will:
1. `git mv 00_framework/ .claude/framework/`
2. `git mv` each root state file to `.claude/`
3. `git mv .framework-version .claude/.framework-version`
4. Update path references in `CLAUDE.md` and `CLAUDE.framework.md`
5. Commit: `chore: framework layout migration — 00_framework/ → .claude/framework/`
6. Run `doctor.sh` — surfaces any CRITICAL findings before you proceed

Then sync the framework content to the new layout:

```bash
bash .claude/framework/update/apply-update.sh
```

### Option B — Manual

```bash
# 1. Move the framework directory
git mv 00_framework/ .claude/framework/

# 2. Move root state files (skip any that don't exist in your project)
for f in TASKS.md STATUS.md DECISIONS.md ECOSYSTEM.md GOTCHAS.md \
          FRAMEWORK-SUGGESTIONS.md claude-progress.txt framework-metrics.md; do
  [ -f "$f" ] && git mv "$f" ".claude/$f"
done

# 3. Move framework config
[ -f ".framework-version" ] && git mv .framework-version .claude/.framework-version
[ -f "claude-code-dev-framework.md" ] && git mv claude-code-dev-framework.md .claude/claude-code-dev-framework.md

# 4. Update .gitignore (temp flag paths moved under .claude/)
sed -i \
  -e 's|^\.framework-update-available\.md$|.claude/.framework-update-available.md|' \
  -e 's|^\.framework-insight-alert\.md$|.claude/.framework-insight-alert.md|' \
  -e 's|^\.framework-doctor-findings\.md$|.claude/.framework-doctor-findings.md|' \
  .gitignore

# 5. Update CLAUDE.md path references
sed -i 's|00_framework/|.claude/framework/|g' CLAUDE.md

# 6. Commit
git add .claude CLAUDE.md CLAUDE.framework.md .gitignore   # enumerated — not -A (avoids sweeping secrets)
git commit -m "chore: framework layout migration — 00_framework/ → .claude/framework/"

# 7. Sync framework content to new paths
bash .claude/framework/update/apply-update.sh
```

### After migration

Your project root should contain only:
`CLAUDE.md`, `CLAUDE.framework.md`, `.gitignore`, `.claude/`, and your project directories.

Run `bash .claude/framework/doctor/doctor.sh` — should exit clean (0 CRITICAL).

---

## Update System Migration (commit `ce1dc88`, 2026-04-17) — original adoption

One-time migration for projects created with the framework *before* the
update system was added (commit `ce1dc88`, 2026-04-17).

After migration, cold start automatically checks for framework updates
and prompts you before applying them. You keep project-specific content
in `CLAUDE.md`; framework-shipped content lives in `CLAUDE.framework.md`
and is updated automatically.

## Prerequisites

- `git` and `bash` available.
- Working tree is clean (or at least clean in the framework-owned paths
  listed below). If you have in-flight work, commit or stash it first.

## Step 1 — Fetch the current framework

```bash
git clone --depth 1 https://github.com/drushegh/CCMAF.git /tmp/framework-upstream
```

## Step 2 — Copy framework files from upstream (manifest-driven)

The framework's `framework-manifest.txt` lists every framework-owned path
in one place. We mirror each one — this is self-documenting and picks
up new framework paths automatically (e.g., future additions like
`.claude/framework/insights/` or `.claude/framework/doctor/` flow through without
needing to update this guide).

Run from **your project root**:

```bash
UPSTREAM=/tmp/framework-upstream
MANIFEST="$UPSTREAM/.claude/framework/update/framework-manifest.txt"

while IFS= read -r entry; do
  entry="${entry%$'\r'}"          # strip CR on Windows (core.autocrlf=true)
  # Skip blanks and comments.
  [[ -z "$entry" || "$entry" =~ ^[[:space:]]*# ]] && continue
  # Entries ending in "/" are directory mirrors; bare paths are file entries.
  if [[ "$entry" == */ ]]; then
    entry="${entry%/}"
    src="$UPSTREAM/$entry"
    [ ! -e "$src" ] && continue
    rm -rf "$entry"
    mkdir -p "$(dirname "$entry")"
    cp -r "$src" "$entry"
  else
    src="$UPSTREAM/$entry"
    [ ! -e "$src" ] && continue
    mkdir -p "$(dirname "$entry")"
    cp "$src" "$entry"
  fi
  echo "  mirrored: $entry"
done < "$MANIFEST"
```

The loop dispatches by manifest *semantic* (trailing slash = directory
mirror, bare path = file entry) rather than by filesystem type — that
matches what `apply-update.sh` does and keeps file-level entries like
`.claude/commands/analyse.md` safe without sweeping the whole directory.

What the current manifest includes:
- `.claude/agents/framework/` *(dir)* — the four framework agent definitions
- `.claude/commands/<cmd>.md` *(files)* — slash commands shipped by the framework (e.g. `analyse.md`, `plan.md`, `healthcheck.md`). **File-level entries — projects keep their own `.claude/commands/` files untouched except for names that collide with shipped ones.** See the "/healthcheck collision" note below.
- `.claude/hooks/<hook>.sh` *(files)* — framework hooks (drift-guard, stop-enforcer, bash-guard, formatters, linters, test-filter). File-level entries to coexist with project hooks.
- `.claude/framework/agent_docs/` *(dir)* — agent reference docs (building, testing, conventions, architecture, behavioral-principles, contracts)
- `.claude/framework/doctor/` *(dir)* — point-in-time integrity check
- `.claude/framework/insights/` *(dir)* — longitudinal efficacy tracking
- `.claude/framework/update/` *(dir)* — the update system itself
- `.claude/framework/init.sh` *(file)* — cold-start smoke test
- `CLAUDE.framework.md` *(file)* — framework-shipped session instructions
- `claude-code-dev-framework.md` *(file)* — framework operations guide

> **Filename collisions** — framework-shipped command and hook filenames
> in `.claude/commands/` and `.claude/hooks/` overwrite any local files
> with the same name on `apply-update`. If your project has its own
> `/healthcheck` (or any other command that newly becomes framework-owned),
> **rename it before running `apply-update.sh`** or your version will be
> replaced with the framework version. The manifest is self-documenting —
> `grep -E '^\.claude/(commands|hooks)/' framework-manifest.txt` lists
> everything the framework now owns at the file level.

## Step 3 — Split CLAUDE.md

`CLAUDE.md` previously mixed framework-shipped structure (cold start,
state rules, agent rules, etc.) with project-specific content (project
name, tech stack, commands). Those now live in separate files:

- **Framework-owned** (updated automatically, DO NOT edit):
  `CLAUDE.framework.md` — step 2 already copied the upstream version in.
- **Project-owned** (your content, never overwritten): `CLAUDE.md`

Edit `CLAUDE.md` to contain ONLY project-specific content:
- `{{PROJECT_NAME}}` heading and description
- Tech Stack section
- Commands section
- Any project-specific notes, conventions, or overrides

Everything else (Cold Start Sequence, State File Rules, Commit
Convention, Agent Rules, Code Quality Rules, Code Navigation, Reference
Documents, MCP Servers, Framework Feedback, Context Awareness) moves
out — those now live in `CLAUDE.framework.md` and you don't need to
duplicate them.

Add this line at the top of `CLAUDE.md`, right after the project title:

```markdown
**Framework instructions (required reading):** see [CLAUDE.framework.md](./CLAUDE.framework.md).
```

Compare against the upstream `CLAUDE.md` template for reference —
it's the canonical post-split shape:
<https://github.com/drushegh/CCMAF/blob/main/CLAUDE.md>

## Step 4 — Bootstrap the update system

```bash
bash .claude/framework/update/init-framework-version.sh
```

This creates `.claude/.framework-version` (commit it) and
adds `.framework-update-available.md` to `.gitignore`.

## Step 5 — Verify

```bash
bash .claude/framework/update/check-updates.sh
```

Should exit silently with no flag file (you're on the latest framework
version you just pulled).

## Step 6 — Commit

```bash
git add .claude CLAUDE.md CLAUDE.framework.md .gitignore   # enumerated — not -A (avoids sweeping secrets)
git commit -m "chore: adopt framework update system (TASK-XXX)"
```

Replace `TASK-XXX` with the task ID from your project's `TASKS.md`.

## Step 7 — Remove the migration task

Delete the task entry from `TASKS.md` — migration is one-and-done.

## What changes from now on

Cold start step 1 runs `check-updates.sh` automatically. If the
framework has new commits, you'll see an `AskUserQuestion` prompt with
the commit list. Choose *yes* to apply, *no* to skip. That's it.

## Troubleshooting

- **"apply-update: refusing to overwrite framework-owned paths"** —
  you have uncommitted or untracked content in a manifest path. Commit,
  stash, or clean it before re-running.
- **Check fails with "unable to reach upstream"** — offline or network
  issue. Not fatal; cold start continues. Throttled 24h between checks.
- **Want to bump the check interval?** Edit
  `FRAMEWORK_CHECK_INTERVAL_HOURS` in `.framework-version`.

## Rollback

If you need to abandon the migration, just reset the commit from step 6
and delete `.framework-version`. The old framework files are still in
git history.
