# Agent skills authoring

Skills are progressive-disclosure instruction packages: a folder whose
`SKILL.md` description sits in the agent's context permanently, with the
body and `references/` loaded only when triggered. The format is
specified at agentskills.io (Anthropic's spec; June 2026 — check for
revisions). This file covers authoring them well — including the skills
in this repository.

## Anatomy

```
skill-name/
  SKILL.md          # frontmatter (name, description) + always-loaded body
  references/       # depth files, loaded on demand
  scripts/          # optional executable helpers (agents run, not read)
  assets/           # optional templates/data the skill uses
```

- `name` matches the directory exactly; lowercase, hyphenated.
- `description` < 1024 chars. It is the **only** part the agent sees
  before deciding to load the skill — spend it on triggers.
- Body budget ~100–180 lines: standards, decision tables, pitfalls,
  workflow, reference index. Push everything deep into `references/`
  (60–110 lines each, one topic per file).
- Every reference listed in the index exists on disk, and vice versa.

## Trigger descriptions (where skills fail)

Weak: "Guidance for working with SQL databases."
Strong: names concrete artefacts, verbs and situations — file
extensions, error messages, library names, task phrasings — and tells
the agent to activate proactively. Write it as retrieval bait: what
will be in the conversation when this skill should fire? Include
negative space only when misfiring is a real cost ("do NOT use for X —
use sibling-skill instead").

## Writing for an agent audience

- Imperatives and tables over prose essays; the reader is deciding what
  to do next, not studying.
- Decision tables for choices, not balanced discussion. An agent needs
  a default and the conditions that override it.
- Convert "ask the user" into decide-and-flag (state the assumption,
  proceed, surface it) unless the fork is genuinely blocking.
- Code blocks must parse — verify with a real toolchain and note where
  no parser exists. An agent will copy your example verbatim into
  production.
- Date-stamp fast-moving claims with a re-verify instruction; a skill
  asserting "the latest model is X" goes stale silently.
- Cross-reference sibling skills at boundaries instead of duplicating
  — duplicated guidance drifts and gives the agent two conflicting
  opinions.
- No "ignore previous instructions"-shaped phrasing anywhere, even in
  examples — security scanners (rightly) flag instruction-injection
  patterns in skill files.

## Progressive disclosure discipline

The skill's cost model: description always in context (cheap, permanent),
body on trigger (moderate), references on demand (paid only when used).
Optimise accordingly:

- Hot-path rules (non-negotiables, top pitfalls) in the body; worked
  examples and API detail in references.
- One reference per task-shape, named for retrieval
  (`query-tuning.md`, not `misc.md`), so the agent loads one file, not
  three.
- Scripts for anything deterministic (validation, scaffolding,
  conversion) — agent-executed code beats agent-paraphrased
  instructions for reproducibility.

## Evals for skills

Treat a skill like a prompt: define tasks that should trigger it and
tasks that shouldn't, plus output-quality checks for when it fires.

- **Trigger evals**: representative phrasings → does the agent load the
  right skill (and not load it for near-miss tasks)?
- **Behaviour evals**: with the skill loaded, does the agent follow the
  non-negotiables (run a task whose naive solution violates one)?
- **A/B**: same task with and without the skill; the skill must
  demonstrably change behaviour or it's dead weight in the description
  budget.
- Iterate on the description first when triggering fails; on body
  structure when the agent reads but ignores; on references when depth
  is wrong. Re-run after model upgrades — triggering behaviour shifts
  between model generations.

## Distribution

Skills travel as plain directories (or plugin bundles with
`.claude-plugin/` metadata). Keep them self-contained: no absolute
paths, no machine-specific assumptions, LF endings, plain Markdown.
Consumers sync by copying the directory — anything outside it does not
exist for them (this repository's framework contract in the root README
is the worked example).
