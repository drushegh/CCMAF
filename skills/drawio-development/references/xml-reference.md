# draw.io XML reference

The authoring backbone for `.drawio` (`mxGraphModel`) XML: structure, styles,
edge routing, containers, layers, tags, metadata and dark mode. Consult this
whenever you generate diagram XML. Condensed from the official
`jgraph/drawio-mcp` `shared/xml-reference.md`.

Full style reference (every shape, all style keys, palettes, HTML labels):
<https://www.drawio.com/doc/faq/drawio-style-reference.html> ·
canonical source <https://github.com/jgraph/drawio-mcp/blob/main/shared/xml-reference.md> ·
XSD <https://github.com/jgraph/drawio-mcp/blob/main/shared/mxfile.xsd>.

## General principles

- **Use the semantically correct shape**, not a generic rectangle for
  everything — `rhombus` for a decision, `shape=cylinder3` for a database,
  domain shapes for cloud/network/P&ID. See `diagram-recipes.md` for per-type
  vocabulary.
- **Decide whether you need a shape search.** Skip it for standard geometric
  diagrams (flowchart, UML, ERD, org chart, mind map, Venn, timeline,
  wireframe). Use it only for branded/domain icons (AWS/Azure/GCP, Cisco,
  Kubernetes, BPMN, electrical, P&ID) — a wrong `shape=mxgraph.*` name renders
  as a blank box.
- **Match label language to the user's** (German request → German labels).

## Document structure

Cell `0` is the root; cell `1` is the default layer; everything else uses
`parent="1"` unless it sits in another container or layer.

```xml
<mxGraphModel adaptiveColors="auto">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="2" value="Box" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;" vertex="1" parent="1">
      <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>
```

`adaptiveColors="auto"` enables automatic dark-mode rendering (see below). A
full file may wrap this in `<mxfile><diagram name="Page-1">…</diagram></mxfile>`;
the inner `mxGraphModel` is what matters.

## Common styles

```xml
<mxCell id="r1" value="Label" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
</mxCell>
<mxCell id="d1" value="Condition?" style="rhombus;whiteSpace=wrap;html=1;" vertex="1" parent="1">
  <mxGeometry x="100" y="200" width="120" height="80" as="geometry"/>
</mxCell>
```

| Property | Example | Use for |
|---|---|---|
| `rounded` | `rounded=1` | Rounded corners |
| `whiteSpace` | `whiteSpace=wrap` | Text wrapping |
| `html` | `html=1` | Required for HTML labels, `&#xa;`, `<br>` |
| `fillColor` / `strokeColor` / `fontColor` | `fillColor=#dae8fc` | Colours (hex, or `default`, or `light-dark(...)`) |
| `shape` | `shape=cylinder3` | Named shapes (database, document, etc.) |
| `ellipse` / `rhombus` | style keyword | Circle/oval, diamond |
| `dashed` | `dashed=1` | Dashed stroke |
| `swimlane` / `group` / `container=1` | style keyword | Containers (see below) |
| `pointerEvents` | `pointerEvents=0` | Stop a container capturing child connections |

## Edge routing

**Every edge `mxCell` MUST contain a `<mxGeometry relative="1" as="geometry"/>`
child**, even with no waypoints. A self-closing edge cell does not render.

```xml
<mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;" edge="1" parent="1" source="r1" target="d1">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

draw.io has **no edge collision detection** — plan layout deliberately:

- `edgeStyle=orthogonalEdgeStyle` for right-angle connectors (most common);
  add `rounded=1;orthogonalLoop=1;jettySize=auto` for cleaner smart routing.
- Space nodes generously (≥60px, prefer 200px horizontal / 120–150px vertical);
  align to a 10px grid.
- Control connection sides with `exitX/exitY` and `entryX/entryY` (0–1); spread
  them across sides when a node has several edges, to avoid stacking.
- **Leave ≥20px of straight segment** before a target / after a source so the
  arrowhead (default ~6px) is not crushed against a bend.
- Add explicit waypoints where edges would overlap:

```xml
<mxCell id="e2" style="edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;" edge="1" parent="1" source="r1" target="d1">
  <mxGeometry relative="1" as="geometry">
    <Array as="points">
      <mxPoint x="300" y="150"/>
      <mxPoint x="300" y="250"/>
    </Array>
  </mxGeometry>
