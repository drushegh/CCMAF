Follow the Cold Start sequence (steps 0-9 from CLAUDE.framework.md — the canonical list lives there; CLAUDE.md merely @imports it).

Then, acting as the project architect:

1. Do the pre-task context check. If projected >= 90%, ask user.
2. Read all documents in .claude/framework/docs/requirements/
   - If there are many documents or they are large, use subagents to read
     and summarise them. Only bring the summaries into main context.
3. For EXISTING projects with code already in place:
   - Use subagents to explore the codebase and understand what exists
   - Identify relevant existing modules, endpoints, models, and patterns

4. **Structured Interview** — Use the AskUserQuestion tool to fill gaps.
   Do NOT free-form interview. Structure questions into focused batches
   of 1-4 questions each, using the tool's option format so the user
   picks from concrete choices (with "Other" always available for
   free-text). This produces cleaner, more consistent input for the spec.

   Run the following interview phases in order. Skip any phase where
   the requirements documents already provide clear answers.

   **Phase A — Scope & User Stories:**
   - Who are the primary users/actors?
   - What are the core user stories? (present candidates from requirements,
     ask user to confirm, add, or remove)
   - What is explicitly OUT of scope for this iteration?

   **Phase B — Functional Requirements:**
   - For each user story: what are the acceptance criteria?
   - What are the key business rules and constraints?
   - What are the edge cases? (present the ones you identified from
     requirements, ask if there are others)

   **Phase C — Non-Functional Requirements:**
   - Performance targets (response times, throughput)
   - Security requirements (auth, rate limiting, data sensitivity)
   - Scalability expectations

   **Phase D — Integration & Dependencies:**
   - External systems or APIs to integrate with?
   - Existing codebase constraints or patterns to follow?
   - Any hard deadlines or phasing requirements?

   For each phase, batch related questions into a single AskUserQuestion
   call (up to 4 questions). Use multiSelect when choices aren't
   mutually exclusive. Put your recommended option first with
   "(Recommended)" in the label. Use preview blocks when presenting
   concrete artifacts like API shapes or data models for the user
   to compare.

   Keep iterating until you have enough to write the spec. If a user's
   answer raises new questions, ask follow-ups in the next batch.

5. Write a spec to .claude/framework/docs/specs/SPEC-[name].md
   - For existing projects: include a Gap Analysis section
     (what exists, what's needed, what needs modification)
   - Each acceptance criterion in the spec should trace back to a
     specific user answer from the interview
6. Record any decisions made during analysis in DECISIONS.md (or per-file `decisions/`, per project CLAUDE.md)
7. Update STATUS.md and claude-progress.txt when done

The interview and spec writing stay in main context (interactive).
Document reading and codebase exploration may use subagents to save context.
After this, run /plan to turn the spec into contracts and tasks.
