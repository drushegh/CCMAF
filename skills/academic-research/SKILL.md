---
name: academic-research
description: >-
  Scholarly, peer-reviewed research across the full lifecycle: find, appraise,
  synthesise and cite real literature; plan research questions, novelty and
  methods; draft, peer-review-simulate and disseminate — all citation-safe
  (never fabricate a reference, dataset, quote or result). Use whenever a task
  involves a literature review, systematic or scoping review, "find
  papers/studies/evidence on", citations/DOIs/BibTeX/reference lists, scholarly
  databases (arXiv, PubMed, Semantic Scholar, OpenAlex, Crossref, Consensus),
  research questions/novelty/gap analysis, methodology or reproducibility, peer
  review / referee reports, or grounding a claim in scholarly evidence.
  PROACTIVELY activate before asserting a research finding or writing any
  citation. Owns scholarly/peer-reviewed research and citation integrity;
  general web research is deep-research, and formatting the output into a
  document or deck is your docx/pptx tooling.
---

# Academic Research

Full-lifecycle scholarly research that is **evidence-grounded** and
**citation-safe**. The deliverable is *traceable claims* — every assertion tied
to a real, inspected, correctly-cited source — not plausible-sounding prose. An
LLM's characteristic failure here is the **fabricated citation**: a real-looking
reference to a paper that does not exist, or that says something other than
claimed. This skill exists to make that impossible by discipline.

## The integrity spine (non-negotiable)

1. **Never fabricate.** Not citations, DOIs, datasets, baselines, quotes,
   figures or results. If you could not retrieve and verify it, you do not have
   it — say so. Verify every reference against a real index (Crossref/OpenAlex)
   before citing — `scripts/verify_citation.py` does this.
2. **Never cite what you have not inspected.** Label each source `inspected`,
   `abstract-only`, `unavailable`, or `pending`; only `inspected` sources back a
   substantive claim.
3. **Separate fact, inference and speculation,** and mark confidence per claim
   (Confirmed / Strong inference / Weak inference / Speculation / Unknown). See
   `references/source-appraisal-and-integrity.md`.
4. **Every load-bearing claim is traceable:** a literature claim → an inspected
   source; a numeric/experimental claim → a result artifact; a method claim →
   a formalisation or code; otherwise label it *interpretation* or *hypothesis*.
5. **Triangulate** load-bearing claims — ≥2 genuinely *independent* sources
   (not two outlets repeating one press release). One source = anecdote; flag it.
6. **Reproducible search:** document databases, queries, filters and dates; a
   search you cannot reproduce is not a method (`references/discovery-and-search.md`).
7. **Cite critics, not only supporters;** check for **retractions**
   (Retraction Watch) and **predatory venues** before relying on a source.
8. **Keep the human in the loop** on direction, novelty and final claims — the
   skill expands research capacity; it does not own research judgement.

## Tooling

- **Consensus MCP** (already connected for this user) — evidence-based search
  over scientific literature; the quickest grounded first pass. Call its
  `search` tool, then verify and retrieve specifics via the APIs below.
- **Free scholarly APIs** (no or low-friction keys): **OpenAlex** (works,
  citations, open metadata), **Crossref** (DOIs + bibliographic record),
  **Semantic Scholar** (abstracts, citation graph, influential-citation flags),
  **arXiv** (preprints + source), **Europe PMC / PubMed** (biomed), **Unpaywall**
  (legal open-access PDFs). Best-fit and query syntax in
  `references/discovery-and-search.md`.
- **`scripts/verify_citation.py`** — confirm a DOI or title resolves to a real
  record (Crossref → OpenAlex) before it enters a reference list.
- For the **general web fan-out / fetch / verify** harness, use `deep-research`;
  this skill is the scholarly layer on top.

## Lifecycle (run only the phases the task needs)

| Phase | Do | Reference |
|---|---|---|
| 1. Scope | Frame the question (PICO / PEO / SPIDER); set non-goals and inclusion/exclusion criteria up front | discovery-and-search |
| 2. Discover | Consensus + APIs; expand synonyms; dedupe; capture DOIs; snowball (cited-by / references) | discovery-and-search |
| 3. Appraise | Quality dimensions, source tier, recency, retraction/predatory checks; label fact vs inference; triangulate | source-appraisal-and-integrity |
| 4. Synthesise | Thematic / narrative / meta / scoping; build an evidence table; identify gaps; PRISMA flow | synthesis-and-review |
| 5. Ideate* | Research question → gap → contribution; run the **novelty gate** | ideation-and-novelty |
| 6. Methods* | Design, pre-registration, reproducibility, measurement/claim gates | methods-and-reproducibility |
| 7. Write | IMRaD/structure; synthesise don't recite; correct reference style | writing-review-and-dissemination |
| 8. Review | Simulate reviewers (methodology / domain / cross-discipline / devil's advocate + editor); verify every claim; revise | writing-review-and-dissemination |
| 9. Disseminate | Structured abstract, poster, slides, plain-language summary | writing-review-and-dissemination |

*Phases 5–6 apply to producing original/empirical research; a literature review
or evidence-grounded report uses 1–4 (+7).

**Gates** (block progress until cleared): **scope** (problem + contribution +
non-goals agreed), **novelty** (weak novelty blocks drafting —
`references/ideation-and-novelty.md`), **pilot** (full experiments need an
approved pilot result), **claim** (every unsupported claim is removed, grounded,
or labelled a hypothesis before delivery).

## Reference index

Load on demand:

- `references/discovery-and-search.md` — scholarly databases and the free APIs
  (+ Consensus), search-strategy frames, Boolean/field syntax, dedup,
  snowballing, PDF ingestion, reproducible-search discipline.
- `references/source-appraisal-and-integrity.md` — quality dimensions, source
  tiers, red flags, preprints/gray literature, retraction/predatory checks; the
  fact/inference/speculation discipline, confidence labels, the Admiralty Code,
  and source triangulation.
- `references/synthesis-and-review.md` — synthesis approaches, the thematic
  workflow, the evidence table, gap identification, PRISMA flow and review types.
- `references/citations-and-referencing.md` — DOI-grounded citing, the
  verify-before-cite rule, citation hygiene, styles (APA/MLA/Chicago/Vancouver/
  IEEE/ACM), BibTeX/CSL and reference managers.
- `references/ideation-and-novelty.md` — research questions, gap→contribution,
  the novelty gate (pass/fail), hypotheses and positioning.
- `references/methods-and-reproducibility.md` — study/experiment design,
  pre-registration, reproducibility and reporting standards, statistics hygiene,
  the measurement and claim-verification gates.
- `references/writing-review-and-dissemination.md` — academic writing (IMRaD,
  abstracts, register), reviewer simulation and self-critique, and dissemination
  formats.

## Boundaries

- **General web research** (fan-out search, fetch, adversarial verification of
  any topic) → `deep-research`. This skill owns the *scholarly/peer-reviewed*
  layer and citation integrity, and builds on that harness.
- **Turning the research into a deliverable** (formatted report, proposal, deck)
  → your docx/pptx tooling. This skill produces the evidenced content;
  that tooling owns the format.
- **Heavy multi-agent paper factories** (end-to-end draft→LaTeX→figures→submit
  pipelines) → the larger lifecycle suites `lingzhi227/agent-research-skills`
  and `imbad0202/academic-research-skills` (mind their licences); reference them
  rather than rebuild.
- **Statistical computation** (running a meta-analysis, power calculations) →
  this skill plans and reports it to standard, but does not replace a
  statistician or a stats package.
- **Diagrams/figures** of a method or architecture → `drawio-development`.
