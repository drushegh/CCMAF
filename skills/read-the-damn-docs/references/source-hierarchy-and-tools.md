# The source hierarchy and the tooling

The parent SKILL.md lists the five tiers and names the tools. This file is the
*how*: reading each tier, pinning the version first, and the current open
doc-fetching landscape (verified June 2026; re-verify auth/hosting and coverage).

## Pin the version FIRST

Resolving the version is step zero, not a footnote. Reading "latest" docs against
an older pin is itself drift — you will confidently use a symbol the shipped code
does not have. Resolve, *then* read the docs for **that** version.

| Ecosystem | What's installed (authoritative) | What's requested |
|---|---|---|
| npm/pnpm/yarn | `npm ls <pkg>`, lockfile resolved version | `package.json` range |
| Python | `pip show <pkg>`, `pip freeze`, `uv.lock` | `pyproject.toml`/`requirements` |
| Rust | `cargo tree -p <crate>`, `Cargo.lock` | `Cargo.toml` range |
| Go | `go list -m <mod>`, `go.sum` | `go.mod` |
| .NET | `dotnet list package`, `packages.lock.json` | `.csproj` |

The lockfile's *resolved* version wins over the manifest range — the range is a
constraint, the lockfile is the fact. Per-ecosystem toolchain depth → the language
skills (`python-development`, `typescript-development`, etc.).

## The hierarchy, tier by tier

### 1. The project itself — already on disk, most authoritative

This tier outranks every website because it is the code that actually runs.

- **Installed source and type stubs.** `node_modules/<pkg>/**/*.d.ts` carry exact
  signatures; `site-packages/<pkg>/` *is* the implementation; `go doc <pkg>.<Sym>`
  renders doc comments for the pinned module; `cargo doc --open` builds from the
  locked source. Vendored source is ground truth by definition. `pip show -f`
  lists installed files; `npm view` is *remote*, so prefer `npm ls` + the on-disk
  `.d.ts` for what's actually installed.
- **Checked-in docs, tests, examples.** A package's own test suite is executable
  documentation of intended use; `examples/` and `README` show the sanctioned call
  shape for the version you have.
- **The lockfile** answers "what version?" and, via integrity hashes, "is it the
  real artefact?".

### 2. Official docs + changelog for the EXACT pinned version

Switch the docs site to the pinned version (most have a version selector or
`/v3.x/` path). Read the changelog/release notes *between your version and any
target* through a semver lens — see `verify-and-drift.md` for that loop.

### 3. Registry metadata — existence, versions, owner

JSON, no scraping: `registry.npmjs.org/<pkg>`, `pypi.org/pypi/<pkg>/json`,
`crates.io/api/v1/crates/<crate>`. This is also the existence/slopsquatting check
— owner, age, downloads — covered in `anti-hallucination.md`.

### 4. Upstream source / types on the repo

When installed source is ambiguous or you need history, read the tag matching your
version (**not** `main`). DeepWiki (below) accelerates Q&A over this tier.

### 5. Last resort — Stack Overflow, blogs

Never date-blind. Check the post's date against the release timeline; an answer
from before a major release may describe a removed API. Re-verify against tiers
1–2 before acting.

## llms.txt and llms-full.txt

A convention (llmstxt.org) for a Markdown file at a site's root, `/llms.txt`,
curating doc links for inference-time consumption. Proposed by Jeremy Howard
(Answer.AI), published 3 Sep 2024. Structure:

```markdown
# Project Name
> Optional one-line blockquote summary.
## Docs
- [Quickstart](https://example.com/quickstart.md): getting started
## Optional
- [Changelog](https://example.com/changelog.md)
```

Required H1 (project name), optional blockquote summary, H2 sections of links.
**`llms-full.txt`** inlines the entire doc text in one file for large-context
models — fewer round-trips, more tokens. It is distinct from `robots.txt` (a
*crawl policy*) and `sitemap.xml` (a flat *URL list*): `llms.txt` is a *curated
index for reading*. Adoption is ~10% of sites (June 2026);
Anthropic and Perplexity confirm consuming it, Google has **not** endorsed it — so
it is a convenience to exploit when present, never a guarantee.

## Markdown endpoints and content negotiation

Many sites serve authoritative text directly — low-token, no scraping, no
intermediary (verified June 2026; per-site coverage changes — re-verify):

- **`.md` suffix** — Stripe exposes a docs page as raw Markdown by appending `.md`.
- **Published `/llms.txt`** — Vercel publishes one; follow its links to `.md`.
- **`Accept: text/markdown` negotiation** — Cloudflare, Anthropic, and
  Mintlify-hosted docs honour the header, returning Markdown for the same URL.

Try these before any HTML scrape; full scraping mechanics → `web-scraping-development`.

## Docs-retrieval MCPs — accelerators, not authorities

MCP is an *open transport*, so these backends are interchangeable — and a snippet
for the **wrong version is still drift**. Official version-matched docs and the
installed code remain ground truth; treat MCP output as a fast lead to verify.

| Tool | Hosting / auth (June 2026) | Scope | Version control |
|---|---|---|---|
| **Context7** (Upstash) | MIT server, proprietary hosted parsing backend; API key for higher rate limits | Version-pinned library docs | Driven by the prompt, e.g. `/vercel/next.js` |
| **DeepWiki** (Cognition/Devin) | Free, remote, no-auth at `https://mcp.deepwiki.com/mcp` | Public GitHub repos (code + issues) | Repo/branch as addressed |

DeepWiki exposes `read_wiki_structure`, `read_wiki_contents`, and `ask_question`;
prefer the `/mcp` endpoint as the SSE transport deprecates. Context7's version
comes from *your* prompt, so an imprecise prompt fetches the wrong version's
snippet — pin it explicitly. Broader LLM-tooling/MCP design → `llm-development`.

## Routing

Package existence, slopsquatting, registry checks → `anti-hallucination.md`. Semver,
changelogs, deprecation/drift errors, the verify loop → `verify-and-drift.md`.
