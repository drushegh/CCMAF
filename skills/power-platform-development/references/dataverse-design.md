# Dataverse Design (Maker Level)

Schema and configuration decisions from the maker/low-code side, distilled
from Microsoft's official dataverse-skills plugin. Pro-code operations
(SDK/Web API CRUD, plug-ins, query mechanics) live in
dynamics-365-development — this file is about designing the schema well.

## Publisher and naming

- Create/select a **publisher with a meaningful prefix** before any
  schema work; never customise under the default publisher (`new_`).
- Table names singular (`Project`, not `Projects`); Dataverse generates
  plural collection/entity-set names itself.
- **Never suffix custom columns with `Id`** — a custom column
  `contoso_projectid` collides with the auto-generated primary key /
  lookup naming pattern and produces baffling errors later. Name the
  lookup after the relationship (`contoso_project`).
- Record the **logical names** of everything you create and report them
  back — display names drift, logical names are the contract.

## Column type decisions

| Decision | Rule |
| --- | --- |
| Choice vs lookup | Choice = fixed schema-level list (statuses, categories that change via ALM). Lookup = the list is *data* (managed by users, has attributes, grows) |
| Local vs global choice | Global when any chance of reuse across tables — converting later is painful |
| Text vs memo | Text (≤4,000) for names/codes; memo for descriptions. Searchable large text on lists/views hurts performance |
| Calculated/formula vs code | Formula (Power Fx) columns first; rollups for aggregates-over-children; plug-ins only when those can't express it (→ dynamics-365-development) |
| Alternate keys | Required for upsert semantics and reliable external-system integration; define them at design time, not retrofit |

## Relationships

- 1:N via lookup column on the child. Configure cascade behaviour
  deliberately (assign/share/delete) — default cascades surprise people
  at delete time.
- N:N: native many-to-many only when you need nothing on the
  relationship; the moment the link needs attributes (dates, roles,
  quantities), build an explicit **intersect table** with two lookups.
- Hierarchies (self-referential) support hierarchical security and
  rollups — prefer over hand-rolled parent pointers.

## Environment-first vs solution-aware workflow

Make schema changes **in the dev environment inside the target solution**
(or add to the solution immediately after creation) so the change travels.
Components created loose in the environment must be added with all
required dependencies before export — missing dependencies are the most
common import failure.

## Operational realities

- **Metadata propagation delays**: a just-created table/column may not be
  immediately usable; concurrent metadata operations hit lock contention.
  Sequence schema operations and verify each before depending on it.
- Idempotency: check-then-create (409 / "already exists" handling) for
  any scripted schema work; safe re-runs beat one-shot scripts.
- Business rules cover simple show/hide/require/set-value logic on forms
  — use before JavaScript; they run server-side for some actions and are
  solution-aware.
- Security: tables get ownership (user/team vs organization) at creation
  and it **cannot be changed after** — user-owned unless the data is
  genuinely global reference data. Security roles, column security
  profiles, and business units do the access work; apps never implement
  their own row filtering as a security boundary.
- Auditing is per-table opt-in plus org-level switch; enable on tables
  with compliance relevance at design time.

Docs: https://learn.microsoft.com/power-apps/maker/data-platform/ ·
https://learn.microsoft.com/power-apps/maker/data-platform/create-edit-entities ·
https://learn.microsoft.com/power-platform/admin/wp-security-cds
