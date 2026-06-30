# Retro-Audit Checklist

When the framework gains a new gate (a reviewer check, a hook, a
behavioral principle), code that was written *before* the gate existed
doesn't get checked retroactively. This doc is the one-place checklist
of scans to run after each framework pull, so existing code gets
held to the same standard as new code.

**When to use:**
- After every framework `apply-update.sh` that introduced new gates.
- During a periodic sweep of consumers (e.g., before a release, or
  on the same cadence as `/security`).

**How it's organised:**
- One section per framework release that introduced gates.
- Each section lists every new gate with: *why it now flags*, a
  *scan recipe* you can copy-paste, *triage* guidance, and *how to
  suppress* intentional cases.
- Newest releases at the top. Run sections newer than your last pull.

**What to do with findings:**
- CRITICAL → file as P0 bug in your project's `TASKS.md` Bug-Fix lane.
- WARNING → file as P1 or P2 depending on context.
- SUGGESTION → consider in your next housekeeping pass.
- Pre-existing intentional cases → suppress per the gate's suppression
  guidance below (typically `# noqa`-style comments or an allowlist).

**Per-project workflow:**

1. `git pull` on the consumer (or `bash .claude/framework/update/apply-update.sh`).
2. Open this file. Identify the most recent section since your last audit.
3. Run each scan recipe. Triage findings.
4. File tasks for actionable findings.
5. Note the audit completion in your `claude-progress.txt`.

---

## Release 2026-05-14 — TASK-008 (AI-coding-research sweep)

This sprint added 11 changes to the framework based on a deep research
report on AI-written code defects. Six produce retroactively-scannable
gates that may catch issues in code written before this release.

### Gate 1: Hallucinated dependencies

**Why it now flags.** `verify-deps.sh` pings npm and PyPI for every
new dep added to a manifest. Code written before this hook existed may
have shipped hallucinated package names that have either never been
caught or were silently replaced (e.g., a `pip install` failure that
got worked around). Slopsquatting / fabricated-package risk also
warrants a one-time sweep.

**Scan recipe (run from project root):**

```bash
# Drive verify-deps.sh in retro mode against every manifest in the repo.
# Network calls hit npm.org + pypi.org; cargo/go/nuget get a "manual"
# entry. Takes 5-30s depending on dep count.
rm -f .claude/.dep-verification-issues.md
for f in $(git ls-files | grep -E '(^|/)(package\.json|pyproject\.toml|requirements.*\.txt|Cargo\.toml|go\.mod|.*\.csproj)$'); do
  echo "{\"tool_input\":{\"file_path\":\"$f\"}}" \
    | VERIFY_DEPS_RETRO=1 bash .claude/hooks/verify-deps.sh
done
cat .claude/.dep-verification-issues.md 2>/dev/null || echo "(clean — no issues)"
```

**Triage:**
- **MISSING** entries → registry returned 404. CRITICAL: the package
  doesn't exist. Either you have a typo, a private registry (set up
  appropriately and re-run with the registry pointed at your private
  index), or a hallucinated name. Fix before any new install.
- **UNVERIFIED** entries → registry check skipped (offline, no curl,
  or rate-limited). Re-run with network access, or verify manually:
  `npm view <name>` / `pip index versions <name>`.
- **MANUAL** entries (cargo, go, nuget) → existence verification not
  yet automated for this ecosystem. Check each on the relevant
  registry: crates.io, sum.golang.org, nuget.org.

**Suppression:** intentional non-public deps (private npm scope,
internal PyPI mirror) → none built in yet. If this becomes a recurring
false positive on your project, file a FRAMEWORK-SUGGESTIONS entry to
add an allowlist mechanism.

---

### Gate 2: Broad exception handling

**Why it now flags.** Reviewer §5b now CRITICALs any `except:`,
`except Exception:`, `catch (Exception)`, or empty-catch block on
newly-introduced changes. This is one of the top three real-world
AI-introduced defect classes (research: Claude ArchiveBox case of
silent `except: pass` insertion). Pre-existing instances are equally
risky — they just haven't been reviewed yet against this rule.

**Scan recipe (run from project root):**

