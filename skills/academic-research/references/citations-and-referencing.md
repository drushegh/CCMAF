# Citations & referencing

The anti-fabrication spine in practice: how to cite so that every reference is
real, inspected and correctly attributed. Condensed from `borghei` (litreview
citation hygiene) and the claim-typing in `ngtiendong/Academic-Research-Agent-Skill`.

## Verify before you cite (non-negotiable)

Before a reference enters a list, **confirm it resolves to a real record**:

```bash
python3 scripts/verify_citation.py --doi 10.1145/3442188.3445922
python3 scripts/verify_citation.py --title "Attention is all you need"
```

It queries **Crossref**, then **OpenAlex**, and returns the canonical
title/authors/year/venue/DOI — or reports *not found*. A reference that will not
resolve is treated as **fabricated until proven otherwise**: drop it or correct
it. Never reconstruct a DOI or "remember" a citation — retrieve it.

## Cite what you actually read

- Back substantive claims only with **`inspected`** sources (see
  `source-appraisal-and-integrity.md`); never cite from an abstract or a
  secondary mention as though you read the work.
- Use the **original** publication, not a paper that cites it — citation chains
  propagate errors ("citation drift": the cited claim drifts from what the
  source says).
- For a direct quote or a specific figure, give the **page/locator**.

## Claim → citation type

Every load-bearing sentence maps to one of these (else it is unsupported):

- **Literature claim** → an inspected source.
- **Numeric/experimental claim** → a result artifact (your data or the source's reported result).
- **Method claim** → a formalisation, algorithm, or code.
- **Interpretation** / **Hypothesis** → labelled as such, not dressed as fact.

## Reference styles — match the field

| Style | Typical fields |
|---|---|
| **APA** | Psychology, education, social sciences |
| **MLA** | Humanities, languages |
| **Chicago** | History, some social sciences (notes or author–date) |
| **Vancouver** | Medicine, biomedical (numbered) |
| **IEEE** | Engineering, computer science (numbered) |
| **ACM** | Computing (ACM Reference Format) |

Pick one and apply it **consistently**. When in doubt, follow the target
journal/conference author guidelines.

## Mechanics — BibTeX, CSL, managers

- Store the **DOI** with every entry — it is the stable handle; let the manager
  render the style from it.
- **BibTeX** for LaTeX workflows; **CSL** (Citation Style Language) for
  Word/Markdown/Pandoc and most managers.
- **Reference managers:** Zotero (free, open-source — the default recommendation),
  Mendeley, EndNote, Paperpile. Pick one early; consistency beats features.

## Citation hygiene

- **Avoid cite-and-run:** for each citation, be able to say what it contributes;
  if you can't, don't cite it. *"Smith (2020) found X"* (engagement) beats
  *"(Smith 2020; Jones 2019; Lee 2018)"* (decoration).
- **Cite critics, not only supporters** — show you engaged with opposing evidence.
- **Build on prior work explicitly** — cite the foundational work for each major
  claim and distinguish your contribution from it.
- Watch for **self-citation cycles** and **echo-chamber** citation (all from one
  school).

## Final check

Before delivery, pull the reference list and confirm: every entry resolves
(verify script), every in-text citation has a list entry and vice versa, styles
are uniform, and each substantive citation is one you inspected.
