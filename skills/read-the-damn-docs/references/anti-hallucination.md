# Anti-hallucination: packages, slopsquatting, invented APIs

Why "I'm fairly sure the package is called X" is a **security** claim, not a
quality one — and the registry checks that defeat it. The parent SKILL.md states
the habit; this file gives the threat model, the data, and the verification
mechanics. Full supply-chain attack taxonomy and SBOM/provenance → `secure-development`.

## The phenomenon: repeatable, therefore exploitable

LLMs invent plausible-sounding package names that do not exist. The dangerous
property is not that they hallucinate — it is that the hallucination is
**repeatable, not random noise**. The same prompt tends to invent the *same*
fake name across runs and even across models. Random errors are self-cancelling;
a stable, predictable wrong answer is a target an attacker can pre-position
against. That single fact is what turns a model quirk into an attack surface.

## The data (verified June 2026; re-verify before quoting — rates track the live cohort)

USENIX Security '25 (UTSA / Virginia Tech / Univ. of Oklahoma), 16 models over
576,000 code samples:

- **19.7%** of recommended packages did not exist — open-source models ~21.7% vs
  commercial ~5.2%; **>205,000 unique** non-existent names.
- Repeatability: **58%** of hallucinated names recurred across 10 runs; **43%**
  appeared in *every* run.
- Shape of the fakes: ~38% were string-similar to a real package, ~50% were
  plausible fabrications, only ~13% were simple typos. Most are not typos you'd
  catch by eye.

A 2026 frontier re-evaluation (arXiv 2605.17062), ~199,845 paired Python/JS
prompts validated against PyPI/npm, measured **4.62%** (Claude Haiku 4.5) to
**6.10%** (GPT-5.4-mini) — improved but **not eliminated**. **127** names were
invented identically by *all five* models tested; after coordinated disclosure,
**53 remained registrable** by attackers.

> Do not hard-code per-model numbers in code or docs — they change every release.
> Cite the study + date, and re-check at the source.

## Slopsquatting

Term coined April 2025 by Seth Larson (PSF Developer-in-Residence), popularised
by Andrew Nesbitt: **register a non-existent name an LLM hallucinates, so the next
agent that hallucinates it installs your code.** It is typosquatting aimed at
model memory instead of human fingers — and far more reliable, because the
"typo" is generated deterministically by the cohort rather than by a slipped key.

Precedent (proof the path works, benignly): Bar Lanyado's fake `huggingface-cli`
drew **30,000+ downloads in three months** and was referenced in an Alibaba repo
README. No exploit needed — just registration and patience.

## Self-detection is not a safety net

Models flag only **~75%** of their own hallucinations — up to **a quarter slip
through**. "Ask the model if the package is real" is therefore not a control.
Registry verification against the live index is the control.

## The defence: verify existence + version before adding any dependency

```bash
npm view <pkg> version                       # npm: errors if it doesn't exist
pip index versions <pkg>                      # PyPI: lists real published versions
curl -s https://registry.npmjs.org/<pkg>      # raw registry JSON (npm)
curl -s https://pypi.org/pypi/<pkg>/json      # raw registry JSON (PyPI)
```

Then **sanity-check the metadata**, not just existence:

| Signal | Red flag |
|---|---|
| Name | The *exact* name you "remembered", spelled to match a real one |
| Owner/publisher | Unknown author; not the org you'd expect to own it |
| Age | Registered days ago |
| Download count | Near-zero, or a sudden spike with no provenance |

A brand-new package with the exact name you recalled is a **red flag, not a lucky
find** — precisely the slopsquatting signature.

**Cross-ecosystem guard.** Do *not* assume an npm name maps to the same PyPI name
(a documented confusion mode). Verify per registry, every time.

## Pin and lock so the verified version IS the installed version

Verification without pinning is incomplete — a floating range can resolve to a
different artefact after you checked. Commit lockfiles **with integrity hashes**:

- `package-lock.json` (SHA-512), `pnpm-lock.yaml`, `yarn.lock`
- `Pipfile.lock` / `poetry.lock` hashes, `Cargo.lock`

Install deterministically and with scripts off:

```bash
npm ci --ignore-scripts            # honour the lockfile; no arbitrary install scripts
pip install --require-hashes -r requirements.txt
```

Prefer **provenance-attested** packages (npm provenance / Sigstore). Note: npm
v12 (planned July 2026 — re-verify at the npm release notes) is set to block
install scripts by default, narrowing the window between install and verify.

## Same discipline beyond packages

Invented **APIs, parameters and flags** are the identical failure mode — a
plausible, confidently-recalled shape that does not exist in the version you ship.
Verify them against version-matched docs and installed source the same way
(`source-hierarchy-and-tools.md`; the read-then-verify loop and drift signals in
`verify-and-drift.md`).

## Checklist before any new dependency

- [ ] Registry confirms the package **exists** (`npm view` / `pip index versions`
      / registry JSON) — not just model recall.
- [ ] Owner, age and download count are **plausible for an established package**.
- [ ] Name verified **per ecosystem** — no npm→PyPI assumption.
- [ ] Exact version pinned and the **lockfile committed with integrity hashes**.
- [ ] Install runs with **`--ignore-scripts` / `--require-hashes`**; provenance
      preferred where available.

Supply-chain attack depth → `secure-development`; catching a hallucinated
package/API in review → `code-review-development` (its AI-generated-code pass).
