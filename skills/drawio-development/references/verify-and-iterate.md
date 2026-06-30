# Verify & iterate (render → self-check → review)

A diagram is only correct once you've **looked at the rendered image** — XML
that parses can still overlap, clip labels or stack edges. This is the
`ui-verification` render→critique→iterate loop applied to diagrams. Method
condensed from `Agents365-ai/drawio-skill`.

**Applies when a renderer *and* vision are both available** (desktop CLI +
a vision-capable model, or Cowork where you can render and see the PNG). If
either is missing, run `scripts/validate.py` (structural lint), deliver the
`.drawio`/preview, and skip the visual self-check.

## The loop

1. **Validate structurally** — `python3 scripts/validate.py diagram.drawio`
   catches dangling edges, duplicate/missing ids, self-closing edges, missing
   root cells and gross overlaps before you spend a render on it.
2. **Export a preview** — PNG **without `-e`**, width-capped:
   `drawio -x -f png --width 2000 -o diagram.png diagram.drawio`. (`-e` PNGs
   have a truncated IEND chunk that vision APIs reject; `-s 2` overshoots the
   2576px vision ceiling.)
3. **Self-check** — read the PNG and auto-fix the faults below. **Max 2
   rounds**; re-export and re-read after each fix, then show the user even if
   something remains.
4. **User review** — show the image, collect feedback, apply the *minimal* XML
   edit (table below), re-export, repeat. After ~5 rounds, suggest the user
   open the `.drawio` in draw.io Desktop for fine-tuning.
5. **Final export** — re-export the approved diagram to the requested formats
   **with `-e`** (`name.drawio.png`) so it stays editable. If you need to view
   or validate that final PNG, note the `-e` IEND truncation — re-export
   without `-e` for viewing, or run a PNG-repair pass (see
   `Agents365-ai/drawio-skill` `scripts/repair_png.py`). SVG/PDF are unaffected.

## Self-check faults → auto-fix

| Fault | What to look for | Fix |
|---|---|---|
| Overlapping shapes | Two shapes stacked | Shift apart by ≥200px |
| Clipped label | Text cut at the shape edge | Increase width/height to fit |
| Missing connection | Arrow not touching a shape | Check `source`/`target` ids exist |
| Off-canvas shape | Negative coords / far from the cluster | Move to positive coords near the group |
| Edge through a shape | An edge crosses an unrelated shape | Add waypoints to route around, or increase spacing |
| Stacked edges | Several edges share a path | Distribute exit/entry points across the perimeter |

## Targeted edits (review feedback → minimal XML change)

| Request | Edit |
|---|---|
| Recolour X | Find the `mxCell` by `value`; update `fillColor`/`strokeColor` |
| Add a node | Append an `mxCell` vertex with the next id, near related nodes |
| Remove a node | Delete the `mxCell` and any edges referencing its id |
| Move X | Update `x`/`y` in its `mxGeometry` |
| Resize X | Update `width`/`height` in its `mxGeometry` |
| Add arrow A→B | Append an edge `mxCell` with `source`/`target` = A/B ids |
| Change label | Update the `value` attribute |
| Change layout direction | **Full regeneration** — rebuild the XML in the new orientation |

For single-element changes, edit the XML in place (preserves prior layout
tuning). For layout-wide changes (LR↔TB, "start over"), regenerate. Overwrite
the same preview filename each iteration — don't accumulate `v1`/`v2`/`v3`.
