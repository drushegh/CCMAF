# Methods & reproducibility

For empirical work: designing studies/experiments that are reproducible,
falsifiable and traceable. Condensed from `ngtiendong/Academic-Research-Agent-Skill`
(experiment protocol, claim verification) with standard reporting guidelines.

## Match design to question

- **Experimental** (RCT, A/B, controlled) — for causal/intervention questions.
- **Observational** (cohort, case-control, cross-sectional) — when manipulation
  is impossible/unethical; weaker causal claims.
- **Qualitative** (interview, case study, ethnography) — for experience/mechanism.
- **Computational** (benchmark, simulation, ablation) — for methods/ML.

Pick the weakest design that can actually answer the question, and state the
threats to validity it leaves open.

## Experiment protocol — required elements

Before a full run, fix and record: **baselines**, **dataset + version**,
**metrics**, **random seeds**, **environment** (versions/hardware), a **pilot
run** before the full run, a **structured result artifact**, and **failure
notes**. A workable result schema:

```json
{
  "run_id": "string",
  "hypothesis": "string",
  "dataset": "string",
  "baseline": "string",
  "method": "string",
  "metrics": {},
  "seed": 42,
  "environment": {},
  "notes": "string"
}
```

## Gates before implementation

- **Measurement-layer audit:** review every metric the experiment depends on
  (sensible null/baseline for bounded quantities, denominators bounded away from
  zero, notation complete, actually computable) *before* writing dependent code.
  A metric that fails the audit blocks implementation.
- **Input-validity gate:** when perturbing inputs (text/image), confirm the
  perturbation survives the real preprocessing pipeline — otherwise a null effect
  is a preprocessing artifact, not a finding.
- **No silent substitution:** any model/scale/config change made mid-run is
  recorded the same day in the plan and a risk register.

## Pre-registration & reporting standards

- **Pre-register** the hypothesis and analysis plan: **PROSPERO** (systematic
  reviews, health), **ClinicalTrials.gov** (trials), **OSF / AsPredicted**
  (general). Pre-registration is the strongest guard against HARKing and p-hacking.
- **Report to the matching standard:** **CONSORT** (RCTs), **STROBE**
  (observational), **PRISMA** (reviews), **ARRIVE** (animal studies), the
  **NeurIPS reproducibility checklist** / open code + data (ML/CS).

## Statistics hygiene

- Report **effect sizes and confidence intervals**, not p-values alone.
- **Correct for multiple comparisons**; report the number of tests run.
- Justify any **outlier exclusion**; don't drop data to fit.
- Consider **power** before, not after; an underpowered null is uninformative.
- **Don't HARK** (hypothesise after results) or selectively report — report
  negative and null results too.

## Claim verification gate (before delivery)

Every factual claim in a draft must be traceable, or it is removed/grounded/
relabelled. **Blockers:** a fabricated citation; an unverified numerical result;
a claim **stronger than its evidence**; a comparative claim with **no baseline**.
Tie each claim to its evidence type (see `citations-and-referencing.md` →
claim→citation type). Keep evidence and interpretation visibly separate.

## Pitfalls

- No seed/version/environment recorded — results not reproducible.
- Metric defined loosely or uncomputable — silent garbage.
- p-hacking / HARKing / selective reporting.
- Comparative claim with no baseline; numeric claim with no artifact behind it.
