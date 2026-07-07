Security sweep across the project: SAST, secret scanning, dependency
scanning, and license/provenance check. Stack-agnostic — dispatches by
manifest presence (same approach as `init.sh` and `auto-format.sh`). Each
check is opt-in by tool availability; missing tooling produces an
informational note rather than a hard failure.

This command exists because AI-generated code consistently surfaces in
research with concrete security failure modes: ~40% of high-risk
scenarios vulnerable in one Copilot study, package-hallucination rates
≥5.2% commercial / ≥21.7% open-source, and SQL/path/shell injection
patterns repeatedly observed in real AI-authored commits. Layered
automated checks catch a meaningful fraction before review.

This is **complementary** to the reviewer agent's per-PR security
checklist — `/security` is the broader sweep across the whole project,
not just the diff. Run it before major merges, on a periodic cadence, or
when /healthcheck nudges.

Below is a runbook. Follow in order. Each step is independent — if one
tool isn't installed, skip and note it; don't halt.

**Output discipline.** For any finding about a safety or security control,
record the weakness *class* and the defensive fix only — never a working
bypass, a runnable payload, or a destructive-command list. Naming the class
and the fix is a complete finding; keep class-level precision, not vague.
(Tool output — gitleaks/SAST/SCA — is captured as the tool emits it.)

---

## Part 0 — Detect project shape

Same auto-detection logic as `/healthcheck` Part 0. Specifically:

- **Source dirs** — parse `CLAUDE.md` Commands section, then common
  layouts (`01_Project/src/`, `02_src/*/`, `src/`, `app/`, `lib/`).
- **Stack** — detect manifest:
  - `package.json` → Node/TS ecosystem (npm/pnpm/yarn)
  - `pyproject.toml` or `requirements.txt` → Python
  - `Cargo.toml` → Rust
  - `go.mod` → Go
  - `*.csproj` or `*.sln` → .NET
- **Findings sink** — write all findings to `.claude/security-findings.md`
  with the same rotation pattern `/healthcheck` uses (move any prior
  findings to `.claude/security-findings/<ISO>.md` first, then start
  fresh). Rationale: same anchoring failure mode (BUG-001).

Tell the user what was detected before running expensive steps. Ask for
confirmation via AskUserQuestion if any tool is about to make network
calls (advisory lookups, SCA against public databases).

---

## Part 1 — Secret scanning (always)

Goal: detect credentials, API keys, tokens, private keys in the working
tree. Prefer in priority order; first one available wins.

1. **gitleaks** (if installed): `gitleaks detect --no-banner --redact`
2. **trufflehog** (if installed): `trufflehog filesystem --no-update .`
3. **Fallback grep** (always runs): scan for high-signal patterns:
   ```bash
   grep -rIn --include='*.py' --include='*.ts' --include='*.js' \
     --include='*.tsx' --include='*.jsx' --include='*.go' \
     --include='*.rs' --include='*.cs' --include='*.json' \
     --include='*.yml' --include='*.yaml' --include='*.toml' \
     --include='.env*' \
     -E '(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{36}|xox[bpars]-[A-Za-z0-9-]+|-----BEGIN (RSA |DSA |EC |OPENSSH |)PRIVATE KEY-----|password[[:space:]]*=[[:space:]]*["'\''][^"'\'']+["'\''])' \
     . 2>/dev/null
   ```

Findings go to `security-findings.md` as **SECRET — <severity> — <file:line> — <pattern>**.

Severity: any real key found → CRITICAL. Pattern-match in a test file or
fixture → WARNING (likely intentional). False positives on dummy-data
strings → SUGGESTION.

---

## Part 2 — Static analysis (SAST)

Pick the tool that matches the stack. Each is opt-in by tool availability.

