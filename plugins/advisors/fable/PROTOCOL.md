# Fable Consultation Protocol — workbench crib sheet

The shared `_advisors/` workbench runs **advisory** design / architecture / workflow
consultations with a Fable subagent, with GUARANTEED model integrity. It is git-ignored (an
entry in the repo's committed `.gitignore`) — scratch space, never shipped state.
`/advisors:fable` (v1 line: `/fable`) drives it, and `/advisors:consult` (v1: `/consult`)
reuses the same workbench for its Fable seat; this file is the reference it cites alongside
`verify-turn.sh`, which Step 0 of that command copies to `_advisors/verify-turn.sh`.

(Legacy: consultations started under the old `_fable/` workbench with `*-response.md` turn
files finish there, verified with `_fable/verify-turn.sh`; new topics always use
`_advisors/`.)

## Two load-bearing facts about any model-overridden subagent

1. **Fresh spawn only.** A fresh `Agent` spawn with `model: "fable"` keeps that model for
   the whole run. **Resuming / continuing an existing agent DROPS the override and silently
   runs on Opus.** So every turn is a NEW spawn; carry continuity via
   `<topic>/conversation.md` (the fresh agent reads it), NEVER by resuming.

2. **Trust the transcript, not the self-report.** Ground truth is the per-message
   `.message.model` in the subagent transcript jsonl. `verify-turn.sh` checks it with `jq`
   — never a grep (the conversation discusses model ids in its *content*, which false-fails
   a grep as "mixed models"). The self-report line only proves the START of a turn; a
   mid-turn swap shows only in the structured per-message field.

## Config

- `FABLE_MODEL` (default `claude-fable-5`) — the required model id. A config value, not a
  hardcoded literal: change it here / in the env if the Fable model id changes.
- `FABLE_TRANSCRIPT_GLOB` — override if your harness stores subagent transcripts somewhere
  other than `~/.claude/projects/*/*/subagents/*.jsonl`.

## One turn

1. **Stage** the question + all needed context into `_advisors/<topic>/conversation.md`
   (the fresh agent has no memory — include prior turns if continuing).
2. **Spawn** a FRESH Fable agent (`model: fable`) whose prompt: pastes the guard clause
   (below); points it at `_advisors/<topic>/conversation.md`; names its output
   `_advisors/<topic>/turns/<NNN>-fable.md`; embeds a unique NONCE to echo.
3. **Verify:** `FABLE_MODEL=… bash _advisors/verify-turn.sh <topic> <NONCE> _advisors/<topic>/turns/<NNN>-fable.md`.
   **Always pass the response path explicitly** — the script's no-argument fallback looks
   for the legacy `turns/*-response.md` name and will not find `-fable.md` turns. PASS →
   append the response into `conversation.md` (promote). FAIL → discard.
4. Next turn = a NEW spawn + NEW nonce. Never resume.

## Mandatory guard clause (paste into every spawn prompt)

> This is NOT a project task. Do NOT run the Cold Start sequence. Do NOT read, write, or
> edit any project STATE / BOARD file — nothing under `.claude/TASKS.md`, `.claude/STATUS.md`,
> `.claude/DECISIONS.md`, `.claude/claude-progress.txt`, `.claude/ECOSYSTEM.md`,
> `.claude/GOTCHAS.md`, `.claude/console/`, or `CLAUDE.md` / `CLAUDE.framework.md`. You ARE
> free to use the Skill tool — skills live under `.claude/skills/`, and consulting them is
> encouraged. Make NO file changes anywhere except the single response file named below.
> Do NOT start background work (no background shells, no background agents) — finish in this
> turn. Write the response file EARLY (a first draft as soon as you have a position) and refine
> it in place, so a stopped seat still leaves a usable file.
> The FIRST LINE OF THE RESPONSE FILE must be this nonce, verbatim: `<NONCE>` — in the file,
> not (only) in your chat reply; verification reads the file.

(Without this clause, CLAUDE.md's gravity makes the subagent run the cold start and edit
state files. The background/early-write lines exist because a seat that backgrounds its work
can stop with NOTHING written, and resume is forbidden — it drops the model override.)

## Advisory-only

Fable here designs and critiques — architecture, workflow, trade-offs, hard forks. It never
enters the build/review loop, never edits code or state. Its output is advice the
orchestrator weighs, not a change it applies.
