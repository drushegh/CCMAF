---
name: read-the-damn-docs
description: >-
  Ground claims in official, version-matched documentation and the installed
  source — not training memory — whenever working with a third-party API,
  library, framework, CLI, SDK or cloud service, with fast-moving product
  behaviour, or with high-stakes auth/security/billing/migration/deployment work.
  Verify a symbol, endpoint, parameter or package EXISTS in the version you ship
  before you call or install it. Use whenever about to call an unfamiliar API,
  add or upgrade a dependency, debug a version/deprecation error, or answer
  anything about "latest/current/official" behaviour; PROACTIVELY consult docs
  rather than recalling. Treating recalled package names as real is a security
  hole (package hallucination / slopsquatting), not just a quality one. Built on
  open primitives — llms.txt, registry metadata, lockfiles, semver, official
  changelogs. Supply-chain depth → secure-development; scholarly citation
  discipline → academic-research; per-ecosystem registries → the language skills.
---

# Read The Damn Docs

The discipline of verifying external behaviour against **official, current,
version-matched documentation** (and the source actually installed on disk)
rather than recalling it from training memory. Model memory of API shapes,
parameter names, flags, endpoints and especially *package names* is provably
unreliable — and for packages, unverified recall is an **attack surface**, not
just a bug surface.

This is the engineering sibling of `academic-research`'s citation discipline:
*"never cite what you have not inspected"* becomes **"never call what you have not
verified exists in the version you ship."** It is built on open primitives
(`llms.txt`, registry APIs, lockfiles, semver, official changelogs) so it depends
on no proprietary docs service.

## Non-negotiables

1. **Pin the version question first.** Resolve what version the project actually
   runs — from the lockfile / `pip freeze` / `npm ls` — *before* reading any docs,
   and read the docs **for that version**. "Latest" docs describing an API the
   project hasn't upgraded to is itself a drift bug.
2. **Read primary sources, in hierarchy order** (below). Official, version-matched
   docs and the installed source outrank everything; Stack Overflow and dated
   blogs are a last resort, always re-verified and never date-blind.
3. **Read-then-verify, then write.** Locate the authoritative source → read the
   version-matched section → confirm the exact symbol/endpoint/parameter/flag
   exists with the signature you intend → *only then* write code. "I'm fairly sure
   the method is called X" is an unverified claim, the API equivalent of an
   uninspected citation.
4. **Verify a package exists before adding it — this is security.** Models invent
   plausible package names; attackers pre-register the common ones (*slopsquatting*).
   Before adding any dependency, confirm it via the registry (`npm view <pkg>
   version`, `pip index versions <pkg>`, or the registry JSON) *and* sanity-check
   owner, age and download count. A brand-new package with the exact name you
   "remembered" is a red flag, not a lucky find (`references/anti-hallucination.md`).
5. **Treat drift errors and deprecation warnings as routing signals.**
   `ImportError: cannot import name`, `AttributeError: module has no attribute`,
   and `DeprecationWarning` mean installed code no longer matches the recalled
   shape. Stop, identify installed-vs-expected version, open the changelog/migration
   guide, and fix to the documented current API — never suppress the warning.
6. **Read changelogs through a semver lens.** MAJOR = expect breakage, find the
   migration guide; MINOR may carry a deprecation you must heed now; scan for
   *deprecated/removed/breaking/migration* and the from→to mapping before
   upgrading or trusting recalled shape.
7. **Pin and lock so the verified version is the installed version.** Commit
   lockfiles with integrity hashes; install with `npm ci --ignore-scripts` /
   `pip install --require-hashes`; prefer provenance-attested packages.
   Verification without pinning is incomplete.
8. **Record what you grounded against.** For any non-obvious API decision, note the
   source URL and the doc's version/date, so a future reader (or eval) can
   re-verify — the engineering analogue of a reproducible search.
9. **Docs/source win over memory, and over each other in order.** When the docs
   and your recollection conflict, the docs win. When two sources conflict, the
   higher tier (and the version-matched one) wins.

## The source hierarchy

1. **The project itself** — checked-in docs, tests, examples, the lockfile, and
   the *installed* source/type stubs (`node_modules` `.d.ts`, site-packages,
   `pip show`, `go doc`). The most authoritative "docs" of all, already on disk.
2. **Official docs + release notes/changelog** for the exact pinned version.
3. **Registry metadata** — npm/PyPI/crates.io JSON (existence, versions, owner).
4. **Upstream source / types** on the repo.
5. **Last resort, always re-verified:** Stack Overflow, blogs — never date-blind.

