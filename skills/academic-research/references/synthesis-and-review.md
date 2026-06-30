# Synthesis & review

Turning a screened set of sources into defensible findings. Condensed from
`borghei/Claude-Skills` (litreview synthesis-and-citation + search/PRISMA).

## Review types — pick the right one

| Type | When | Rigour |
|---|---|---|
| **Systematic** | Specific answerable question; reproducibility required | Pre-registered protocol, dual screening, PRISMA flow |
| **Scoping** | Map a broad/fragmented field | Broader scope, lighter quality bar, no pooled answer |
| **Rapid** | Decision support on a tight timeline | Single reviewer, limited databases — adequate for policy, not clinical claims |
| **Narrative** | Synthesise established knowledge with expertise | Author-driven; state that it isn't reproducible |

Be explicit about which you are producing.

## Inclusion / exclusion — set up front

Year range, language, source type (peer-reviewed/conference/preprint/grey),
study type, population (matches the question frame), methodology, outcome
reported, quality threshold. **Publish the criteria before screening and apply
them consistently** — adding criteria post-hoc to shrink the pool is bias.

## PRISMA flow (adapted for any field)

Force honesty about how thin or thick the included pool is:

```
Records identified (database searches)        n=____
+ records from other sources (snowball)        n=____
= records after duplicates removed             n=____
→ screened on title/abstract                   n=____
   → excluded                                  n=____
→ full-text assessed for eligibility           n=____
   → excluded (with reasons)                   n=____
→ included in synthesis                        n=____
```

For systematic reviews, pre-register the protocol (PROSPERO for health; OSF
otherwise) and prefer dual-independent screening; single-reviewer screening is
acceptable only for scoping/rapid reviews.

## Synthesis approaches

| Approach | When |
|---|---|
| **Thematic** (default for non-clinical) | Multiple sources address common themes |
| **Narrative** | Heterogeneous sources; explanatory — guard against reading as opinion |
| **Meta-analysis** | Quantitatively comparable studies (needs statistical expertise) |
| **Realist** | Complex interventions — what works, for whom, in what context |
| **Scoping** | Mapping a field rather than answering one question |

## Thematic workflow

1. Read each included source closely (findings, method, limitations).
2. Open-code findings per source.
3. Cluster codes into **themes** across sources; refine by re-reading.
4. Build an **evidence table** — theme × source, with finding type and quality.
5. Identify gaps.

### The evidence table

| Theme | Source A | Source B | Source C |
|---|---|---|---|
| Theme 1 | Supports (high) | Supports (med) | Partial |
| Theme 2 | Not addressed | Disconfirms (high) | Supports |

It shows at a glance which themes are well-supported, which are **contested**
(report the disconfirming evidence), and which are **gaps** (single/low-quality).

## Identifying gaps

Gaps come from: themes with no high-quality evidence; themes implied but not
studied; methodological gaps (e.g. no longitudinal data); demographic/geographic/
temporal gaps. Document them honestly — they separate *known* from *unknown* and
drive the contribution (see `ideation-and-novelty.md`).

## Communicating the synthesis

Per theme report: the finding, the **evidence strength** (count + quality of
supporting sources), any **disconfirming** evidence, the most rigorous citations,
and the gaps. **Synthesise, don't summarise** source-by-source — a reader wants
insight, not a bibliography. Lead with the answer, then the support; surface
tensions and the review's own limitations.

## Pitfalls

- Source-by-source summary instead of synthesis.
- No evidence table; hidden methodology; conclusions exceeding the evidence.
- Engaging only with confirming evidence; over-reliance on one author/group/venue.
- No PRISMA flow on a systematic review — the process is opaque.
