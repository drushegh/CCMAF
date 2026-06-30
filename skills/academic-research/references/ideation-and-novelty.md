# Ideation & novelty

For producing *original* research: turning a gap into a defensible contribution,
and refusing to proceed on weak novelty. Condensed from
`ngtiendong/Academic-Research-Agent-Skill` (novelty gate, scope) with standard
question-framing. Human researcher owns direction and taste; the skill
structures, challenges and checks.

## From gap to research question

Start from the **gaps** surfaced by the synthesis (`synthesis-and-review.md`),
not from a method looking for a problem. Frame and test the question:

- **FINER** — is it **F**easible, **I**nteresting, **N**ovel, **E**thical,
  **R**elevant?
- **5W1H** — what, why, who, where, when, how — to expose hidden assumptions.
- Use **PICO/PEO** (see `discovery-and-search.md`) to make it answerable.

State **non-goals** explicitly — what the work will *not* claim or cover.

## Contribution

Name the contribution precisely and position it against the **closest prior
work** (you must have found it — if you can't name it, you haven't searched
enough). Distinguish kinds of contribution: a new method, a new result, a new
dataset/benchmark, a new analysis/theory, or a replication. Tie the contribution
to a **falsifiable hypothesis** — something an experiment or analysis could
disconfirm.

## The novelty gate

Weak novelty **blocks** drafting or implementation — catch it before sinking
effort in.

**Fails the gate if:**

- It is only an existing method applied to a new domain, with no new mechanism.
- There is no falsifiable hypothesis.
- The planned evaluation **cannot distinguish** the proposed approach from
  existing work.
- The **closest prior work is missing** from the analysis.
- The claim rests on inflated wording rather than a real mechanism.
- A headline claim has no matching experiment/analysis that would support it.

**Passes the gate if:**

- There is a **clear delta** over the closest prior work.
- The hypothesis is **measurable**.
- **Baselines** to compare against are identified.
- **Failure cases** are acknowledged up front.

## Positioning

Write the one-sentence positioning early: *"Unlike [closest prior work], which
[limitation], this work [contribution], enabling [consequence]."* If you cannot
write it honestly, the idea is not ready — return to discovery or reframe. Keep
competing schools of thought in view and plan to cite them.

## Pitfalls

- Novelty asserted, not demonstrated against a named baseline.
- "First to do X" claims (almost always falsifiable and usually false) — prefer
  a specific, defensible delta.
- Hypothesis unfalsifiable or defined after seeing results (see HARKing in
  `methods-and-reproducibility.md`).
- Gap "found" by not searching hard enough — a convenient gap is not a real one.
