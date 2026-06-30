---
name: visual-recap
description: >-
  Turn a completed change — a PR, branch, commit or git diff — into a
  high-altitude, GROUNDED before/after recap a reviewer reads to grasp the SHAPE
  of the work before the line-by-line diff: a file-tree of what moved,
  before/after data-model and API-contract summaries, annotated diffs of the key
  files, a Mermaid diagram for architecture/data-flow shifts, and a short outcome
  narrative. Every structured block is built MECHANICALLY from the real diff via
  plain git/gh — never invented, because a confidently-wrong recap is worse than
  none. Use whenever asked to summarise/explain/recap a change, "what does this
  PR do", "write the PR description", "walk me through the diff", a pre-review
  hand-off, or release notes for a change set. Plain Markdown + Mermaid, no hosted
  service. Redacts secrets and gates visibility for private repos. The line-by-line
  review itself → code-review-development; secret/redaction depth → secure-development;
  API-contract semantics → api-development; migration safety → sql-development.
---

# Visual Recap

How to summarise a *completed* change so a reviewer grasps its **shape** — what
files moved, which contracts shifted, where the risky lines are, and what the
change achieves — **before** wading into the line-by-line diff. It is the
after-the-fact mirror of `visual-plan` and the author-side complement to
`code-review-development`: the shape-first map that makes a large diff reviewable.

The recap's entire value rests on one discipline: **it is true by construction.**
Every structured block is derived mechanically from the real diff using plain
`git`/`gh` — the model writes only the *why*. A fluent summary that misstates one
line is *more* dangerous than no summary, because reviewers over-trust a confident
recap and skip the very line it got wrong (automation complacency). Built on open
primitives — git, GitHub-flavoured Markdown, Mermaid — it ships as a Markdown
artefact (a `RECAP.md`, a PR-description body via `gh`) with no hosted service.

## Non-negotiables

1. **Grounded, true by construction.** `file-tree`, before/after contract tables,
   data-model/API blocks and annotated diffs MUST come from real diff output —
   real paths, real fields, real method/path, real before/after lines — never
   inferred, rounded or invented. If the diff doesn't prove it, leave it out or
   mark it explicitly as an inference (`references/diff-to-blocks.md`,
   `references/grounding-and-security.md`).
2. **Recap the whole work unit, at altitude.** Cover the entire change under
   review (feature + fixes + tests + generated artefacts), not just the last
   commit — but state *what* changed and *why*, never re-narrate the *how* line by
   line. The diff already holds the how.
3. **Before/after is the headline.** A reviewer needs the *delta*, not just the
   new state. Render contract and schema shifts as paired before/after tables (or
   paired diagrams); for code, use split diffs (`references/before-after.md`).
4. **Lean but substantial.** Omit boilerplate ("this recap aids review", file
   counts the tree already shows). But a lone wireframe plus one sentence
   under-serves a large change: include the file-tree and annotated diffs of the
   key files. Lean ≠ thin (`references/recap-anatomy.md`).
5. **Annotate the key files only.** Pick the highest-signal changed files (by
   change kind, churn, or contract files like `openapi.yaml`/migrations) and quote
   their real hunks with a one-line "why this matters" caption. Quoting every hunk
   just recreates diff fatigue.
6. **Redact secrets before embedding.** A diff can contain keys, tokens, `.env`
   values, connection strings. Scan the diff and mask anything credential-shaped
   (`sk-•••`, `<redacted>`) before any hunk enters the recap — the recap is a new
   artefact that re-exposes whatever the diff leaks (`references/grounding-and-security.md`).
7. **Gate visibility for private repos.** A recap inherits the repo's
   confidentiality and can expose unreleased schema, internal endpoints and
   architecture. Default to writing a local Markdown file; never auto-publish to a
   public surface; require explicit opt-in before posting anywhere external.
8. **Flag, don't paper over, an unreviewable change.** If the change is large
   enough that it should have been split, say so in the recap rather than making a
   1000-line PR feel fine.

## Canonical shape

Top to bottom; include only what the change needs (`references/recap-anatomy.md`):

1. **UI-impact headline** — wireframes/Mermaid, *only if* there's a visible UI or
   architecture change.
2. **Outcome narrative** — 1–3 short paragraphs: what changed, why, key decisions,
   risks. The only place the model writes freely.
