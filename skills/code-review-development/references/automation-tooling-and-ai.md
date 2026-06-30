# Automation, Tooling and AI Reviewers

Human (and agent) review attention is the scarcest, most valuable thing
in the process. Spend it only on what judgement is needed for; make
machines do everything mechanical and deterministic.

## Push the mechanical checks into CI — as a gate

Anything a tool can decide should be decided by a tool, before review,
and block merge automatically:

- **Formatting** — an auto-formatter (Prettier, Black, gofmt, dotnet
  format). Formatting should never be a review comment.
- **Linting / static analysis** — language linters and analysers for
  known-bad patterns.
- **Type checking** — the compiler/type checker green.
- **Tests + coverage** — the suite passes; meaningful coverage on
  changed lines (a guardrail, not a target to game) (→
  `testing-development`).
- **Security scanning** — SAST, secret scanning, dependency/vulnerability
  and licence audit (→ `secure-development`).
- **Build** — it actually builds and packages.

Wire these in the pipeline (→ `devops-development`). When CI is green by
the time a human looks, the review is about design, correctness, edge
cases and tests — the things tools *can't* judge. A review thread
arguing about indentation is a process smell: automate it away.

## Use the platform's mechanics

- **Required reviewers / branch protection** — protected branches,
  required approvals, required status checks, dismiss-stale-approvals on
  new commits.
- **CODEOWNERS** (or equivalent) — route changes to the people/teams
  accountable for that code, and ensure specialised concerns (security,
  data, accessibility) reach a qualified reviewer.
- **Suggested changes** — propose a concrete one-click edit for small
  fixes instead of describing them in prose.
- **Draft PRs** — for early-feedback or work-in-progress, so reviewers
  know not to do a final pass yet.
- GitHub and Azure DevOps both provide these; the names differ, the
  concepts don't (→ `devops-development`).

## Using AI / LLM reviewers well

AI reviewers (including an agent in this framework) are genuinely useful
and genuinely limited — treat them as a **fast first pass, not a final
gate**:

Good at: a quick sweep for the defect classes in `defect-hunting.md`,
spotting missing tests/null checks/error paths, surfacing style/security
patterns at scale, and giving the author feedback in seconds before a
human looks.

Weak at: **intent and context** (it rarely knows why the change exists or
the system's history), **false positives** (it flags plausible-but-wrong
issues confidently — every AI comment needs human judgement before it
becomes a blocker), and **ownership** (a model cannot be accountable for
a merge).

Rules for an AI/agent reviewer:

- **State scope and confidence.** Say what was checked, what wasn't, and
  how sure you are. Distinguish "this is a bug" from "this might be worth
  checking".
- **Never rubber-stamp to be agreeable.** A confident wrong "LGTM" is
  worse than an honest "I couldn't verify the concurrency here — needs a
  human." Calibration is the entire value.
- **The merge decision stays with an accountable human** (or a
  clearly-accountable agent operating under explicit policy) — not with
  an unread approval.
- **Keep the signal high.** An AI that emits forty low-value comments
  trains people to ignore it; prioritise and label exactly as a human
  reviewer should (`severity-and-prioritisation.md`,
  `giving-feedback.md`).

## The anti-patterns automation is meant to kill

- **Rubber-stamping** — solved by accountability and never approving the
  unread (human or AI).
- **Style bikeshedding** — solved by a formatter/linter gate.
- **"Works on my machine"** — solved by CI running the real checks.
- **Slow reviews from oversized changes** — solved by author discipline
  (`author-side.md`) plus an AI first-pass that lets humans focus.

Automation removes the toil so the human review can be what it should
be: a thoughtful, timely judgement about whether the system is getting
healthier.