| Stack | Preferred | Fallback |
| ----- | --------- | -------- |
| Python | `bandit -r <src>` | `ruff check --select=S <src>` (`S` is bandit-like ruleset) |
| Node/TS | `semgrep --config=p/javascript --config=p/typescript .` — ONLY if `command -v semgrep` (install: `pip install semgrep` or `brew install semgrep`). Do NOT `npx semgrep`: the npm package named `semgrep` is a v0.0.1 name-squat, not the tool — `npx` would fetch and run it (the exact slopsquat this command warns about). Missing → use the fallback. | `npm audit --audit-level=moderate` (covers SCA too) |
| Go | `gosec ./...` | `go vet ./...` |
| Rust | `cargo clippy -- -W clippy::all -W clippy::pedantic` (cherry-pick security lints) | `cargo audit` (covers SCA) |
| .NET | `dotnet list package --vulnerable --include-transitive` + Roslyn analyzers | — |
| Any | `semgrep --config=auto .` (cross-language) | — |

Capture findings classified as security/CWE; ignore style-only lints
(auto-lint hook covers those). Severity follows the tool's classification
(HIGH/MEDIUM/LOW); map to CRITICAL/WARNING/SUGGESTION in
`security-findings.md`.

**AI-specific patterns to grep for explicitly** (even if SAST passed),
since these are the most-reported AI failure modes in published studies:

