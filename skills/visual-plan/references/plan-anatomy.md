# Plan anatomy

The canonical structure of a visual plan, plus a worked skeleton to copy. The
parent `SKILL.md` lists the seven sections; this file says what each is *for* and
where it goes wrong. Two rules govern all of it: **include only the sections the
change needs** (a schema change earns a `Decisions` block; a CSS tweak does not),
and **the plan must stand alone** — judgeable by a fresh reader with no chat
history. Never pad to look thorough.

## The sections, in order

**1. Outcome — what changes and why.** One to three sentences, product-level not
implementation-level: the observable change and why it's worth doing. A reader who
stops here knows whether the work is the right thing at all. Bad: "Refactor the
auth module." Good: "Let users stay signed in across devices by persisting
sessions server-side." If you can't write this crisply, the work isn't understood
yet — a `[NEEDS CLARIFICATION]`.

**2. Approach — the shape, and what was rejected.** The solution's shape in a
paragraph: the strategy, the seams it cuts along, and **the alternatives you
considered and rejected, with one-line reasons**. The rejected options are the
high-value content — they prove the design space was explored and pre-empt the
reviewer's "why not just…?". Here too the GitHub Spec Kit *Pre-Implementation
Gates* earn their keep as an optional sanity check (verified June 2026; re-verify
at github.com/github/spec-kit):

- **Simplicity Gate** — the smallest thing that works; no speculative
  future-proofing, no abstraction for one caller.
- **Anti-Abstraction Gate** — use the framework directly; one model
  representation, not a parallel wrapper layer mirroring it.
- **Integration-First Gate** — define contracts and contract-tests before the
  implementation behind them.

Justify any gate you fail explicitly ("a repository layer despite Anti-Abstraction
because two datastores back it") — an unjustified failure is a smell.

**3. Decisions — the hard-to-reverse bets.** Only the **one-way-door** choices and
the reversible ones near them, each tagged `[irreversible]` or `[reversible]` with
a one-line rationale. Schema/migration shape, public API or wire format, persisted
IDs, auth boundaries, dependency adoption, module layout — get these *right in the
plan*; labelling reversible bets shows where cheap experiments live. Door taxonomy
and rationale discipline: `grounding-and-reuse.md`.

**4. File map — the blast radius at a glance.** A `file-tree` of every touched and
new file, one line each, marking `new` / `mod` / `del`. This is the reviewer's
blast-radius scan and the grounding proof: every path must be real (or clearly
new). A one-file tree usually means you don't need a heavyweight plan.

**5. Per-step changes — reuse before new.** The body. One block per step, prose
stating **what it reuses before what is new** — name the existing function, type,
component or convention you build on *first*, so the plan describes the genuine
delta. Beside each step put the one visual that answers its question — diff/code
fence for an exact edit, Mermaid for flow or data shape, ASCII wireframe for UI —
*next to* the prose, never in a separate gallery. The surface decision table is in
`diagrams-and-wireframes.md`.

**6. Risks & verification — what breaks, how you'd know.** For each material risk:
the failure mode and the concrete check that catches it (the test name, the manual
repro, the metric, the migration dry-run). This is how the reviewer judges the
plan *safe*, and doubles as your post-merge checklist. "Add tests" is not a
verification; "a contract test asserting the 401 path still rejects expired
tokens" is.

**7. Open Questions — the explicit gate.** The 2–4 high-leverage questions whose
answer would change the design and that you *cannot* resolve from code, each marked
`[NEEDS CLARIFICATION]`. Not a dumping ground for "how should I build it" — explore
those yourself; if there are none, write "none". Clarify-vs-assume, batching, and
the approval step are in `open-questions-and-approval.md`. The working ratio for
substantial work skews heavily toward planning: most of the thinking belongs in
sections 1–3 and 7, where mistakes are cheap, not in the code that ships after.

## Worked skeleton

Every section populated tersely — copy the shape, not the content.

````markdown
# Plan: server-persisted sessions
## Outcome
Users stay signed in across devices and restarts: sessions move from an in-memory
map to the existing Postgres store, so a redeploy no longer logs everyone out.
## Approach
A new `sessions` table read by the existing `requireAuth` middleware. Rejected:
JWT-only (can't revoke server-side); Redis (an operational dependency we don't run
— Simplicity Gate). Integration-First: define `SessionStore` + its contract test
before swapping the implementation.
## Decisions
- `[irreversible]` Session id = random 256-bit token, not user-id-derived —
  enables rotation/revocation. Lives in cookie and DB.
- `[reversible]` 30-day sliding expiry — a config constant, trivial to retune.
## File map
```file-tree
src/auth/session-store.ts          # new: SessionStore interface + PG impl
src/auth/require-auth.ts            # mod: read from store, not memory map
src/db/migrations/0007_sessions.sql # new: sessions table + index
test/auth/session-store.test.ts     # new: contract test
```
## Per-step changes
1. **Contract.** Reuse the existing `Store<T>` shape in `src/db/`; add
   `SessionStore` extending it. Write the contract test first.
2. **Migration & lookup swap.** `require-auth.ts` keeps its signature; the body
   changes from map-get to `store.get(token)`.
   ```mermaid
   sequenceDiagram
     Client->>requireAuth: cookie: token
     requireAuth->>SessionStore: get(token)
     SessionStore-->>requireAuth: session | null
     requireAuth-->>Client: 200 | 401
   ```
## Risks & verification
- Expired sessions served as valid → contract test asserts `get` returns null
  past `expires_at`; manual repro with a back-dated row.
- Migration locks a large table → `EXPLAIN` + dry-run on a snapshot first (route
  migration safety to `sql-development`).
## Open Questions
- [NEEDS CLARIFICATION] Migrate existing in-memory sessions, or is a one-time
  forced re-login on deploy acceptable?
````

Before presenting, run a sceptical pass to confirm each section meets its bar
above (`self-review.md`).
