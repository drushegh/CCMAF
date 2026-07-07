# Sessions fixtures

Synthetic Claude Code transcript files matching the VERIFIED on-disk schema
(`~/.claude/projects/<slug>/…`, Claude Code 2.1.x): a main `<uuid>.jsonl`
with Task/Agent `tool_use` spawns, per-subagent `agent-<id>.jsonl` +
`agent-<id>.meta.json` sidecars, a sync-completed agent, a background agent
(async-launch ack only), a nested (depth-2) agent, and malformed lines.

No real conversation content — everything here is invented for the tests.
`transcript-parser.test.ts` copies these into a tmp `CLAUDE_PROJECTS_DIR`
layout at run time (the slug is computed from the tmp project root) and
controls file mtimes with `utimesSync` for the live-vs-done assertions.
