# Fable Consultation Protocol — workbench crib sheet

This `_fable/` workbench runs **advisory** design / architecture / workflow consultations
with a Fable subagent, with GUARANTEED model integrity. It is git-ignored (an entry in the
repo's committed `.gitignore`) — scratch space, never shipped state. `/fable` drives it;
this file is the reference it instantiates alongside `verify-turn.sh`.

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

1. **Stage** the question + all needed context into `_fable/<topic>/conversation.md` (the
   fresh agent has no memory — include prior turns if continuing).
2. **Spawn** a FRESH Fable agent (`model: fable`) whose prompt: pastes the guard clause
   (below); points it at `_fable/<topic>/conversation.md`; names its output
   `_fable/<topic>/turns/<NNN>-response.md`; embeds a unique NONCE to echo.
3. **Verify:** `FABLE_MODEL=… bash _fable/verify-turn.sh <topic> <NONCE>`. PASS → append the
   response into `conversation.md` (promote). FAIL → discard.
4. Next turn = a NEW spawn + NEW nonce. Never resume.

## Mandatory guard clause (paste into every spawn prompt)

> This is NOT a project task. Do NOT run the Cold Start sequence. Do NOT read, write, or
> edit anything under `.claude/`, `CLAUDE.md`, or any state / board file — you are a pure
> advisor. Read only what this prompt points you at; write ONLY the single response file
> named below. Echo this nonce verbatim on your first line: `<NONCE>`.

(Without this clause, CLAUDE.md's gravity makes the subagent run the cold start and edit
state files.)

## Advisory-only

Fable here designs and critiques — architecture, workflow, trade-offs, hard forks. It never
enters the build/review loop, never edits code or state. Its output is advice the
orchestrator weighs, not a change it applies.