```bash
# SQL string interpolation (Microsoft data-formulator case)
grep -rIn -E '(execute|query|exec|raw)[[:space:]]*\([[:space:]]*(f"|"|`)[^,)]*\$\{|%s' <src> 2>/dev/null

# Bare exception swallowing (Claude ArchiveBox case)
grep -rIn -E '^\s*(except:|except Exception:|catch\s*\([^)]*\)\s*\{\s*\}|catch\s*\(_\))' <src> 2>/dev/null

# User input → shell
grep -rIn -E '(os\.system|subprocess\.(Popen|run|call)\([^)]*shell=True|child_process\.exec)' <src> 2>/dev/null

# eval / exec / new Function on dynamic input
grep -rIn -E '\b(eval|exec|new Function)\b' <src> 2>/dev/null

# Path traversal — file path constructed from user input without basename/realpath check
grep -rIn -E '(open|readFile|fs\.read|os\.open)[[:space:]]*\([^)]*\b(req\.|request\.|params\.|input|argv)' <src> 2>/dev/null
```

Treat any match as CRITICAL unless you can rule it out by reading the
surrounding context.

---

## Part 3 — Dependency scanning (SCA)

Goal: known-vulnerable or known-malicious dependencies, plus existence
verification of every newly-added package (slopsquatting defense).

By stack:

- **Node**: `npm audit --omit=dev --audit-level=moderate` — captures
  HIGH/CRITICAL advisories. If `better-npm-audit` is already installed
  (`command -v better-npm-audit`), also run `better-npm-audit audit` for
  SARIF output — do NOT `npx`-fetch it on demand (unpinned `npx <tool>`
  auto-install is the slopsquat surface Part 4a flags as CRITICAL).
- **Python**: `pip-audit` (if installed) or `safety scan` against
  `requirements.txt` / `pyproject.toml`. If neither installed, query
  PyPI for each new dep's existence (the `verify-deps.sh` hook covers
  this on edit; here, run it across the full manifest):
  ```bash
  for pkg in $(grep -oE '^[a-zA-Z0-9_.-]+' requirements.txt 2>/dev/null); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "https://pypi.org/pypi/$pkg/json")
    [ "$code" = "404" ] && echo "MISSING: $pkg"
  done
  ```
- **Rust**: `cargo audit` (RustSec advisory database).
- **Go**: `govulncheck ./...` if installed.
- **.NET**: `dotnet list package --vulnerable --include-transitive`.

Cross-stack: any new dependency added in the last `git log` window
that the verify-deps hook flagged in `.claude/.dep-verification-issues.md`
gets re-checked here (in case the file was deleted without resolving the
issues).

Findings go to `security-findings.md` as **DEPENDENCY — <severity> —
<package@version> — <advisory ID or "missing">**.

---

## Part 4 — Workflow / config security (always)

This is the **harness's own attack surface** — distinct from project code
(Parts 1-3). Run the deterministic auditor first, then the manual
spot-checks it doesn't cover.

**4a — Config-surface auditor (run always):**

```bash
bash .claude/framework/audit/config-security.sh
```

This scans five surfaces and reports CRITICAL/WARNING/INFO findings
(exit 2 on any CRITICAL, so it doubles as a CI build gate —
`config-security.sh --format json` for pipelines):

1. **settings.json** — permission allow-breadth + the secret-deny baseline
   (`.env`, `~/.ssh`, `~/.aws`, `*secret*`, `*credential*`).
2. **hooks** — `curl|bash` / remote-code execution, `eval`, and unquoted
   interpolation of model-controlled `tool_input` (shell-injection).
3. **agent prompts** — tool-scope creep (a read-only agent that grants
   Write/Edit, or any wildcard tool grant).
4. **MCP configs** (`.mcp.json` / settings `mcpServers`) — unpinned
   `npx -y`/`uvx` auto-install and shell-piped server commands.
5. **CLAUDE.md / CLAUDE.framework.md / AGENTS.md** — prompt-injection
   override phrasing and zero-width / bidi hidden-instruction characters.

Fold its findings into `security-findings.md` (same SEV mapping).
WARNINGs need human triage — some are intentional (e.g. a test-command
rewriting hook that embeds `$cmd` by design).

**4b — Manual spot-checks (auditor doesn't cover these):**

- `.gitignore` covers `.env`, `.env.*`, `settings.local.json`,
  `worktrees/`, `.claude/review-findings/`, `.claude/security-findings/`,
  any project-specific secret files.
- No `--no-verify` or `-c commit.gpgsign=false` in recent commits
  (`git log --oneline -20`).

These overlap with `doctor.sh` Check 1 / `/healthcheck` Part 1.3 (which
check config *integrity* — do referenced files exist); Part 4 checks
config *security* — is the configuration itself a risk.

---

## Part 5 — License / provenance check (opt-in, skip if not relevant)

Goal: licence-incompatible code, attribution gaps, public-code matches
that may indicate verbatim copy. Skip if the project is fully internal
and not redistributed.

- **Licence aggregation**:
  - Node: `license-checker --production --summary` — only if `command -v
    license-checker` (install `npm i -g license-checker`); skip rather than
    `npx`-fetching it on demand (unpinned auto-install — see Part 4a).
  - Python: `pip-licenses --format=markdown` if installed
  - Rust: `cargo about generate` if installed
  - Go: `go-licenses report ./...` if installed
- **GPL / copyleft propagation**: flag any GPL/AGPL/SSPL transitive
  dependency in a project shipped as commercial closed-source as
  WARNING for legal review.
- **Public-code match** (if Copilot/GitHub code-referencing is enabled
  on the org, surface its findings here). Otherwise SKIP.

---

## Part 6 — Checkpoint + act

Same as `/healthcheck` Part 6-7:

1. Ask via AskUserQuestion: checkpoint commit / continue without commit
   / stop here.
2. **CRITICAL** findings → P0 entries in TASKS.md (Bug-Fix lane).
3. **WARNING** findings → triage as P1/P2 depending on context; create
   tasks for actionable ones.
4. Update STATUS.md with the sweep result (sweep date, finding count).
5. Update `claude-progress.txt`.

---

## Edge cases

- **No project code (framework-only repo / fresh clone).** Parts 2, 3, 5
  skip with a note. Part 1 (secret scanning) and Part 4 (workflow
  security) still produce value across the framework machinery itself.
- **Offline / no network access.** Parts 1 (gitleaks/trufflehog if
  cached), 2 (SAST tools work offline), 4 (workflow security) still
  run. Part 3 (SCA) and Part 5 (licence) degrade — note in findings.
- **None of the preferred tools installed.** Fall back to the grep
  patterns in Part 2; surface a note in findings: "install <tool> to
  get full coverage." Don't halt.

## When to run

- Before any major merge into a long-lived branch.
- After adding new dependencies (the verify-deps.sh hook catches
  individual edits; this is the periodic full-sweep).
- Periodically (STATUS.md records the last sweep date — there is
  deliberately no automated nudge; if one is ever added, pattern it on
  the healthcheck reminder: a timestamp file PLUS a cold-start reader,
  never a write-only timestamp).
- Whenever the reviewer agent flags a CRITICAL security finding —
  expand to a full sweep to check for related issues.