3. **Contract blocks** — before/after `data-model` (schema) and `api-endpoint`
   tables for any contract shift.
4. **File-tree** — changed files with `added`/`modified`/`removed`/`renamed`
   flags.
5. **Key changes** — annotated split diffs of the 3–8 highest-signal files (each
   with a one-line summary). Collapse long files behind `<details>`.

Budgets that keep it reviewable: 3–8 key-change excerpts; under ~150 lines per
excerpt (summarise/link longer); title ≤ ~70 chars; brief 1–3 sentences.

## Diff → block mapping

Build each block mechanically from the diff (`references/diff-to-blocks.md` has
the exact git commands):

| Change in the diff | Recap block |
|---|---|
| Files added/removed/renamed | `file-tree` with `change` flag per entry |
| Schema / migration change | before/after `data-model` table (route depth → `sql-development`) |
| API / route / contract change | before/after `api-endpoint` (route depth → `api-development`) |
| Any load-bearing code hunk | split `diff` fence + one-line caption + a few annotations |
| Brand-new file (no "before") | annotated code fence |
| Architecture / data-flow shift | Mermaid `flowchart`/`sequence` from *real* modules |
| Outcome / risk / breaking-change | `rich-text` prose (the only free-written block) |

Extract the raw material with `git diff --name-status` and `--numstat` (use `-z`
for safe pathname parsing), `A...B` (merge-base) for "what this branch
introduces", and `git range-diff` for "what changed since the last review pass".
`gh pr diff <n>` fetches a PR's diff. GitHub renders fenced ```` ```mermaid ````
inline in PR bodies (verified June 2026).

## Workflow

1. **Collect the diff** with the git/gh primitives above; resolve the right range.
2. **Scan for secrets** (e.g. gitleaks `--redact`, TruffleHog) and confirm
   visibility scope for the repo.
3. **Map mechanically** — emit the file-tree, contract before/after, and key-file
   diffs straight from the diff output.
4. **Write the why** — the outcome narrative and risk read; label any inference.
5. **Check & deliver** — confirm Mermaid parses; write `RECAP.md` or hand off via
   `gh pr edit`/`gh pr comment` only at the gated visibility.

## Pitfalls

- **Confidently wrong** — a summary that misstates a line; every claim must trace
  to diff output.
- **Re-narrating the how** — retyping the diff in prose instead of giving shape.
- **Invented diagrams** — an architecture diagram from imagination, not from real
  changed modules; diagrams read as authoritative, so a wrong one is worst.
- **Inferred contract** — stating an API/schema change read from handler code
  rather than diffed from the OpenAPI/DDL artefact.
- **Leaking secrets** — embedding hunks without scanning/redacting first.
- **Wrong range** — `A..B` vs `A...B` mis-scopes the whole recap; missing `-z`
  mangles renamed/spaced paths.
- **Over-annotating** — quoting every hunk; **broken Mermaid** — shipping a
  diagram that degrades to raw text.

## Reference index

Load on demand:

- `references/recap-anatomy.md` — the canonical skeleton, the budgets,
  lean-but-substantial, and a good-vs-bad worked example.
- `references/diff-to-blocks.md` — the mechanical mapping from each change type to
  a recap block, with the exact `git`/`gh` commands (`--numstat`, `--name-status`,
  `-z`, ranges, `range-diff`, `gh pr diff`) to extract each.
- `references/before-after.md` — the before/after headline discipline, paired
  tables vs after-only, Conventional Commits for the narrative and mechanical
  breaking-change detection, and flagging oversize changes.
- `references/grounding-and-security.md` — true-by-construction and automation
  complacency, secret scan-then-redact, and visibility gating for private repos.

## Boundaries

- **The line-by-line review and its judgement** → `code-review-development`; this
  skill is the author-side shape-first map that *precedes* it.
- **Secret-handling depth and what counts as a secret** → `secure-development`;
  this skill applies the scan-then-redact gate.
- **API contract semantics** (additive vs breaking, OpenAPI as source of truth) →
  `api-development`; **schema/migration safety** → `sql-development`.
- **Richer, exportable standalone diagrams** → `drawio-development`; this skill
  uses inline Mermaid for lightweight shifts.
- **Running the recap in CI** (a GitHub Action building it from the PR diff,
  SHA-pinned, posting via `gh`) → `devops-development`.
