# Discovery & search

Finding the right scholarly literature, reproducibly. Condensed from
`borghei/Claude-Skills` (litreview) and the tooling patterns in
`lingzhi227/agent-research-skills`, plus the public scholarly APIs.

## Tools — what to reach for

| Tool | Best for | Notes |
|---|---|---|
| **Consensus MCP** (connected) | Fast evidence-based first pass over scientific claims | Call its `search` tool; then verify/retrieve specifics via the APIs below |
| **OpenAlex** | Broad discovery, citation counts, open metadata, concepts | Free, no key (add `mailto=` for the polite pool); `api.openalex.org/works` |
| **Crossref** | Authoritative DOI + bibliographic record (verify-before-cite) | Free, no key (`mailto=`); `api.crossref.org/works` |
| **Semantic Scholar** | Abstracts, citation graph, influential-citation flags, TLDRs | Free Graph API (`api.semanticscholar.org/graph/v1`); key optional for rate |
| **arXiv** | CS/maths/physics preprints + LaTeX source | `export.arxiv.org/api/query` (Atom XML) |
| **Europe PMC / PubMed** | Biomedical & life sciences; OA full text | Europe PMC REST; PubMed via NCBI E-utilities |
| **Unpaywall** | A legal open-access PDF for a known DOI | `api.unpaywall.org/v2/{doi}?email=` |

*Endpoints, rate limits and key requirements drift — re-verify against current
API docs (checked May 2026). Most are free; respect rate limits and identify
yourself with an email where asked.* Prefer **direct API calls** (web/bash) for
reproducibility; reserve general web search for grey-literature gaps. The
`lingzhi227/agent-research-skills` suite shows the same pattern in stdlib
scripts (`search_crossref.py`, `search_openalex.py`, `search_arxiv.py`,
`search_semantic_scholar.py`, `paper_db.py` for dedup, `bibtex_manager.py`) —
useful as a model, but it states no licence, so write your own rather than copy.

## Frame the question first

A well-framed question makes search and synthesis tractable.

- **PICO** (interventions): Population · Intervention · Comparator · Outcome.
- **PEO** (qualitative): Population · Exposure/experience · Outcome.
- **SPIDER** (qualitative): Sample · Phenomenon of Interest · Design · Evaluation · Research type.
- **ECLIPSE** (policy/management): Expectation · Client group · Location · Impact · Professionals · Service.

## Search syntax

- **Boolean:** `AND` (both), `OR` (synonyms — capture them), `NOT` (exclude).
- **Truncation/wildcards:** `prevent*` → prevent/prevention/preventing; `child?`.
- **Phrase:** `"machine learning"`.
- **Proximity** (database-dependent): `learning NEAR/3 reinforcement`.
- **Field tags:** `"deep learning"[Title]`, `Smith[Author]`, `Nature[Journal]`.

**Sources of terms:** thesauri (MeSH for biomed; subject indexes elsewhere),
synonyms lifted from known-relevant papers, and citation chains. Iterate: run,
review hits, add missed terms.

## Reproducible-search discipline

For every search, record: **databases**, the full **Boolean string**,
**filters** (date/language/type), the **date executed** (results change over
time), **hits returned**, and **duplicates removed**. A search you cannot
reproduce is not a method.

## Snowballing

Beyond keyword search, follow the citation graph: **backward** (a paper's
reference list) and **forward** (who cites it — "cited by" on OpenAlex/Semantic
Scholar). Snowballing from a few seminal papers often surfaces what keyword
search misses, especially foundational work and across-vocabulary fields.

## Dedup & ingestion

Merge results across databases and **deduplicate by DOI** (fall back to
normalised title + year). Capture the **DOI** for every record — it is the
stable handle for verification and citation. For full text, fetch the OA PDF
(Unpaywall/arXiv) and extract text before relying on any claim — never cite
from an abstract as though you read the paper (see
`source-appraisal-and-integrity.md` → source labels).

## Pitfalls

- **Google Scholar as the only database** — inconsistent indexing, not
  reproducible. Use the structured APIs.
- **No synonym/thesaurus expansion** — misses relevant work.
- **Criteria added after seeing results** — cherry-picking; set inclusion/
  exclusion up front (see `synthesis-and-review.md`).
- **Only recent papers** — misses foundational work; snowball backward.
- **Treating a search hit as evidence** — a hit is a candidate; appraise it.
