# Grounding and security

The recap's value is borrowed from the diff. Two disciplines protect that loan:
**true by construction** (every structured block is extracted, never authored) and
**the security gates** every block must pass before it leaves the working tree.
This file goes deeper than the parent skill's non-negotiables 1, 6 and 7 — the
*why* and the exact mechanics. Secret-handling depth lives in `secure-development`.

## True by construction

A structured block — `diff`, `data-model`, `api-endpoint`, `file-tree` — is
trustworthy **only** if every token in it came off the actual changed lines:

- **Real paths** from `--name-status`/`-z`, not a path you expect to exist.
- **Real fields** from the diffed DDL/schema artefact, not read off a handler.
- **Real method/path** from the diffed route/OpenAPI artefact.
- **Real before/after text** quoted verbatim from the hunk — not paraphrased,
  rounded ("~40 lines") or reconstructed from memory.

The model contributes exactly one thing: **prose** — the *why*, the risk read,
the one-line caption. Everything load-bearing is mechanical (see
`references/diff-to-blocks.md` for the commands).

The rule when the diff is silent:

> If the diff does not contain a fact, **leave it out** — do not guess.
> Anything you reason to (not extract) is **marked as inferred**.

```text
data-model (extracted):   users.email  VARCHAR(255) -> CITEXT      [from migration hunk]
note (inferred):          likely case-insensitive login now        (inferred — not in diff)
```

The discipline is asymmetric: an omission is a gap a reviewer can fill; an
invented fact is a trap a reviewer walks into. Prefer the gap.

## Why this is non-negotiable: automation complacency

A recap is *reliable automation*, and reliable automation breeds over-trust. The
failure mode is well documented in human-factors research:

1. The summary is fluent, well-formatted and usually right.
2. Reviewers calibrate to "usually right" and stop checking the blocks.
3. They skip the very line the recap got wrong — the one place checking mattered.

Operators catch only a **minority — directionally ~30%** — of errors produced by
otherwise-reliable automation (directional figure from human-factors research,
re-verify; the exact number varies by study and task). So a confidently-wrong
recap is **more dangerous than no recap**: no recap forces the reviewer to read
the diff; a wrong recap actively steers them away from the defect.

A **plausible-but-wrong diagram is the worst block of all.** A diagram reads as
authoritative — synthesised, deliberate, "someone modelled this" — so it gets the
least scrutiny and the most trust. A Mermaid `flowchart` drawn from imagination
rather than from real changed modules is the single highest-leverage way to
mislead. Diagram only what the diff proves moved.

## Secret scan-then-embed

A diff is a rich source of live credentials: API keys, OAuth/bearer tokens,
webhook URLs, signing secrets, `.env` values, database connection strings, private
keys. Embedding a hunk re-exposes whatever the diff leaks — into a **new** artefact
that is easier to share than the diff was. So:

> **Scan the diff with a secret scanner BEFORE any hunk enters the recap.** Redact
> at extraction time, never "clean it up afterwards".

Tooling (landscape moves fast — re-verify flags June 2026):

- **gitleaks** — `--redact` masks matches in output; SARIF output for CI gating.
- **TruffleHog** — classifies 800+ secret types and can **verify** whether a found
  credential is actually live (a live hit is a stop-the-line event).
- `detect-secrets`, GitGuardian — alternatives; flags and detector sets drift, so
  confirm against current docs.

Mask any credential-shaped literal to an **obviously-fake** form — `sk-•••`,
`<redacted>`, `postgres://•••@•••/db` — in **every** surface: block body, caption,
note, diagram label, commit-message quote. **Mirror the repo's own hardcoded-secret
rule**: the only credential string that may ever appear is one that is plainly a
placeholder; a real value never appears anywhere, full stop. What counts as a
secret, and how to redact without destroying reviewability →  `secure-development`.

Running the scan as a **CI gate** (so a recap can't be generated over an unscanned
diff) → `devops-development`.

## Visibility gating

A recap **inherits the confidentiality of the repo it summarises.** A private-repo
recap can expose unreleased schema, internal-only endpoints, architecture and
naming long before any of it is public. Treat publication as a privileged action:

1. **Default to a LOCAL Markdown file** in the working tree (`RECAP.md`). This is
   the safe default and needs no opt-in.
2. **Never auto-publish** to a public or broadly-shareable surface.
3. Posting externally requires **explicit opt-in AND a redaction confirmation** —
   two distinct acknowledgements, not one.
4. A **private-repo hand-off note** must set reader expectations about access:

   > Private repo — sign in with access to this org if the recap does not load.

| Surface | Default | Gate to clear |
|---|---|---|
| `RECAP.md` in the working tree | yes | none |
| `gh pr comment` / `gh pr edit` (same private repo) | on request | redaction confirmed |
| Any public/shareable surface | never automatic | explicit opt-in + redaction confirmed |

When in doubt, write the file and stop — let a human move it outward.

## Deliver on open primitives

The recap ships as plain artefacts, never to a hosted service:

- Write **`RECAP.md`** in the working tree (the default), or
- Hand off via **`gh pr edit`** (PR-description body) or **`gh pr comment`**.

GitHub renders fenced ` ```mermaid ` inline in PR bodies (verified June 2026).
No proprietary plan/recap service is involved at any step — git, GitHub-flavoured
Markdown and Mermaid are the whole toolchain.
