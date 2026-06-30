# Before/after as the headline

The recap surfaces the **delta**, not the new state. A reviewer who sees only the
after must reconstruct the before from memory or the diff — the exact work the
recap was meant to save. The delta is also where the review risk lives: a removed
validation, a reordered control, a renamed column, a narrowed return type. Lead
with the change between two states and attention lands on the part that can break.
This file covers *how* to render the delta, *when* "before" earns its place, and
how to derive the narrative and breaking-change flag mechanically.

## Primitives: pick the form per change kind

| Change kind | Headline primitive |
|---|---|
| Data-model / schema shift | paired before-after table (two columns, one row per field) |
| API-contract shift | paired before-after table (method, path, params, status, body) |
| Architecture / data-flow shift | two Mermaid diagrams side by side (before, after) |
| Code hunk under review | **split diff** (before left, after right) — the recap default |
| Genuinely narrow standalone hunk | unified diff — only when split would waste width |

**Split is the recap default for code**: review legibility comes from seeing both
sides aligned, the eye comparing rows rather than tracking `-`/`+` prefixes down
one column. Reserve unified mode for a hunk so narrow that two columns would be
mostly whitespace (a one-line change, a single added guard).

A paired contract table makes the delta legible at a glance — one row per field,
a `Before` and `After` column, and a per-row marker on the cells that changed
(`status: string → enum(open,closed)` narrowed; `archived_at: — → timestamptz`
added; `legacy_id: int → —` removed). Don't make the reader diff two prose
paragraphs.

Route the *semantics* of these shifts elsewhere: schema/migration safety →
`sql-development`; additive-vs-breaking contract semantics → `api-development`.
The recap renders the delta; those skills judge it.

## When "before" earns its place

Showing both states costs space and attention; spend it only where the before
carries information:

- **Purely additive change** (new file, new endpoint, new column with a default,
  new function) → **after-only**. There is no meaningful prior state; a "before:
  nothing" column is noise.
- **A removed or changed control, a density/ordering/navigation change, or a
  component replacement** → **show before AND after**. The value is precisely in
  what was there and is now gone or different.
- **A multi-step UI change** → show the **meaningful states in order** — entry
  surface → opened surface → resulting state (e.g. `[Export]` button →
  format-picker menu → `✓ queued` toast) — so the reviewer can trace the path, not
  just compare endpoints. Skip intermediate frames that carry no decision.

The test: would the reviewer have to *reconstruct* the prior state to assess the
risk? If yes, show it. If the change only adds, the before is dead weight.

## The outcome narrative: WHAT and WHY, never HOW

The narrative is the one freely-written block (per the parent skill's canonical
shape). Lead with **what** changed and **why**; never re-narrate the **how** — the
diff already holds it, and prose that retypes the diff just recreates diff fatigue.

A title gives the reviewer the most leverage per character, so make it carry
**component + problem + impact**:

- Weak: `Fix bug`
- Strong: `Fix race condition in session cleanup that caused 502s under load`

The strong title names where (session cleanup), what (race condition) and the
consequence (502s under load) — the reviewer knows the blast radius before reading
a line. Same rule for the body: state the decision and its risk, not the edits.

## Mechanical breaking-change detection

Do not assert "this is a breaking change" from the model's reading of the code —
assert it from a **parsed marker**. Conventional Commits gives that marker:

```
type(scope): description

feat(api): add cursor pagination to /orders
fix(auth)!: reject tokens missing aud claim     ← ! marks breaking
refactor(db): split user table

BREAKING CHANGE: aud claim now required on all tokens
```

The `!` after `type(scope)` and a `BREAKING CHANGE:` footer are the two breaking
signals. Tooling — `release-please`, `conventional-changelog`, `git-cliff`,
`semantic-release` — parses commit metadata to derive a grouped, type-labelled
summary (Features / Fixes / Breaking) and the semver bump. The recap's
breaking-change flag should come from that parsed marker, not the model's
judgement: grounded by construction, consistent with what the release tool emits.
If the marker is absent but the diff looks breaking, surface it as an *inference
to verify*, not a fact, and route a contract break to `api-development` (a schema
break to `sql-development`). Wiring this into a release pipeline →
`devops-development`.

## Flag oversize changes

The recap must serve a large change *and* flag when it should have been split.
Review quality degrades sharply once a change runs past roughly **200–400 changed
lines**; beyond that, reviewers exhibit **scope insensitivity** — spending similar
effort on a 100-line and a 1000-line change — and very large PRs attract few
meaningful comments (mostly nits or a bare approval). Treat these figures as
**directional, not precise** (June 2026; re-cite primary research — SmartBear,
Google/CACM, McIntosh et al. — before quoting exact numbers).

So:

1. Compute size from `--numstat` (added + deleted, excluding generated/vendored
   and lockfiles — see `diff-to-blocks.md`).
2. If it crosses the threshold, **say so in the recap**: "~1,400 changed lines
   across 3 concerns; consider splitting migration / endpoint / UI into separate
   reviews." Don't make a 1000-line PR *feel* fine — the failure mode the parent
   skill's non-negotiable forbids.
3. Still produce the best possible recap for the change as it stands; the flag
   informs the next PR, not this one's mergeability.

The shape-first map plus an honest size flag is what makes an oversize change
reviewable at all — and tells the author where the next cut line should fall.