</mxCell>
```

- Edge labels: set `value` directly; do **not** wrap them in HTML to shrink
  them (edge labels are already 11px vs 12px for vertices).
- `flowAnimation=1` on an edge style shows a moving dot (good for data-flow /
  pipeline diagrams; renders in SVG export and the desktop app).

## Containers and groups

Use real parent-child containment for architecture diagrams — do **not** stack
shapes on top of bigger shapes. Children set `parent="containerId"` and use
coordinates **relative to the container**.

| Type | Style | When |
|---|---|---|
| Group (invisible) | `group;` (incl. `pointerEvents=0`) | No border, no connections |
| Swimlane (titled) | `swimlane;startSize=30;` | Needs a title bar, or the container itself connects |
| Custom container | add `container=1;pointerEvents=0;` to any shape | A shape acting as a container without its own connections |

```xml
<mxCell id="svc1" value="User Service" style="swimlane;startSize=30;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
  <mxGeometry x="100" y="100" width="300" height="200" as="geometry"/>
</mxCell>
<mxCell id="api1" value="REST API" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="svc1">
  <mxGeometry x="20" y="40" width="120" height="60" as="geometry"/>
</mxCell>
```

Add `pointerEvents=0;` to any container that should not capture child
connections; `swimlane` handles this itself (header stays connectable).

## Layers

A layer is an `mxCell` with `parent="0"` and no `vertex`/`edge`. Cells join via
`parent="layerId"`. Later layers render on top. Add `visible="0"` to hide a
layer by default. Useful for toggleable groupings ("Physical" vs "Logical" vs
"Security").

```xml
<mxCell id="2" value="Annotations" parent="0"/>
<mxCell id="20" value="Note" style="text;html=1;" vertex="1" parent="2">
  <mxGeometry x="100" y="170" width="120" height="30" as="geometry"/>
</mxCell>
```

## Tags (cross-cutting visibility filters)

Tags need an `<object>` wrapper; one element can carry several (space-separated).
Viewers filter via **Edit ▸ Tags**. Tags do not affect z-order or grouping.

```xml
<object id="2" label="Auth Service" tags="critical v2">
  <mxCell style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
    <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
  </mxCell>
</object>
```

## Metadata and placeholders (data-driven labels)

Store custom properties as attributes on `<object>`; set `placeholders="1"` to
substitute `%key%` in the label (needs `html=1`).

```xml
<object id="2" label="&lt;b&gt;%component%&lt;/b&gt;&lt;br&gt;Owner: %owner%&lt;br&gt;Status: %status%" placeholders="1" component="Auth Service" owner="Team Backend" status="Active">
  <mxCell style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
    <mxGeometry x="100" y="100" width="160" height="80" as="geometry"/>
  </mxCell>
</object>
```

Predefined placeholders: `%id% %width% %height% %date% %time% %timestamp%
%page% %pagenumber% %pagecount% %filename%`. Use `%%` for a literal percent.
Resolution walks up: shape → container → layer → root (first match wins).

## Dark mode

- `strokeColor` / `fillColor` / `fontColor` default to `"default"` → black in
  light, white in dark.
- An explicit colour (e.g. `fillColor=#DAE8FC`) is the light colour; dark is
  auto-computed (RGB inversion ~93% + 180° hue rotation).
- For full control: `light-dark(lightColor,darkColor)`, e.g.
  `fontColor=light-dark(#7EA6E0,#FF0000)`.
- Requires `adaptiveColors="auto"` on `mxGraphModel`. Usually you need not
  specify dark colours at all.

## Well-formedness (critical)

- **Never include XML comments (`<!-- -->`)** in output — wasteful, a parse
  risk, and `--` is illegal inside a comment per the XML spec.
- Escape `&amp; &lt; &gt; &quot;` in attribute values.
- Unique `id` on every cell; `html=1` on labelled shapes; `&#xa;` for label
  line breaks (not a literal `\n`).
- Common failures: blank diagram → missing root cells `0`/`1`; invisible edges
  → self-closing edge with no `mxGeometry` child; empty/corrupt export →
  malformed XML. Run `scripts/validate.py` to catch these before delivery.
