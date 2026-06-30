# Evals — testing nondeterministic systems

Evals are the test suite for LLM behaviour. Without them, every prompt
edit, model upgrade and tool change is an unreviewed deploy.

## The golden set

- 30–200 cases per behaviour: real inputs (sanitised production
  failures are gold), expected outputs or grading criteria, and tags
  (case type, difficulty, failure mode).
- Include: happy paths, known past failures (regression cases), edge
  cases (empty input, wrong language, adversarial phrasing,
  not-answerable-from-context), and out-of-scope inputs that should be
  declined.
- Version the set alongside the prompts it tests; additions
  documented like test cases, with provenance.

## Grader hierarchy (use the cheapest that measures the thing)

| Grader | Use for | Watch for |
|---|---|---|
| Exact/normalised match | Classification, extraction with canonical answers | Over-strict normalisation hiding real wins |
| Code assertions | Structure (valid JSON, schema-conformant, contains citation, length bounds) | Asserting form while missing substance |
| Embedding/string similarity | Near-duplicate detection, fuzzy reference match | False confidence on fluent-but-wrong |
| LLM-as-judge | Open-ended quality: faithfulness, helpfulness, tone | Needs calibration (below) |
| Human review | Judge calibration, high-stakes sign-off, label creation | Cost — sample, don't exhaustively review |

Most real suites layer them: code assertions gate validity, a judge
scores quality, humans audit the judge.

## LLM-as-judge, done properly

- **Rubric per criterion**, scored separately (faithfulness, completeness,
  format), each with anchored scale points and an example at each
  anchor — not one "rate 1–10 overall".
- Judge sees: input, output, criteria — and for faithfulness, the source
  context. Ask for evidence quotes before the verdict (forces grounding).
- **Pairwise beats absolute** for comparing variants: "which response
  better satisfies X?" with position randomised (judges have positional
  and verbosity biases).
- Use a strong model as judge; grading is harder than generating.
  Calibrate against a human-labelled sample (aim for agreement on par
  with human–human) before trusting it in CI; re-calibrate when the
  judge model changes.
- Self-grading bias is real: where feasible, judge with a different
  model family than the one under test, or at least audit a sample.

## Statistical honesty

- Nondeterminism means single runs lie. Run each case multiple times
  (or the suite at multiple seeds/temperatures) and compare
  distributions, not single scores.
- For agents: pass@k (any of k attempts succeeds) vs pass^k (all k
  succeed — what reliability-critical paths need). Report which.
- Small suites: a 2-point swing on 50 cases is one flipped case —
  use significance tests or "n cases changed, which ones" diffs
  instead of headline percentages.
- Hold out a set you never iterate against, or you'll overfit prompts
  to the eval.

## Agent-level evals

Grade outcomes, not transcripts: task completed (binary or rubric),
side-effect correctness (the file actually changed, the record exists),
turns/tokens/cost per task, gate compliance (no irreversible action
without approval). Scripted environments with seeded state + verifiable
end-state assertions beat judging the agent's narration — agents
confidently narrate work they didn't do.

## CI and production

- Eval suite runs on every prompt/tool/model change; block merges on
  regression in gated metrics; track score history per template version.
- Batch API halves the cost of large suite runs.
- Production telemetry closes the loop: sample live traffic for
  judge-scoring, monitor refusal/format-failure/retry rates, and feed
  failures back into the golden set. A/B prompt variants behind flags
  with the same metrics — offline evals propose, online data disposes.
- Model upgrades are migrations: run the full suite against the new
  model before switching defaults; expect prompt re-tuning, not
  drop-in equivalence (tokeniser and behaviour shifts are normal
  between generations).
