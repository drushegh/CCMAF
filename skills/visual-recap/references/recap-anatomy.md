# Recap anatomy

The canonical skeleton, the budgets that keep it reviewable, and what "lean but
substantial" means in practice. The parent SKILL.md lists the five blocks; this
file is the assembly order, the per-block budgets, and a good-vs-bad worked
example. Build each block mechanically (`diff-to-blocks.md`); render before/after
as the headline (`before-after.md`); scan and gate before anything ships
(`grounding-and-security.md`).

## The skeleton, top to bottom

Emit in this order; include only the blocks the change actually needs.

1. **UI / architecture-impact headline** — wireframes (ASCII or image) for a
   visible UI change, a Mermaid `flowchart`/`sequence` for an architecture or
   data-flow shift. **Omit entirely** when nothing visible or structural moved —
   a CRUD-handler tweak gets no diagram. A wrong diagram is worse than none
   because it reads as authoritative.
2. **Outcome narrative** — 1–3 short paragraphs. The *only* freely-written block:
   the objective, the key decision, the compatibility risk. Everything below it
   is derived from the diff and must not be paraphrased here.
3. **Before/after contract blocks** — paired `data-model` (schema) and
   `api-endpoint` tables for any contract shift. Before *and* after, side by side
   — the delta is the headline, not the new state (`before-after.md`).
4. **File-tree** — every changed path with an `added`/`modified`/`removed`/
   `renamed` flag. This is the map; it belongs in any change worth recapping.
5. **Key changes** — annotated split diffs of the 3–8 highest-signal files, each
   under a `###` title with a 1–3-sentence brief and inline `# why this matters`
   annotations. Collapse long excerpts behind `<details>`.

```
[ headline diagram ]   ← only if UI/arch changed
outcome narrative      ← the only free-written prose
before/after contracts ← data-model + api-endpoint
file-tree (flagged)    ← the map
key changes ×3–8       ← annotated split diffs, highest-signal first
```

## Budgets

| Element | Budget | Why |
|---|---|---|
| Key-change excerpts | **3–8** | Fewer under-serves a large change; more recreates diff fatigue |
| Per-excerpt length | **< ~150 lines** | Longer: summarise the hunk in the brief, or link the file |
| Long excerpt | wrap in `<details>` | Keeps the scroll length reviewable; reviewer expands on demand |
| Excerpt title | **≤ ~70 chars** | Renders on one line in a PR/Markdown view |
| Per-excerpt brief | **1–3 sentences** | States *why it matters*; not a re-narration of the lines |

Picking the 3–8: rank by change kind and signal, not churn alone — contract
files (`openapi.yaml`, migrations, public interfaces) first, then load-bearing
logic, then the rest. A 12-line migration outranks a 400-line generated-client
diff.

## Lean but substantial

Lean means **omit boilerplate** — never write:

- "This recap aids review" / "reviewers should still read the full diff."
- File counts the tree already shows ("changed 25 files across 6 directories").
- Source-provenance prose ("generated from `git diff main...HEAD`").
- A re-narration of hunks already quoted below.

Add prose **only** when it conveys what the structured blocks cannot: the
objective, a real design decision, a compatibility/migration risk. If a sentence
restates a table or the tree, cut it.

Lean is **not** thin. The failure mode at the other end is a lone wireframe plus
one sentence standing in for a 25-file change. The file-tree and the key-file
diffs belong in *any* change worth recapping — dropping them forces the reviewer
straight back into the raw diff, which is the exact fatigue the recap exists to
remove.

## A GOOD recap (worked example)

A ~25-file change replacing session cookies with rotating refresh tokens. Its
blocks:

- **Headline** — before/after wireframes of the login + "session expired" flow,
  showing the new silent-refresh path (a real UI change, so it earns a diagram).
- **Narrative** — two paragraphs: *objective* (stop forced re-logins; shrink the
  token blast radius) and *risk* (existing cookie sessions are invalidated on
  deploy — every user re-authenticates once; flagged as the one breaking effect).
- **Contracts** — a `data-model` before/after for the `sessions` table (added
  `refresh_token_hash`, `rotated_at`; dropped `cookie_blob`), and an
  `api-endpoint` before/after for the new `POST /auth/refresh` route.
- **File-tree** — 25 paths, each flagged; the migration and the new route handler
  visually stand out as `added`.
- **Key changes** — exactly **five** annotated diff excerpts: the migration, the
  refresh-token issuer, the auth middleware, the rotation-on-use logic, and the
  test that proves an old token is rejected. Each has a one-line summary; the
  120-line middleware diff sits inside `<details>`.

Five excerpts for 25 files — not the migration alone, not all 25.

## BAD recaps (and the fix)

1. **Giant unsegmented dump** — one ```` ```diff ```` fence with every hunk, no
   titles, no summaries, no annotations. This *is* the raw diff with extra
   scrolling; it carries zero shape. **Fix:** segment into 3–8 titled, briefed,
   annotated excerpts; drop the rest.
2. **Sparse three-block recap of a 40-file change** — a wireframe, two sentences,
   and a file-tree, with no contract blocks and no key-file diffs. The reviewer
   learns *that* something changed but nothing about *what* the risky lines do,
   so they bounce straight to the raw diff. **Fix:** add the before/after
   contracts and 5–8 key-change excerpts — pay the substance the change demands.

Both fail the same test: **could a reviewer grasp the shape and find the risky
lines without opening the raw diff?** If not, it is either too thin or too raw.