```bash
# Python
grep -rIn --include='*.py' -E '^[[:space:]]*except[[:space:]]*:' . 2>/dev/null
grep -rIn --include='*.py' -E '^[[:space:]]*except[[:space:]]+(Exception|BaseException)[[:space:]]*[:,]' . 2>/dev/null

# JS / TS
grep -rIn --include='*.js' --include='*.ts' --include='*.jsx' --include='*.tsx' \
  -E 'catch[[:space:]]*\([[:space:]]*(_|err|e|error)[[:space:]]*\)[[:space:]]*\{[[:space:]]*\}' . 2>/dev/null

# C# / Java
grep -rIn --include='*.cs' --include='*.java' \
  -E 'catch[[:space:]]*\((Exception|Throwable)[[:space:]]+\w+\)[[:space:]]*\{' . 2>/dev/null

# Go (idiomatic; but watch for `_ = err`)
grep -rIn --include='*.go' -E '^[[:space:]]*_[[:space:]]*=[[:space:]]*err[[:space:]]*$' . 2>/dev/null

# Rust
grep -rIn --include='*.rs' -E '\.ok\(\)[[:space:]]*;|\.unwrap_or_default\(\)' . 2>/dev/null
```

**Triage:**
- Empty catch blocks (catch + no body) → CRITICAL. Silent failure.
- Catch-all that logs and re-raises → WARNING. Acceptable if the log
  is genuinely informative; better to narrow the exception type.
- Catch-all that returns a default value → WARNING. Probably masking
  a real error; check whether the default is actually valid.
- `_ = err` in Go → CRITICAL. Erasing an error is rarely correct.
- `.unwrap_or_default()` in Rust → WARNING. Default values can mask
  domain errors; verify the default is meaningful in context.

**Suppression:** if a broad catch is genuinely intentional (e.g., a
top-level error boundary, a cleanup handler that must never fail), add
an inline comment justifying it. Reviewers will accept commented
exceptions; uncommented ones stay flagged.

```python
except Exception:  # top-level error boundary; must not propagate to user
    log.exception("unexpected failure in handler X")
    return err_response
```

---

### Gate 3: Test flakiness patterns

**Why it now flags.** Tester now requires anti-flakiness rules on
every new test. Research: 63% of inspected flaky tests in one study
traced to a single cause (unordered collection iteration). Existing
tests that were written before this rule may be flaky in ways that
ordinary CI passes don't reveal.

**Scan recipe (run from project root — adapt test-directory globs to
your stack):**

```bash
# Test directories — adapt to your layout. Common: tests/, test/, __tests__/.
TEST_DIRS="tests test __tests__ 01_Project/tests 02_src/*/tests"

# 1. Unseeded randomness in tests
grep -rIn $TEST_DIRS \
  -E '\b(random\.[a-z]|Math\.random|Random\(\)|crypto\.randomUUID|uuid\.uuid)' \
  --include='*.py' --include='*.ts' --include='*.js' --include='*.jsx' --include='*.tsx' \
  --include='*.go' --include='*.rs' --include='*.cs' 2>/dev/null

# 2. time.sleep / Thread.sleep as synchronisation in tests
grep -rIn $TEST_DIRS \
  -E '\b(time\.sleep|Thread\.sleep|asyncio\.sleep|setTimeout)\b' \
  --include='*.py' --include='*.ts' --include='*.js' --include='*.jsx' --include='*.tsx' \
  --include='*.go' --include='*.rs' --include='*.cs' \
  2>/dev/null | grep -vE '(mock|fake|stub|patch)'   # rough filter: tests that mock sleep are fine

# 3. Iteration over unordered collections without sorting
# (heuristic — true positives require eyeballing each match)
grep -rIn $TEST_DIRS \
  -E 'for[[:space:]]+\w+[[:space:]]+in[[:space:]]+(set|dict|os\.listdir|glob)' \
  --include='*.py' 2>/dev/null

# 4. Shallow assertions (assert X is not None and nothing else)
grep -rIn $TEST_DIRS \
  -E '^[[:space:]]*(assert|expect)[[:space:]]+\w+\.?\w*[[:space:]]*(is[[:space:]]+not[[:space:]]+None|\.ok|\.is_some)[[:space:]]*$' \
  --include='*.py' --include='*.ts' --include='*.js' --include='*.rs' 2>/dev/null

# 5. Pre-existing test flakiness signals from your CI history (manual)
# Look for tests that have been retried, skipped, or marked xfail in
# the last 30 days. Adapt to your CI system.
git log --since="30 days ago" --oneline --grep -E '(flaky|retry|xfail|skip)' 2>/dev/null
```

