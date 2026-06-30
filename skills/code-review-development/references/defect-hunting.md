# Defect Hunting — the High-Value Bug Classes

Linters, type checkers and formatters catch the cheap stuff. A human or
agent reviewer earns their place by finding the defects tools miss —
logic, state, boundaries and failure. Run a change against this
checklist; these are, repeatedly, where real production incidents come
from.

## Boundaries and arithmetic

- **Off-by-one** — loop bounds, slice/substring indices, inclusive vs
  exclusive ranges, pagination first/last page.
- **Empty and singular cases** — zero items, one item, the maximum
  items. Does the empty list, empty string, or empty result behave?
- **Numeric** — integer overflow/truncation, division by zero,
  **money in floating point** (should be integer minor units or a
  decimal type), rounding direction, mixing units.

## Nulls, optionals and absence

- Unchecked null/None/undefined; the difference between "absent",
  "empty" and "zero/false".
- Optional/Maybe types unwrapped without handling the empty case;
  default values that mask a real missing-data problem.

## Error handling and resilience

- **Swallowed errors** — caught and ignored, logged-and-continued when
  it should abort, or collapsed to a generic message that loses the
  cause.
- **Wrong failure mode** — failing open where it should fail closed
  (especially auth, payments, access checks).
- **Resource leaks** — files, sockets, DB connections, locks, handles
  not released on the error path; missing finally/using/defer/context
  manager.
- **Retries** — retrying a non-idempotent operation; no backoff; no cap;
  retrying on errors that will never succeed.
- **Partial failure** — multi-step operations with no rollback or
  compensation, leaving inconsistent state.

## State and concurrency

- Shared mutable state across threads/requests/coroutines without
  synchronisation; data races.
- Check-then-act races (TOCTOU); assuming operations are atomic when
  they aren't.
- Deadlock-prone lock ordering; holding a lock across I/O.
- Hidden global/singleton state that breaks under parallelism or in
  tests.

## Data, queries and migrations

- **N+1 queries**; queries inside loops; missing indexes on new query
  shapes (→ `sql-development`).
- **Unbounded results** — no LIMIT/pagination on data that grows;
  loading a whole table into memory.
- **Missing transaction** around multi-statement invariants; wrong
  isolation assumptions.
- **Unsafe migration** — locking DDL on a large table, a destructive
  change with no rollback, or one that breaks the currently-deployed
  code (expand/contract not followed) (→ `sql-development`).

## Security (sweep; depth in secure-development)

- Untrusted input reaching a query, command, path, template or
  deserialiser without validation/parameterisation (injection).
- Authn/authz: is the *caller's* permission checked on this path, not
  just the happy-path UI? Object-level access (can user A fetch user
  B's record)?
- Secrets in code, logs or error messages; sensitive data logged.
- SSRF/path-traversal on user-supplied URLs/paths; unsafe redirects.
  Route depth → `secure-development`.

## Time, money, and the real world

- Time zones, DST, clock skew; storing local instead of UTC; assuming
  "now" is monotonic.
- Locale/encoding (Unicode, normalisation, case-folding) assumptions.
- Currency/rounding/tax as above; never trust client-supplied amounts.

## Contracts and compatibility

- Breaking an API/event/schema/CLI consumers depend on; changing a
  default that silently alters behaviour (→ `api-development`).
- Feature flags: safe default, safe to toggle, cleaned up later; rollout
  ordering (DB before code, or code tolerant of both).

## Tests for the defect

For any real bug the change fixes, **is there a test that fails without
the fix?** A fix with no regression test invites the bug back. (Test
design → `testing-development`.)

Reviewer habit: don't just confirm the code does what it says — ask
"what input or sequence makes this break?" for each function you read.
The bug is usually in the case the author didn't picture.
