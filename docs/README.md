# Project docs — supplementary material the Console surfaces

This folder is the project's **supplementary documentation**: anything that informs the
work but isn't a state file, a spec, or app code. The Project Console surfaces it under its
**Docs** tab — it reads `<project root>/docs/` (and, where present, `01_Project/docs/`) as a
live tree — so everything the human gathers lives in one browsable place instead of being
scattered or stuck in chat.

**Agents: deposit material here as you work** — inspiration you found, research that
informs a decision, a diagram you drew, a screenshot. Don't let it live only in the
conversation; put it here so the human (and the next session) can see it in the Console.

What goes where:

- `inspiration/` — reference material, examples, prior art, screenshots of things to emulate.
- `research/` — findings, comparisons, distilled external docs, decision-support notes.
- `images/` — screenshots, photos, mockups, any image referenced by the docs.
- `diagrams/` — architecture / flow diagrams (drawio / svg / png), exported for viewing.

(Add your own subfolders as needed — the Console renders the whole tree.)

Supported by the Console's Docs viewer: Markdown (`.md`), text (`.txt`), JSON (`.json`),
and images (`.png .jpg .jpeg .gif .svg .webp`). Other file types are not served.

**Related framework doc locations** (separate Console surfaces — NOT here):

- **Specs** — produced by `/analyse` → `/plan` and versioned/extended over the project's
  life → `.claude/framework/docs/specs/` (Console **Specs** tab).
- **Requirements** → `.claude/framework/docs/requirements/`.
- **Plans** → `.claude/framework/docs/plans/`.
- **State files** (tasks / status / decisions / contracts / gotchas / suggestions) →
  `.claude/` (each has its own Console tab).