**Triage:**
- Unseeded random in test setup → CRITICAL. Reproducibility broken.
  Fix: seed the RNG, or assert on distribution properties only.
- `time.sleep` in test for sync → CRITICAL. Replace with event/condition
  wait. If genuinely testing latency, document the expected duration
  range and use a tolerance band.
- Iteration over unordered collection in assertion → CRITICAL. Sort
  before asserting, or use an order-agnostic assertion (set equality).
- Shallow assertions → WARNING. The test isn't proving the behaviour
  the spec promises; add value/structure assertions.

**Suppression:** intentional flakiness is rare. If you must keep a
flaky test (e.g., it tests integration with an inherently flaky
external system), wrap with retry-N-times + clear comment, and add
to a known-flaky list in your test config.

---

### Gate 4: Missing Assumptions in commit bodies

**Why it now flags.** Developer agent now requires an `Assumptions:`
section in non-trivial commit bodies (version pins, inferred files,
env conditions, external API contracts). Commits before this rule
existed don't have it. Most are fine retrospectively — only commits
where assumptions later turned out wrong are worth re-examining.

**Scan recipe (run from project root):**

```bash
# List commits in the last 60 days that touched non-trivial files
# (not pure docs / config). Manually skim for any that look like they
# made non-obvious choices and would benefit from a retro-Assumptions
# annotation.
git log --since="60 days ago" \
  --pretty=format:'%h %s' \
  -- '*.py' '*.ts' '*.js' '*.go' '*.rs' '*.cs' '*.java' 2>/dev/null \
  | head -40

# For each candidate commit, view its diff + body:
# git show <hash>
```

**Triage:**
- Commits whose body claimed something the diff doesn't support →
  WARNING (this is the gate 5d failure mode applied retroactively).
  File a task: "verify commit X's claims; correct or amend log."
- Commits that introduced a dep, version pin, or env requirement
  without recording the assumption → SUGGESTION. Not a bug, but useful
  context for future maintenance. Consider adding a `Decisions.md`
  entry retroactively.
- Commits that look like they inferred a file path / API surface and
  may have got it wrong → triage by running the code under test.

**Suppression:** none — this is a soft retroactive scan. Don't amend
historical commits unless the misalignment is causing real problems.

---

### Gate 5: Newly-introduced code smells

**Why it now flags.** Reviewer's "Code Smells" section now treats
newly-introduced smells as CRITICAL (was: WARNING). Research: 89.3%
of AI-introduced issues in one 6k-repo study were smells. Existing
smells (introduced before this gate) are still smells — but the new
rule only fires on *new* introductions.

**Scan recipe (run from project root):**

```bash
# 1. Unused imports (Python) — run ruff if installed
command -v ruff >/dev/null && ruff check --select=F401 .

# 2. Unused imports (JS/TS) — eslint if configured
[ -f package.json ] && command -v npx >/dev/null && \
  npx eslint --no-eslintrc --rule 'no-unused-vars: error' --rule 'unused-imports/no-unused-imports: error' .

# 3. Unused vars (cross-language smell)
# Stack-specific. Run your project's linter with the strictest config
# you can tolerate, and triage the diff against the last clean run.

# 4. Dead code (functions/methods with no callers)
# Hard to automate cross-language. Worth a manual review for any module
# whose mtime is recent — anything that hasn't been called in 90+ days
# of git history is suspect.

# 5. Duplicate code (cross-language)
command -v jscpd >/dev/null && jscpd --min-lines 10 --min-tokens 50 .
# Or: pylint --duplicate-code-min-lines=8 . (Python)
```

