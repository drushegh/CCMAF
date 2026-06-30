# {{PROJECT_NAME}}

<!--
  This file is PROJECT-OWNED. Put project-specific instructions here
  (tech stack, commands, domain rules). Framework-shipped instructions
  (cold start, state file rules, agent rules, etc.) live in
  CLAUDE.framework.md and are updated by .claude/framework/update/.

  IMPORTANT: Claude Code auto-loads ONLY CLAUDE.md and CLAUDE.local.md —
  there is no CLAUDE*.md wildcard, and plain markdown links are NOT
  followed. CLAUDE.framework.md reaches the session context solely via
  the @import on the line below. Do not remove or reword it into a
  link, or every framework rule silently drops out of your sessions.
-->

**Framework instructions (required):** @CLAUDE.framework.md

The imported Cold Start Sequence is authoritative — this file is for *project-specific additions* (tech stack, commands, path mapping, domain rules), NOT a competing cold-start list.

## What

{{One-two line project description}}

## Tech Stack

- Language: {{e.g. TypeScript}}
- Backend: {{e.g. Node.js + Express}}
- Frontend: {{e.g. React + Tailwind CSS}}
- Database: {{e.g. PostgreSQL + Prisma}}
- Testing: {{e.g. Vitest + Playwright}}

## Commands (run from 01_Project/)

    cd 01_Project && npm run dev          # Start dev server
    cd 01_Project && npm test             # Run test suite
    cd 01_Project && npm run build        # Production build

## Project-Specific Notes

<!-- Add anything specific to this project here:
     - Non-obvious setup steps
     - Team conventions that deviate from the framework defaults
     - External service accounts, env vars, or credentials the project needs
     - Pointers to project wikis, Slack channels, ticketing systems -->
