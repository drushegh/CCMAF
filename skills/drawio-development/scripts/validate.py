#!/usr/bin/env python3
"""Structural lint for .drawio (mxGraphModel) files. Stdlib only.

Catches the failure modes that produce blank or broken diagrams, before you
deliver or spend a render on them:
  ERROR  missing root cells id="0" / id="1"      (blank diagram)
  ERROR  duplicate id                            (cells clobber each other)
  ERROR  self-closing edge (no <mxGeometry>)      (edge won't render)
  ERROR  dangling edge (source/target id missing) (broken connection)
  ERROR  malformed XML / no <mxGraphModel>
  warn   vertex/edge missing geometry, floating edge, overlapping shapes

Usage:  python3 validate.py <file.drawio> [<file.drawio> ...]
Exit code 1 if any ERROR is found, else 0.
"""
import base64
import sys
import urllib.parse
import xml.etree.ElementTree as ET
import zlib


def _tag(el):
    return el.tag.rsplit('}', 1)[-1]


def _find_models(root):
    """Every <mxGraphModel>, inflating compressed <diagram> payloads if needed."""
    if _tag(root) == 'mxGraphModel':
        return [root]
    models = [el for el in root.iter() if _tag(el) == 'mxGraphModel']
    if models:
        return models
    for el in root.iter():
        if _tag(el) == 'diagram' and (el.text or '').strip():
            try:
                raw = base64.b64decode(el.text.strip())
                xml = urllib.parse.unquote(zlib.decompress(raw, -15).decode('utf-8'))
                models.append(ET.fromstring(xml))
            except Exception:
                pass
    return models


def _cells(model):
    """Effective cells as dicts, unwrapping <object>/<UserObject> wrappers."""
    root = next((el for el in model if _tag(el) == 'root'), None)
    if root is None:
        return []
    out = []
    for child in root:
        t = _tag(child)
        if t == 'mxCell':
            cell_el, cid = child, child.get('id')
        elif t in ('object', 'UserObject'):
            cid = child.get('id')
            cell_el = next((c for c in child if _tag(c) == 'mxCell'), None)
        else:
            continue
        if cell_el is None:
            out.append({'id': cid, 'vertex': False, 'edge': False, 'source': None,
                        'target': None, 'parent': None, 'style': '', 'geom': None})
            continue
        geom = next((g for g in cell_el if _tag(g) == 'mxGeometry'), None)
        out.append({
            'id': cid,
            'vertex': cell_el.get('vertex') == '1',
            'edge': cell_el.get('edge') == '1',
            'source': cell_el.get('source'),
            'target': cell_el.get('target'),
            'parent': cell_el.get('parent'),
            'style': cell_el.get('style') or '',
            'geom': geom,
        })
    return out


def _rect(geom):
    try:
        return (float(geom.get('x')), float(geom.get('y')),
                float(geom.get('width')), float(geom.get('height')))
    except (TypeError, ValueError):
        return None


def _is_container(style):
    s = style.lower()
    return 'group' in s or 'swimlane' in s or 'container=1' in s


def _overlap(a, b, inset=2.0, min_area=100.0):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ax += inset; ay += inset; aw -= 2 * inset; ah -= 2 * inset
    bx += inset; by += inset; bw -= 2 * inset; bh -= 2 * inset
    ix = max(0.0, min(ax + aw, bx + bw) - max(ax, bx))
    iy = max(0.0, min(ay + ah, by + bh) - max(ay, by))
    return ix * iy > min_area


def validate_model(cells):
    errors, warnings = [], []
    ids = [c['id'] for c in cells if c['id'] is not None]
    idset = set(ids)
    for needed in ('0', '1'):
        if needed not in idset:
            errors.append(f'missing required root cell id="{needed}"')
    seen = set()
    for cid in ids:
        if cid in seen:
            errors.append(f'duplicate id "{cid}"')
        seen.add(cid)
    for c in cells:
        if c['edge']:
            if c['geom'] is None:
                errors.append(f'edge id="{c["id"]}" has no <mxGeometry> child '
                              '(self-closing edge will not render)')
            for end in ('source', 'target'):
                ref = c[end]
                if ref and ref not in idset:
                    errors.append(f'edge id="{c["id"]}" {end}="{ref}" '
                                  'references a non-existent cell')
            if not c['source'] and not c['target']:
                warnings.append(f'edge id="{c["id"]}" has neither source nor target')
        elif c['vertex'] and c['geom'] is None:
            warnings.append(f'vertex id="{c["id"]}" has no <mxGeometry>')
    groups = {}
    for c in cells:
        if c['vertex'] and c['geom'] is not None and not _is_container(c['style']):
            r = _rect(c['geom'])
            if r:
                groups.setdefault(c['parent'], []).append((c['id'], r))
    for items in groups.values():
        for i in range(len(items)):
            for j in range(i + 1, len(items)):
                if _overlap(items[i][1], items[j][1]):
                    warnings.append(f'shapes id="{items[i][0]}" and '
                                    f'id="{items[j][0]}" overlap')
    return errors, warnings


def main(argv):
    if not argv:
        print('usage: validate.py <file.drawio> [...]', file=sys.stderr)
        return 2
    total_err = 0
    for path in argv:
        try:
            root = ET.parse(path).getroot()
        except ET.ParseError as e:
            print(f'{path}: ERROR malformed XML: {e}')
            total_err += 1
            continue
        except OSError as e:
            print(f'{path}: ERROR {e}')
            total_err += 1
            continue
        models = _find_models(root)
        if not models:
            print(f'{path}: ERROR no <mxGraphModel> found')
            total_err += 1
            continue
        file_err = file_warn = 0
        for k, model in enumerate(models):
            errs, warns = validate_model(_cells(model))
            for e in errs:
                print(f'{path}[diagram {k + 1}]: ERROR {e}')
            for w in warns:
                print(f'{path}[diagram {k + 1}]: warn  {w}')
            file_err += len(errs)
            file_warn += len(warns)
        total_err += file_err
        if file_err == 0:
            print(f'{path}: OK ({file_warn} warning(s))')
    return 1 if total_err else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
