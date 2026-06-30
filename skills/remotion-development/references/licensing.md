# Remotion Licensing (read before committing to Remotion)

Remotion is **source-available, not open-source-free for everyone**. The
licence is a real commercial gate that teams routinely miss because the
code is on GitHub and `npm install` just works. This is a flag-to-the-
stakeholder item, not a coding detail. **Not legal advice** — the
authoritative texts are the
[LICENSE.md](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md),
[remotion.dev/docs/license](https://www.remotion.dev/docs/license) and
the [Company Licence FAQ](https://www.remotion.pro/faq). Terms and
prices change — **re-verify, don't quote this file as current truth.**

## Who may use it for free (per the official licence, June 2026)

- Individuals.
- For-profit organisations with **up to 3 employees**.
- Non-profit / not-for-profit organisations.
- Genuine evaluation (deciding whether it fits, not yet used
  commercially).

## Who must buy a Company Licence

Any **for-profit organisation with 4 or more employees** using Remotion
non-trivially. This catches most consultancies, agencies and product
companies — including small ones. If a team of four or more is building
or shipping anything with Remotion, assume a paid licence is required and
confirm before investing engineering time.

## The two commercial models (June 2026 — verify)

- **Remotion for Creators** — seat-based; a seat per person actively
  working on Remotion projects (editing compositions, using the Studio).
- **Remotion for Automators** — for programmatic/automated rendering
  pipelines; billed differently (developers on automation don't consume
  a creator "seat"). The `@remotion/licensing` package exists to help
  measure billable usage for this model.

Indicative pricing seen June 2026 (treat as volatile, confirm at
remotion.pro): roughly **$25 per developer/month**, with a **minimum
company charge around $100/month or $1,000/year**; Enterprise tiers add
private support and compliance/licensing support. Do **not** present
these numbers as fixed — pull live figures from remotion.pro when a
decision depends on them.

## How to handle it in practice

1. **Raise it at the decision point**, before building. "Remotion is the
   right tool technically, and it requires a paid Company Licence for a
   for-profit company of this size — current terms at remotion.pro"
   is the honest framing.
2. **Don't assume free.** Treat the absence of a licence as a blocker to
   flag, not a default to proceed on.
3. **Separate the libraries.** The core `remotion` runtime and
   `@remotion/*` packages fall under this licence. Some adjacent
   templates/products (e.g. paid starters) have their own terms — check
   per package.
4. **Record the decision.** If a licence is bought, note the seat/automator
   count and renewal; if relying on the free tier, record the basis
   (headcount/non-profit/evaluation) so it's defensible later.

The technical content of this skill is unaffected by licensing — but
shipping commercial work on an unlicensed dependency is a real risk, so
the skill treats raising it as part of doing the job properly.
