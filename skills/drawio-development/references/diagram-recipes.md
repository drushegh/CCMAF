# Diagram recipes & layout discipline

Per-type presets (shapes, edge styles, layout direction) and the layout rules
that keep a diagram readable. Style strings condensed from
`Agents365-ai/drawio-skill` `references/diagram-types.md` and its layout
guidance; polish points from `softaworks/agent-toolkit`. Pick the recipe by the
user's phrasing, then layer colour/branding on top.

## Layout discipline (applies to every recipe)

**Spacing scales with complexity** — gaps are centre-to-centre guidance:

| Complexity | Nodes | Horizontal gap | Vertical gap |
|---|---|---|---|
| Simple | ≤5 | 200px | 150px |
| Medium | 6–10 | 280px | 200px |
| Complex | >10 | 350px | 250px |

- **Routing corridors:** leave ~80px of empty space between rows/columns for
  edges to travel; never drop a shape into a gap edges must cross.
- **Distribute connections.** When a shape has N edges on one side, spread the
  exit/entry points evenly so lines don't stack:

  | Position | exitX/entryX | exitY/entryY |
  |---|---|---|
  | Top centre | 0.5 | 0 |
  | Right centre | 1 | 0.5 |
  | Bottom centre | 0.5 | 1 |
  | Left centre | 0 | 0.5 |

  Three edges on the bottom → `exitX = 0.25, 0.5, 0.75`.
- **Hub / event-bus pattern:** place a heavily-connected node (Kafka, a bus, a
  load balancer) in the *centre* of its row so peers reach it with short
  horizontal arrows (`exitX=1` on the left, `exitX=0` on the right) — this
  eliminates crossings.
- **Tree/hierarchy:** assign nodes to layers (rows) and connect only adjacent
  layers; centre a child under its parent (same centre x) to avoid diagonals.
- **Grid:** snap every `x/y/width/height` to multiples of 10.

Polish (from softaworks): keep arrows visually behind boxes (declare edges
early in `<root>`); leave ≥20px between an arrow and a label; give a shape inside
a frame ≥30px margin from the frame edge; nudge a crowded edge label off the
line with an `offset` point (`<mxPoint x="0" y="-40" as="offset"/>`).

**Progressive disclosure:** for a complex system, prefer several staged diagrams
(context → container/system → component → deployment → data-flow → sequence)
over one dense diagram.

## Colour palette (when no brand/style preset applies)

| Role | fillColor | strokeColor |
|---|---|---|
| Service / client | `#dae8fc` | `#6c8ebf` |
| Success / database | `#d5e8d4` | `#82b366` |
| Queue / decision | `#fff2cc` | `#d6b656` |
| Gateway / API | `#ffe6cc` | `#d79b00` |
| Error / alert | `#f8cecc` | `#b85450` |
| External / neutral | `#f5f5f5` | `#666666` |
| Security / auth | `#e1d5e7` | `#9673a6` |

## ERD (entity-relationship)

| Element | Style |
|---|---|
| Table | `shape=table;startSize=30;container=1;collapsible=1;childLayout=tableLayout;fixedRows=1;rowLines=0;fontStyle=1;strokeColor=#6c8ebf;fillColor=#dae8fc;` |
| Row (column) | `shape=tableRow;horizontal=0;startSize=0;swimlaneHead=0;swimlaneBody=0;fillColor=none;collapsible=0;dropTarget=0;points=[[0,0.5],[1,0.5]];portConstraint=eastwest;fontSize=12;` (child of the table) |
| PK column | `fontStyle=1` on the row; prefix `PK` |
| FK relationship | `dashed=1;endArrow=ERmandOne;startArrow=ERmandOne;` |

Layout TB, tables ~300px apart; group related tables.

## UML class

| Element | Style |
|---|---|
| Class box | `swimlane;fontStyle=1;align=center;startSize=26;html=1;` (title / attributes / methods) |
| Section separator | `line;strokeWidth=1;fillColor=none;align=left;verticalAlign=middle;spacingTop=-1;spacingLeft=3;spacingRight=10;rotatable=0;labelPosition=left;points=[];portConstraint=eastwest;` |
| Inheritance | `endArrow=block;endFill=0;` (hollow triangle) |
| Implementation | `endArrow=block;endFill=0;dashed=1;` |
| Composition | `endArrow=diamondThin;endFill=1;` |
| Aggregation | `endArrow=diamondThin;endFill=0;` |

Layout TB, classes ~250px apart; interfaces above implementations.

## Sequence

| Element | Style |
|---|---|
| Lifeline | `shape=umlLifeline;perimeter=lifelinePerimeter;whiteSpace=wrap;html=1;container=1;collapsible=0;recursiveResize=0;outlineConnect=0;portConstraint=eastwest;` |
| Sync message | `html=1;verticalAlign=bottom;endArrow=block;` |
| Async message | `html=1;verticalAlign=bottom;endArrow=open;dashed=1;` |
| Return | `html=1;verticalAlign=bottom;endArrow=open;dashed=1;strokeColor=#999999;` |

Lifelines ~200px apart (LR); time flows top→bottom.

## Architecture

| Element | Style |
|---|---|
| Layer/tier | `swimlane;startSize=30;` (Client / API / Service / Data) |
| Service | `rounded=1;whiteSpace=wrap;html=1;` + tier colour |
| Database | `shape=cylinder3;whiteSpace=wrap;html=1;` (green) |
| Queue/bus | `rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;` (centre it — hub pattern) |
| External | `rounded=1;dashed=1;fillColor=#f5f5f5;strokeColor=#666666;` |

Layout by tier count; ≥4 tiers → TB. For branded cloud icons get the exact
`shape=mxgraph.aws4.*` / Azure / GCP style (see SKILL.md → Boundaries).

## ML / deep-learning model

| Element | Style |
|---|---|
| Input/Output | `rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;` |
| Conv / pooling | `…fillColor=#dae8fc;strokeColor=#6c8ebf;` |
| Attention / Transformer | `…fillColor=#e1d5e7;strokeColor=#9673a6;` |
| RNN / LSTM / GRU | `…fillColor=#fff2cc;strokeColor=#d6b656;` |
| FC / Linear | `…fillColor=#ffe6cc;strokeColor=#d79b00;` |
| Skip connection | `dashed=1;endArrow=block;curved=1;` |

Layout TB, layers ~150px apart; annotate tensor shapes on a second label line,
e.g. `value="Conv2D&#xa;(B, 64, 32, 32)"`; group encoder/decoder as swimlanes.

## Flowchart

| Element | Style |
|---|---|
| Start/End | `ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;` |
| Process | `rounded=0;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;` |
| Decision | `rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;` |
| I/O | `shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;` |

Layout TB, ~200px vertical gap; **always label decision branches** (`Yes`/`No`
on the edges); branches go LR then merge back to centre.
