---
name: drawio-development
description: >-
  Author draw.io / diagrams.net diagrams as native, committable .drawio
  (mxGraphModel XML) — flowcharts, architecture and network diagrams, ERDs,
  UML class/sequence diagrams, mind maps, wireframes, BPMN, and cloud
  (AWS/Azure/GCP) or Kubernetes topologies — then deliver per environment
  (write the file, export PNG/SVG/PDF via the desktop CLI, or generate an
  app.diagrams.net URL) and verify the rendered result. Use whenever a task
  involves creating, editing, exporting or reviewing a diagram, or mentions
  draw.io, drawio, .drawio, diagrams.net or mxGraphModel. Triggers include
  .drawio files, "draw a diagram/flowchart/architecture diagram", "diagram
  our solution/data model", and editable-diagram artifacts for a proposal or
  design doc. PROACTIVELY activate before hand-writing mxGraphModel XML. Owns
  draw.io XML authoring, delivery and verification; the render→critique loop
  is ui-verification and Mermaid/CSV input needs draw.io server-side
  conversion (see references/delivery-and-export.md).
---

# draw.io Development

Generate draw.io diagrams as **native `.drawio` files** — plain `mxGraphModel`
XML you author directly. A `.drawio` is a text artifact: committable, diffable,
versionable, and the input to PNG/SVG/PDF export. That suits a
dev/docs workflow far better than throwaway browser tabs.

**The core reframe:** authoring the diagram *is* generating XML. That is pure
text generation and needs **no MCP server and no CLI**. Tooling (desktop CLI,
`#create=` URL, MCP) is only the *delivery* step — render it, open it, or export
it. Invest effort in correct XML and a sensible layout; pick the cheapest
delivery per environment.

## Non-negotiables (these prevent broken diagrams)

1. **Root scaffold always.** Every model has `mxCell id="0"` and
   `mxCell id="1" parent="0"`; all content uses `parent="1"` unless it sits
   in another container/layer. Missing roots → a blank diagram.
2. **Every edge carries its geometry child.** An edge `mxCell` MUST contain
   `mxGeometry relative="1" as="geometry"` even with no waypoints. A
   self-closing edge cell does **not** render.
3. **Never emit XML comments.** They waste tokens, risk parse
   errors, and `--` is illegal inside XML comments per the spec.
4. **Well-formedness.** Escape `&amp; &lt; &gt; &quot;` in attribute values;
   unique `id` on every cell; `html=1` on labelled shapes; use `&#xa;` for line
   breaks in `value` (never a literal `\n`).
5. **There is no edge collision detection.** Lay out on purpose — space nodes,
   leave routing corridors, and control connection sides. See
   `references/diagram-recipes.md`.
6. **Dark mode is automatic.** Set `adaptiveColors="auto"` on `mxGraphModel`
   and let draw.io invert; only hand-specify dark colours with `light-dark()`
   when the auto-inverse is wrong.

## Workflow

1. **Scope.** If genuinely underspecified, ask 1–3 focused questions (diagram
   type, output format, fidelity/component count). Skip for clearly simple
   requests.
2. **Author the XML.** Pick the matching preset in `references/diagram-recipes.md`
   (ERD, UML class, sequence, architecture, ML/DL, flowchart) for the right
   shapes, edge styles and layout direction. Hand-place coordinates for small,
   styled diagrams; for large graphs (over ~15 nodes, dependency/call graphs,
   codebase structure) auto-layout is the better tool — see **Boundaries**.
3. **Shapes.** Skip shape search for standard geometric types (flowchart, UML,
   ERD, org chart, mind map, Venn, timeline, wireframe — rectangles, diamonds,
   ellipses, cylinders, arrows). For **branded/domain icons** (AWS/Azure/GCP,
   Cisco/network, Kubernetes, BPMN, P&ID, electrical) get the **exact**
   `shape=mxgraph.*` style string — a wrong name renders as a blank box. See
   **Boundaries** for the shape-index tool.
4. **Validate.** Run `scripts/validate.py yourfile.drawio` — a fast, dependency-
   free structural lint (root cells, duplicate/missing ids, dangling edge
   source/target, self-closing edges, gross overlaps) before you deliver.
5. **Deliver** per environment — see `references/delivery-and-export.md`.
6. **Verify the render.** Where a renderer **and** vision are both available,
   export a preview, look at it, auto-fix layout faults, then show the user and
   iterate — see `references/verify-and-iterate.md`. Otherwise deliver the
   `.drawio` (and preview if you have one) directly.

## Delivery at a glance

| Environment | What to produce |
|---|---|
| **Claude Code / VS Code** (local files) | Write `.drawio` in the working tree; export PNG/SVG/PDF via the draw.io Desktop CLI (`-e`, stays editable) if installed, else keep the `.drawio` |
| **Cowork** (connected folder, ephemeral sandbox, no desktop draw.io) | Write `.drawio` into the folder; optionally generate an `app.diagrams.net` `#create=` URL |
| **claude.ai** (sandbox, no local files/CLI) | Downloadable `.drawio` + a Python-generated `#create=` URL surfaced as an HTML-artifact button |

Detail — binary paths, WSL2, export flags, the URL encoders, MCP add-on, and the
CLI gotchas — in `references/delivery-and-export.md`.

## Output format

| User asks for | Produce |
|---|---|
| *(no format)* | `name.drawio` only — the file is the deliverable |
| `png` / `svg` / `pdf` | Export **with embedded XML** (`-e`) so it stays editable; name `name.drawio.png` etc. |
| `url` | An `app.diagrams.net` `#create=` URL that opens the diagram; keep the `.drawio` as the local copy |

## Reference index

Load on demand:

- `references/xml-reference.md` — the authoring backbone: structure, styles,
  edge routing, containers/groups, layers, tags, metadata/placeholders, dark
  mode, and the well-formedness rules.
- `references/diagram-recipes.md` — per-type presets (ERD/UML/sequence/
  architecture/ML/flowchart) with exact style strings, plus layout discipline
  (spacing by complexity, routing corridors, entry/exit distribution).
- `references/delivery-and-export.md` — environment detection and delivery:
  desktop CLI flags + binary paths (incl. WSL2), the `#create=` URL encoders
  (Node and Python), open commands, CLI/export gotchas, MCP as an optional
  add-on.
- `references/verify-and-iterate.md` — the render → self-check → fix → user-
  review loop, the self-check fault table, and targeted-edit rules.

## Boundaries

- **Mermaid and CSV inputs** require draw.io's **server-side conversion** and
  cannot be written as native files by the model — route them through
  `app.diagrams.net` or the hosted MCP server (see
  `references/delivery-and-export.md`). This skill authors **native XML**.
- **The general render → critique → iterate methodology** is owned by
  `ui-verification`; this skill applies it specifically to diagrams.
- **Colour contrast and non-colour encoding** (don't rely on colour alone) →
  `accessibility-development`.
- **Embedding diagrams into Word/PowerPoint deliverables** → your docx/pptx
  tooling (export SVG/PNG here, place it there).
- **Heavy tooling — Graphviz auto-layout, codebase→diagram importers
  (Py/JS/Go/Rust), the 10k-shape search index, and AI/LLM brand logos** — is
  solved by the MIT-licensed **`Agents365-ai/drawio-skill`**. Prefer installing
  or vendoring that skill over reimplementing those scripts here; this skill
  deliberately stays a portable knowledge + delivery layer.
