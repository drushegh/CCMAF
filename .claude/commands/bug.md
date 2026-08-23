Log an **ad-hoc bug** straight into the board from chat — a defect noticed outside a
verify story (in conversation, while reading code, from a stack trace, etc.).

> **Step 0 — v2 self-route (read this first):** if `.claude/.framework-version` contains a
> `FRAMEWORK_LINE=v2` line, this project runs the CCMAF v2 plugins — invoke the
> `ccmaf:bug` skill (Skill tool) and follow IT instead of this file; stop reading
> here. This bare command is the v1-line copy, kept as authored source.

**Goal:** capture the bug into `.claude/TASKS.md` immediately, in the EXACT on-disk
shape a board projection writes, so the two bug-intake paths never diverge:

- **verification-driven bugs** → raised by a verify tool's "flag as bug" (loop-coupled:
  it sets the use-case's `bugId`+round and drives the auto-retest). NOT this command.
- **ad-hoc bugs** → this `/bug` command. No dependency on any external tool running —
  it just writes the bug block; a board projection that reads the bug lane shows it
  automatically.

The shape below is the **shared contract** (`contract:state-file-grammar` + the
bundled Console's `POST /api/bugs`): `/bug` and the Console's verify tool emit
**byte-identical** bug blocks, so the Kanban never drifts.

The bug title/severity/symptom come from the user's `/bug …` message (or ask one
concise clarifying question if the title is unclear).

---

## 1. Read the current bug lane

Read `.claude/TASKS.md`. Locate the **`## Bug-Fix Lane`** and its **`### Reported`**
section. Collect every existing bug id with `grep -oE '\[BUG-[0-9]+\]' .claude/TASKS.md`.

## 2. Allocate the next id — **HARD (parse-critical)**

- `n` = (highest existing `BUG-<number>` across the whole file) **+ 1**. If there are
  no bugs yet, `n = 1`.
- Format **bracketed and zero-padded to 3 digits**: `[BUG-001]`, `[BUG-013]`, … This
  matches a board tool's `nextBugId` (max existing BUG number + 1), so both writers
  agree on the next id.

## 3. Dedup check — confirm before creating a near-duplicate

Scan the existing `### Reported` (and `### Fixing`/`### Verify`) titles. If the new bug
looks like a near-duplicate of an open one, **stop and ask the user** whether to file
anyway or annotate the existing entry. Otherwise continue.

## 4. Write the block — **HARD heading, SOFT body**

Insert into the **`### Reported`** section. If that section contains only a lone
`_(none)_` placeholder, **replace** it; otherwise **append after** the existing
`### Reported` entries (and before the next `###`/`##` heading). Use today's date
(`YYYY-MM-DD`).

Exact shape (match it verbatim — this is what a board tool writes):

    #### [BUG-n] <title> — Reported <YYYY-MM-DD>
    - **Severity:** <P0|P1|P2|P3>
    - **Source:** ad-hoc (reported via /bug)
    - **Reported:** <YYYY-MM-DD> by <author>
    - **Symptom:** <description>

Rules:
- **Severity** — use the user's stated severity; **default `P2`** when unstated
  (P0 blocking · P1 major · P2 minor · P3 cosmetic).
- **Source** — `ad-hoc (reported via /bug)`. If the user says "bug in TASK-X" (or
  references a task/use-case), append the back-link on the same line, e.g.
  `ad-hoc (reported via /bug) · TASK-X`.
- **Symptom** — include only when the user described one; omit the line otherwise.
- **Heading** — bracketed `#### [BUG-n]` (level-4) is mandatory; a bare or level-3
  heading is silently dropped by board parsers (`contract:state-file-grammar`).

## 5. Confirm

Report the created id, severity, and the lane it landed in, e.g.
`✓ Logged [BUG-013] (P2) in Bug-Fix Lane → Reported.` Do NOT start fixing it — `/bug`
only files; triage/fix happens via the normal Bug-Fix lifecycle
(Reported → Fixing → Verify → Done).

(State-file rule: this is a `.claude/TASKS.md` change — it counts as a state-file
update. Commit it with the bug id, per the Commit Convention, when you next commit.)
