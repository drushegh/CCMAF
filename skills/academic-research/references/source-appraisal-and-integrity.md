# Source appraisal & integrity

Judging whether a source can bear weight, and keeping fact, inference and
speculation separate. Condensed from `borghei/Claude-Skills` (litreview
source-quality; dossier fact-vs-inference and source-triangulation).

## Quality — six dimensions

| Dimension | Question |
|---|---|
| Methodology | Is the design appropriate and described well enough to reproduce? |
| Sample / data | Adequate and representative for the claim? |
| Peer review | Reviewed? Where? Cited approvingly or critically? |
| Reproducibility | Data/code available? Replicated? |
| Recency | Current? (fast fields <2y; stable fields <10y) |
| Citation impact | Cited how often, by whom, supportively or critically? |

A single weak dimension is rarely fatal; the **combination** matters.

## Source tiers (typical; field-dependent)

1. Peer-reviewed articles in leading venues; systematic reviews/meta-analyses; replicated studies.
2. Mid-tier peer-reviewed journals; strong conference proceedings (top CS venues rival journals); rigorous government/institutional reports.
3. Preprints (not yet reviewed); dissertations; conference posters; industry research reports.
4. Trade publications; quality journalism; editorially-reviewed books.
5. Self-published/non-reviewed; op-eds; blogs; social media.

Judge the **work**, not only the venue: a weak paper in a great journal is still
weak; a strong paper in a small venue is still strong.

## Red flags

- Sample too small for the claim; no control/comparison; limitations unacknowledged.
- p-values without effect sizes; multiple comparisons without correction; outliers dropped unexplained.
- **Predatory venue** (pay-to-publish without real review — check Beall's-style lists / DOAJ membership), undisclosed conflicts of interest, author-list inflation.
- Self-citation cycles; citing only supportive evidence; citing without engaging.

## Famous-but-wrong, preprints, grey literature

- Highly-cited ≠ correct. Check for **non-replication**, **critical responses**, and **retraction** (Retraction Watch) before relying on a result.
- **Preprints** are not a negative signal but need extra scrutiny (strong claims without review, thin methodology). Good when the field moves faster than the journal cycle and code is posted.
- **Grey literature** (reports, theses, working papers) is useful for niche/recent topics; note the absence of peer review and any sponsor bias, and track its use transparently.

## Integrity — fact vs inference vs speculation

Label every load-bearing statement; mix them and the reader cannot calibrate.

- **Fact** — verifiable, sourced, specific. *State it; cite it.*
- **Inference** — a reasoned conclusion from facts. *Use "suggests/appears/likely" and cite the underlying facts; consider alternatives.*
- **Speculation** — a guess on thin evidence. *Use "possible/might/could"; flag the limited evidence; isolate it in "open questions".*

**Confidence labels** (apply per claim, not per section): **Confirmed** ·
**Strong inference** · **Weak inference** · **Speculation** · **Unknown**. A
report that includes an explicit "what we don't know" section is more
trustworthy than one that implies completeness.

## Triangulation & source independence

Two sources are **independent** only if they don't derive from the same origin
(two articles quoting one press release = **one** source; a press release plus
independent reporting = two).

- **1 source:** anecdotal — flag the uncertainty.
- **2 independent sources:** workable — the standard for most claims.
- **3+ independent:** safe to assert as confirmed.

Apply this to anything load-bearing — numbers, dates, ownership, causal claims.

### Admiralty Code (quick reliability × credibility grade)

Reliability of the **source** A–F (A = completely reliable … F = cannot be
judged); credibility of the **information** 1–6 (1 = confirmed by independent
sources … 6 = cannot be judged). A *B-2* source is workable; an *F-6* is barely
usable. Useful shorthand when triaging mixed sources for a report.

## Pitfalls

- No quality scoring — all sources weighted equally.
- Citation chain mistaken for triangulation — repeated citing of one source is still one source.
- One source treated as fact; venue used as a proxy for quality.
- Inferences presented as facts; uncertainty buried; disconfirming evidence omitted.
