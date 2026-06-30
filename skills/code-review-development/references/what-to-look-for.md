# What to Look For — the Dimensions

Run a change against each dimension. This is the senior reviewer's mental
checklist; the concrete bug classes sit in `defect-hunting.md`, and the
domain-specific depth in the sibling skills cross-referenced below.

## Design

The most important thing in the review. Do the pieces of the change fit
together and fit the system? Does the responsibility live in the right
place (this layer vs a library vs a service)? Is the abstraction
boundary sensible? **Smell:** a change that works but pulls the system
toward higher coupling, a leaky abstraction, or duplicated concepts.

## Functionality and correctness

Does it do what the author intended, and is that intent good for the
users (end-users and future callers)? Hunt edge cases, boundary
conditions and failure paths by reading — don't rely on the happy path
being the only path. **Smell:** logic that only considers the inputs the
author had in mind; missing handling for empty/null/huge/concurrent
cases.

## Complexity, over-engineering and YAGNI

Is it more complex than it needs to be — at line, function and class
level? "Too complex" usually means *can't be understood quickly* or
*easy to break when modifying*. Watch especially for **over-engineering**:
generality, hooks and configuration for needs that don't exist yet.
Solve the problem that exists now; the future problem is best solved when
its real shape is known. **Smell:** speculative interfaces with one
implementation, premature plugin systems, "flexible" config nobody asked
for.

## Tests

Are there tests at the right level (unit/integration/e2e) for the change,
in the same change as the code? Do they make meaningful assertions, and
will they **actually fail when the code breaks** (not just pass
vacuously)? Tests are code that must be maintained — reject needless
complexity in them too. Depth and what-to-test → `testing-development`.
**Smell:** tests asserting mocks rather than behaviour; tests that can't
fail; no test for the bug the change fixes.

## Readability, naming and comments

Are names long enough to communicate intent, short enough to read?
Comments should explain **why**, not restate **what** — if the code
needs a comment to say what it does, prefer making the code clearer
(exceptions: regexes, genuinely complex algorithms). Check pre-existing
comments too: a now-stale TODO to remove, a warning the change ignores.
**Smell:** `data2`, `tmp`, `helper`; comments narrating the obvious;
out-of-date doc comments.

## Style and consistency

The project style guide is the authority; a formatter/linter should
enforce most of it (`automation-tooling-and-ai.md`). Pure style points
not in the guide are preference — keep consistent with surrounding code,
don't block on them, prefix as a nit. Major reformatting must not be
mixed into a functional change — ask for it as a separate change.

## Contract, compatibility and data

Public API, event schema, CLI, config and feature flags: is the change
**backward-compatible**, or does it break callers/stored data? Are
migrations safe to run and to roll back? Routes: HTTP/API contract →
`api-development`; schema/index/migration safety → `sql-development`.
**Smell:** a renamed/removed field with live consumers; a migration with
no rollback; a flag default that changes behaviour silently.

## Security, performance, concurrency, observability, dependencies

- **Security** — untrusted input, authz/authn, secrets, injection. Depth
  → `secure-development`.
- **Performance** — allocations and work on hot paths, N+1 queries,
  unbounded result sets, accidental quadratic behaviour. Don't
  micro-optimise speculatively, but flag real scale risks.
- **Concurrency** — shared mutable state, races, deadlocks, ordering and
  atomicity assumptions.
- **Observability** — could you tell in production whether this works?
  Appropriate logs (with context, no secrets), metrics, traces.
- **Dependencies** — is a new dependency justified, maintained, and
  licence-clean? → `secure-development` (supply chain).

## Documentation and system health

If the change alters how people build, test, use or release the code,
the relevant docs (README, usage, generated reference) should change
with it. Finally, step back: does the change improve the **health of the
whole system**, or add another small increment of complexity/debt? Don't
accept net-negative changes (`the-standard.md`).

## Good things

Call out what's done well — a clean refactor, a sharp test, a comment
that explains a subtle why. Encouragement is part of mentoring and
often more valuable than another correction (`giving-feedback.md`).
