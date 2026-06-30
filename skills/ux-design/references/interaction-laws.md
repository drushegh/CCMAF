# The Laws of UX

Empirical regularities about human perception and behaviour. They let you
*predict* interaction cost and error from a design without testing it. (Curated
by Jon Yablonski / lawsofux.com; rooted in psychology and HCI.) Use them as
reasoning tools, not dogma.

## Laws that govern *acquisition and choice*

- **Fitts's Law** — time to acquire a target grows with distance and shrinks
  with size. Implication: make important/frequent controls **bigger and
  closer** to where the pointer/thumb already is; put related actions near
  their object; screen edges/corners are "infinitely large" (the pointer stops
  there) so they're cheap targets on desktop.
- **Hick's Law** — decision time grows with the number and complexity of
  choices. Implication: reduce options, group them, use progressive disclosure,
  and provide a sensible default. A wall of equal choices paralyses.
- **Tesler's Law (conservation of complexity)** — every system has irreducible
  complexity; the only question is who absorbs it. Implication: the *product*
  should absorb complexity (smart defaults, inference) rather than dumping it on
  the user as fields and options.
- **Miller's Law** — people hold ~7±2 items in working memory (often fewer).
  Implication: **chunk** content and controls; don't make users remember across
  steps; show, don't make them recall.

## Laws that govern *expectation and time*

- **Jakob's Law** — users expect your product to work like the others they
  already know. Implication: follow conventions (nav placement, icon meanings,
  control behaviour, gestures). Novelty in *mechanics* is a tax; spend novelty
  on value, not on relearning the basics.
- **Doherty Threshold** — productivity soars when system response is **under
  ~400 ms**. Implication: respond to every action fast; for slower work, use
  optimistic UI, skeletons, and progress so perceived performance stays high.
- **Goal-Gradient Effect** — motivation increases as a goal nears. Implication:
  show progress (steps, bars, "2 of 3"); give a visible head-start on
  multi-step flows.

## Effects that govern *attention and memory*

- **Von Restorff (Isolation) Effect** — the item that differs is remembered and
  noticed. Implication: make the single most important element distinct (the
  one primary button styled differently) — but only one, or the effect dilutes.
- **Serial Position Effect** — first and last items are best recalled.
  Implication: put key nav/actions at the start or end of a list, not buried in
  the middle.
- **Peak-End Rule** — people judge an experience by its most intense moment and
  its end. Implication: invest in the hardest moment (error recovery, first
  success) and the finish (confirmation, "done") — not uniform polish.
- **Aesthetic-Usability Effect** — people perceive attractive designs as more
  usable and tolerate minor issues. Implication: visual quality buys goodwill —
  but it masks problems in testing, so don't let "it looks nice" substitute for
  "it works".

## Robustness

- **Postel's Law (robustness)** — be liberal in what you accept, conservative
  in what you do. Implication: accept input in any reasonable format (spaces in
  card numbers, various date/phone formats), normalise silently; be precise and
  predictable in output and errors.

## Using the laws

These laws frequently **pull against each other** — Hick (fewer choices) vs
discoverability, Fitts (big targets) vs density, aesthetics vs information.
Design is resolving those tensions for *this* context and user. Name the law
when you justify a decision ("primary CTA enlarged and moved into the thumb
zone — Fitts"), so the reasoning is inspectable, then confirm by looking
(`ui-verification`).
