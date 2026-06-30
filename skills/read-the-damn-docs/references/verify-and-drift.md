# Verify and drift

The mechanics of the read-then-verify loop, reading changelogs through a semver
lens, and treating drift errors as routing signals. The parent SKILL.md states
*that* you ground claims; this file is *how* you confirm a symbol exists, *how*
you read a changelog for a from→to mapping, and *how* you recover when installed
code no longer matches recalled shape. Source hierarchy and fetching tools live
in `source-hierarchy-and-tools.md`; package-existence and slopsquatting hygiene
in `anti-hallucination.md`.

## The read-then-verify loop

Five steps, in order, no shortcuts:

1. **Locate** the authoritative, version-matched source for the version the
   project actually pins (lockfile / `pip freeze` / `npm ls` first). Latest docs
   against an older pin is itself drift.
2. **Read** the relevant section — the signature, parameters, defaults, return
   shape, raised errors.
3. **Confirm** the exact symbol/endpoint/parameter/flag exists *with the
   signature you intend to call*. Not "a method like this exists" — *this* name,
   *these* params, *this* arity.
4. **Write** the code — only now.
5. **Verify** with a minimal smoke test that it behaves as documented (below).

"I'm fairly sure the method is called X" is an **unverified claim** — the API
equivalent of an uninspected citation (`academic-research` makes the same move
for scholarship). Confirmation is one `go doc`, one `.d.ts` grep, one `pip show`
away; the cost of skipping it is a runtime `AttributeError` or, worse, code that
silently calls the wrong overload.

```
recall ──▶ locate version-matched source ──▶ read ──▶ symbol exists as expected?
                                                          │ no
                                                          ▼
                                              changelog / migration guide ──┐
                                                          │ yes              │
                                                          ▼                  │
                                              write ──▶ smoke test ◀─────────┘
```

## The minimal smoke test

A 5–15 line throwaway that exercises *only* the call you just grounded: import
the symbol, invoke it with the real signature, assert the documented shape comes
back. It catches version drift, wrong defaults, and misremembered return types
before they reach real code. This is a *grounding* check, not a test suite —
suite design, fixtures and coverage belong to `testing-development`.

```python
# Smoke test: does urllib3 v2's Retry expose `backoff_max` as documented?
from urllib3.util.retry import Retry
r = Retry(total=3, backoff_factor=0.5, backoff_max=30)  # raises TypeError if drifted
assert r.backoff_max == 30
```

If the smoke test needs a parameter the installed version rejects, you have
caught drift at the cheapest possible point.

## Reading changelogs through a semver lens

Semantic Versioning 2.0.0 (semver.org) gives changelogs a grammar you can read
mechanically:

| Bump | Meaning per spec | What you do |
|---|---|---|
| **MAJOR** | Any backward-**incompatible** public-API change | Expect breakage; find the migration guide *before* upgrading |
| **MINOR** | Backward-compatible additions **OR** any public API marked **deprecated** | Read it now — a deprecation lands here, ahead of removal |
| **PATCH** | Backward-compatible bug fixes only | Safe to take; still skim |

The load-bearing rule: **a deprecation MUST land in a MINOR release before the
API can be removed in the next MAJOR.** That is the early-warning signal you read
in changelogs — the deprecation note in `2.x` is your map to what `3.0` deletes.

Before upgrading, or before trusting a recalled API shape, scan the changelog
for **deprecated / removed / breaking / migration** and capture the **from→to
mapping** (old name → new name, moved import path, renamed parameter). A MAJOR
bump without a located migration guide is an unfinished upgrade. **Keep a
Changelog** (keepachangelog.com) and **GitHub Releases** are the canonical drift
sources; the version-matched official docs and installed source remain ground
truth above either.

## Drift errors and deprecation warnings are routing signals

These three are not bugs to patch in place — they are the runtime telling you
your recalled API shape no longer matches what is installed:

- `ImportError: cannot import name X from Y` — symbol moved, was renamed, or
  removed.
- `AttributeError: module Z has no attribute W` — same, on the attribute path.
- `DeprecationWarning` — still works *today*; **treat it as a future error**.

The response is always the same routing move, never suppression:

1. **Stop.** Do not reach for `warnings.filterwarnings("ignore")`, a `# type:
   ignore`, or a `try/except ImportError` that papers over the delta.
2. **Identify installed-vs-expected version** (`pip show <pkg>`, `npm ls <pkg>`).
3. **Open that library's changelog / migration guide** for the delta — e.g.
   urllib3's v2 migration guide for `Retry`/`PoolManager` changes (verified June
   2026; re-verify at the project's pinned docs).
4. **Fix to the documented CURRENT API**, applying the from→to mapping.

Suppressing a `DeprecationWarning` converts a today-cheap fix into a
next-major-version outage. The warning *is* the migration ticket.

## Record what you grounded against

For any non-obvious API decision, leave a trace a future reader — or an eval —
can re-verify: the **source URL** and the **doc's version/date**.

```python
# urllib3 2.x moved Retry.backoff_max out of the constructor's **kwargs;
# verified against urllib3 2.2 docs, June 2026: <docs-url>#retry
```

This is the engineering analogue of a reproducible literature search
(`academic-research`): the grounding is inspectable, so the claim is auditable
and the next upgrade starts from a known anchor rather than fresh recall.

## Where ecosystem specifics live

The *loop* and the *semver reading* are language-agnostic. Per-ecosystem
mechanics — `go doc` vs `.d.ts` stubs vs `pip show`, registry existence checks,
lockfile and toolchain conventions — route to the language skills
(`python-development`, `typescript-development`, `rust-development`,
`dotnet-development`, …). Catching ungrounded calls in review →
`code-review-development`.