**Triage:**
- Unused imports/vars introduced in the last 30 days → CRITICAL.
  Remove in the next commit that touches the file.
- Older unused imports/vars → SUGGESTION. Clean up in housekeeping;
  don't block a feature commit on them.
- Duplicate code blocks with an obvious shared-helper home → WARNING.
  Refactor only if you're already touching both call sites.

**Suppression:** linter inline comments (`# noqa: F401`,
`// eslint-disable-line no-unused-vars`) are acceptable for genuinely
intentional cases (re-exports, conditional imports, dependency-only
imports). Each suppression should have a same-line comment explaining
why.

---

### Gate 6: Hook registration drift

**Why it now flags.** The framework pulled `verify-deps.sh` into the
hooks/ directory and updated the manifest. Each consumer needs to also
register the hook in their own `settings.json` PostToolUse block.
Doctor Check 1 already warns about this on cold start, but a one-time
verification across all consumers is worth doing after this release.

**Scan recipe (run from project root):**

```bash
# Confirm the hook file exists.
test -f .claude/hooks/verify-deps.sh && echo "  hook present" || echo "  HOOK MISSING — re-run apply-update.sh"

# Confirm settings.json references it.
grep -q 'verify-deps\.sh' .claude/settings.json \
  && echo "  registered in settings.json" \
  || echo "  NOT registered — see Triage below"

# Doctor will surface this as a WARNING too.
bash .claude/framework/doctor/doctor.sh
cat .claude/.framework-doctor-findings.md 2>/dev/null
```

**Triage:**
- Hook file missing → run `bash .claude/framework/update/apply-update.sh`
  again; the manifest entry should pull it in.
- Hook file present but not in settings.json → add this entry to the
  `PostToolUse` block (matcher `Write|Edit|MultiEdit`), alongside
  the existing `auto-format.sh` and `auto-lint.sh` entries:

  ```json
  {
    "type": "command",
    "command": "bash -c 'cd \"$CLAUDE_PROJECT_DIR\" && bash .claude/hooks/verify-deps.sh'"
  }
  ```

**Suppression:** if you have a deliberate reason not to run the hook
(e.g., your project is offline and would always get UNVERIFIED entries),
keep the hook file but set `CLAUDE_DEP_VERIFY=0` in your shell
environment rather than removing the registration. That way the hook
still runs, logs to telemetry, and produces detection-only output
without network calls.

---

## Template for future framework releases

When the framework gains a new gate, append a new section at the top
of this file using the structure below. Keep recipes copy-pasteable
and self-contained (no references to external scripts that aren't
shipped in the framework).

```markdown
## Release YYYY-MM-DD — TASK-XXX (brief description)

Short overview of what was added and why retroactive auditing matters
for this release.

### Gate N: Short name

**Why it now flags.** One paragraph: what the new gate checks and why
existing code may exhibit the pattern.

**Scan recipe (run from project root):**

\`\`\`bash
# Copy-pasteable commands. Should work on Windows Git Bash + Linux + macOS.
# Stack-specific commands should be branched by manifest presence, not assumed.
\`\`\`

**Triage:**
- Severity per pattern. What action to take.

**Suppression:** how to mark intentional cases so future scans skip them.
```

## Audit log (consumer-specific — optional)

Some consumers track their audit history; others don't. If you do, a
common pattern is to append a one-line entry to `claude-progress.txt`
after each audit:

```
### YYYY-MM-DD — RETRO-AUDIT post-pull (release YYYY-MM-DD)
- Gate 1 hallucinated deps: clean (0 findings)
- Gate 2 broad-catch: 3 WARNINGs, filed BUG-NNN
- Gate 3 test flakiness: 1 CRITICAL on `tests/test_user.py`, filed BUG-NNN
- Gate 4 missing Assumptions: skipped (low value for this project)
- Gate 5 smells: 12 SUGGESTIONS, deferred to housekeeping
- Gate 6 hook registration: settings.json updated, doctor clean
```

Local audit history isn't framework-shipped — it's noise for downstream
consumers — but is useful for the consumer's own trend tracking.
