# Reviewing AI-Generated Code

AI-written code (Copilot, Cursor, Claude Code, agentic coding) has a
distinct, *predictable* failure profile — different enough from typical
human-error patterns that it deserves a dedicated pass. Two failure modes
compound: the **code's** (plausible-but-wrong, duplication, hallucinated
dependencies) and the **reviewer's** (overconfidence and volume-driven
rubber-stamping). Stanford and Snyk both found AI assistance makes people
*more* confident in *less* correct code — so the discipline here is to
distrust fluency and verify, not skim.

Apply this whenever a change was (or may have been) AI-generated — which,
in an agentic codebase, is most changes. The checks are cheap and hold
regardless of the exact magnitudes in the literature (some of which are
contested — see the calibration note).

## The failure modes and how to catch each

**1. Duplication instead of reuse.** AI generates from local context and
rarely searches the repo for an existing utility, so it re-derives logic
rather than importing it. *Signal:* new code with no corresponding
deletions (a genuine refactor removes lines in one place and re-adds them
extracted elsewhere — AI's tell is the missing removal); a new helper that
duplicates an existing one; parallel near-identical parse/validate/format/
mapping blocks. *Check:* before accepting any new function, search the
codebase for an equivalent; run a clone detector (jscpd, PMD CPD, SonarQube
duplication). (GitClear reports clones rising and refactoring falling in the
AI era — contested, but the check is worth running regardless.)

**2. Dead / orphaned code.** Unused variables and undefined names are the
commonest syntactic errors LLMs produce; multi-turn generation adds a
helper then forgets to wire it in. *Signal:* a new symbol or file with no
caller; unused imports; parameters never read; branches after an early
return. *Check:* run a dead-code/linter pass on the diff (vulture, ts-prune,
IDE unused warnings); every new symbol and file must have a second
reference.

**3. Hallucinated dependencies and APIs.** Models invent package names,
methods, parameters and endpoints that do not exist. Package hallucination
is well-measured (USENIX 2025: ~19.7% of generated packages overall; ~5%
for commercial, ~22% for open models) and is the basis of "slopsquatting" —
attackers register a commonly-hallucinated name so the AI installs malware
(a hallucinated `huggingface-cli` drew 30,000+ downloads). *Signal:* a new
dependency in the manifest that is not in the lockfile and does not resolve
on PyPI/npm; a package name close-but-not-identical to a real one; a
brand-new, near-zero-download package; a method, keyword argument or
REST/GraphQL endpoint absent from the library's real API. *Check:* verify
every new dependency exists on the registry and is pinned in the lockfile;
treat new low-reputation packages as suspect; cross-check unfamiliar calls
against the library's actual docs, not the model's say-so; require a
clean-install-and-run step in CI so a fake import fails fast.

**4. Plausible-but-wrong logic.** The single biggest developer complaint
(Stack Overflow 2025: 66% — "almost right, but not quite"); AI PRs carry
~75% more logic/correctness issues (CodeRabbit). Output is plausible by
construction — it optimises for likely tokens, not verified behaviour.
*Signal:* fluent, well-formatted code that breaks on boundary inputs;
off-by-one and edge-case errors; calls to things that do not exist.
*Check:* treat fluent code as *unverified, not correct*; demand edge-case
and error-path tests; run the defect-class hunt in `defect-hunting.md`.

**5. Security holes (with an overconfidence amplifier).** ~40% of Copilot
completions across CWE scenarios were vulnerable (NYU); 45% of AI code
failed security tests (Veracode 2025), and newer models were no more
secure. *Signal:* string-concatenated SQL; user input written to a page/DOM
without escaping; hand-rolled or mis-used crypto; non-CSPRNG randomness for
security; prefix path checks without canonicalisation; hardcoded secrets.
*Check:* route to `secure-development`; run SAST and secret scanning in CI;
never relax security scrutiny because the code "looks professional".

**6. Convention and naming drift.** A new AI session has no memory of the
codebase's established patterns, so it mixes casing, names the same concept
several ways, and reinvents utilities. *Signal:* `getUser` / `fetchUserData`
/ `user_lookup` for one concept; mixed casing within a PR; a new util
duplicating a shared one. *Check:* enforce naming/casing via linters
(policy-as-code), not eyeballing; flag one concept named multiple ways;
search for an existing utility first.

**7. Over-engineering.** AI tends to verbose, over-abstracted solutions —
a factory, an interface and a config loader where five lines would do.
*Signal:* abstraction scaffolding disproportionate to the task; a long
function where a short one suffices. *Check:* ask "would I write this if I
had to maintain it alone?"; delete an abstraction and see if anything
breaks; favour the simpler option (YAGNI — see `what-to-look-for.md`).

**8. Comment noise and placeholder/stub code.** LLM-assisted code roughly
doubles comment volume, and chat-style outputs leave elisions and stubs
behind. *Signal:* a comment on nearly every line restating *what* (not
*why*); literal elision placeholders such as "... rest of code here"; new
TODO/FIXME or empty `pass`/not-implemented stub bodies merged as if
complete. *Check:* auto-reject elision markers and new stub placeholders
from merging; flag comments that restate the adjacent line.

**9. Stale / deprecated APIs.** Models reproduce idioms deprecated after
their training cutoff (ICSE 2025: all tested models do this; high rates for
some libraries) — they learned the old usage and have no signal it changed.
*Signal:* calls to APIs deprecated in the installed library version; old
framework idioms; insecure-by-default options newer versions replaced.
*Check:* pin library versions and surface deprecation warnings in CI;
verify unfamiliar idioms against the current docs for the installed version.

**10. Tests that do not test.** AI optimises for a passing, coverage-raising
test — cheapest by asserting whatever the code currently does, often the
mock's own return. *Signal:* assertions that mirror `mock.return_value`;
assertions on existence/length/type rather than computed results; coverage
jumps with no edge/error-path cases; all green on first run. *Check:*
require assertions on behaviour/outputs; use mutation testing (does the
suite catch an injected bug?) over trusting coverage. Route test design to
`testing-development`.

**11. Oversized AI diffs.** AI produces code far faster than humans review
it; PR size and review time balloon (Faros: +154% PR size, +91% review
time) and scrutiny silently collapses into rubber-stamping (Salesforce saw
review time on the largest PRs *fall*). *Signal:* a large multi-file PR with
no narrative, touching unrelated layers at once. *Check:* push back for
decomposition; never approve volume you have not actually read; if
review-time-per-line drops as PRs grow, scrutiny has collapsed
(`automation-tooling-and-ai.md`).

**12. Licensing / provenance.** AI occasionally reproduces training code
verbatim (rare, but concentrated in generic boilerplate) without its licence
or attribution. *Signal:* a block closely matching a known open-source
project but lacking a LICENSE reference / SPDX header / attribution; naming
or comments that trace to a GPL/AGPL project. *Check:* run duplication-match
detection against public code on AI-assisted PRs; flag new files missing
expected licence headers; scan for copyleft fingerprints before shipping in
a closed-source product (supply chain → `secure-development`).

## Fast triage (run this on any AI-generated change)

1. Does every new dependency exist on the registry and sit in the lockfile?
2. Does every new function/file have a caller, and is there not already an
   equivalent in the repo?
3. Is each non-obvious API call real (checked against current docs)?
4. Are there edge-case and error-path tests, asserting behaviour not mocks?
5. Any injection / secrets / weak-crypto / unescaped-output smells?
6. Any elision placeholders, stub bodies, or comment-noise left in?
7. Is the diff small enough that you actually read all of it?

A "no" to any of these is a finding. Prioritise and label them per
`severity-and-prioritisation.md`, and remember: **fluent is not correct,
and an AI reviewer must never approve to be agreeable** (`giving-feedback.md`).

## Calibration note

The security and package-hallucination figures are well-evidenced; the
duplication/maintainability magnitudes (GitClear) are vendor-sourced and
contested by at least two 2025 studies that found no degradation or falling
churn. So treat the *numbers* as indicative and the *checks* as the point —
they are cheap, catch real defects, and do not depend on which study is
right. Full evidence base and sources: the research compilation kept with
this skill's project notes.