## When grounding is mandatory

| Trigger | Why |
|---|---|
| User says "latest / current / official" | Memory is a snapshot; they want now |
| Adding or upgrading a dependency | Existence + version + breaking changes |
| Calling an unfamiliar third-party API/SDK/CLI | Symbol/param/flag may be misremembered |
| Auth, security, billing, payments, migration, deployment | Hard to reverse; high blast radius |
| A version-mismatch or deprecation error appeared | Confirmed drift — read the delta |
| Local ADRs/schemas/specs exist | Project decisions outrank generic advice |

## Tooling for fetching current docs (date-stamped — re-verify)

Open primitives first, MCP accelerators second, scraping last (verified June 2026;
this landscape shifts quarterly — re-verify before relying on any one):

- **`llms.txt` / `llms-full.txt`** — a curated, LLM-readable docs index at a site's
  root (`/llms.txt`). Near-mainstream but only ~10% adoption and not honoured by
  every crawler, so it's a convenience, not a guarantee.
- **Markdown endpoints** — many sites serve authoritative text directly: Stripe's
  `.md` suffix, Vercel's `/llms.txt`, `Accept: text/markdown` content negotiation —
  low-token, no scraping, no intermediary.
- **Docs-retrieval MCPs as accelerators, not authorities** — Context7
  (version-pinned library docs; MIT server, proprietary hosted backend), DeepWiki
  (free, no-auth whole-repo Q&A over public GitHub). An MCP that returns a snippet
  for the wrong version is still drift; the official version-matched docs and the
  installed code remain ground truth.
- **Registry/CLI existence checks** — `npm view`, `pip index versions`, `pip show`,
  `npm ls`, `go doc`, the registry JSON.

Depth and the current landscape: `references/source-hierarchy-and-tools.md`.

## Process

1. **Identify the surface** — which library/API/version, and what the project
   already pins.
2. **Find the authoritative source** — `llms.txt`/`.md` endpoint/official docs for
   that version; or read the installed source/types.
3. **Read & extract** the exact facts (signature, params, flags, return shape).
4. **Verify existence** for any new dependency via the registry; pin + lock.
5. **Implement**, then **verify with a minimal smoke test** that the call behaves
   as the docs say.
6. **Record** the source URL + version for non-obvious decisions.

## Pitfalls

- **Trusting memory** for symbol/param/flag/endpoint and especially package names
  (still ~5–6% package-hallucination on 2026 frontier models — see
  `references/anti-hallucination.md`).
- **Installing a "recalled" package** without verifying it's the real, established
  one — the slopsquatting surface.
- **Version-mismatched grounding** — reading latest docs against an older pin.
- **Trusting a snippet as ground truth** — `llms.txt`/Context7/DeepWiki/SO can lag
  or be wrong-version; none override official version-matched docs + installed source.
- **Suppressing a deprecation/drift error** instead of reading the migration guide.
- **Cross-ecosystem name confusion** — assuming an npm name maps to the same PyPI
  name.
- **Date-blind sourcing** — following a blog without checking its date against the
  release timeline.

## Reference index

Load on demand:

- `references/source-hierarchy-and-tools.md` — the source hierarchy in depth,
  pin-the-version-first, `llms.txt`/`llms-full.txt`/`.md`/content-negotiation, the
  docs-MCP landscape (Context7, DeepWiki) as accelerators, and reading installed
  source/types (date-stamped, re-verify).
- `references/anti-hallucination.md` — package hallucination and slopsquatting as
  a security issue (rates, repeatability, registrable names), invented APIs/params,
  registry existence/version checks, cross-ecosystem confusion, and
  lockfiles/hashes/provenance/`--ignore-scripts`.
- `references/verify-and-drift.md` — the read-then-verify loop, reading semver and
  changelogs, deprecation warnings and drift errors as routing signals, the minimal
  smoke test, and recording what you grounded against.

## Boundaries

- **Supply-chain / dependency security depth** (SBOM, provenance, the full attack
  taxonomy) → `secure-development`; this skill owns the *verify-before-call/install*
  habit and the slopsquatting hygiene.
- **Scholarly, peer-reviewed citation integrity** → `academic-research`; this skill
  is the engineering analogue for code/APIs.
- **Catching hallucinated APIs/packages in review** → `code-review-development`
  (its AI-generated-code pass).
- **Per-ecosystem registry/lockfile/toolchain specifics** → the language skill
  (`python-development`, `typescript-development`, `rust-development`,
  `dotnet-development`, …); **fetching docs from the live web** is your WebFetch/
  WebSearch tooling.
