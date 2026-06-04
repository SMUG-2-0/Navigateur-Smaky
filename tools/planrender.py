#!/usr/bin/env python3
"""Prototype de rendu .PLAN -> SVG (validation visuelle du décodage).

Usage : python3 planrender.py fichier.plan [sortie.svg]
Voir docs/plan-format.md pour le format. Les coordonnées fichier sont (y,x),
origine bas-gauche, Y vers le haut ; on bascule en SVG via la bounding-box.
"""
import struct
import sys


def s(w):
    return w - 0x10000 if w >= 0x8000 else w


import math

# Arc (op 11) : octet haut = masque de quadrants, 2 bits par quadrant.
# (masque, angle_début, angle_fin) en degrés math (sens trigo, Y vers le haut).
QUADRANTS = [(0x03, 0, 90), (0x0C, 90, 180), (0x30, 180, 270), (0xC0, 270, 360)]


def arc_points(cx, cy, rx, ry, mod, step=8):
    """Points (x,y) monde des quadrants actifs du masque (Y vers le haut)."""
    runs = []
    for mask, a0, a1 in QUADRANTS:
        if mod & mask:
            pts = []
            for k in range(step + 1):
                a = math.radians(a0 + (a1 - a0) * k / step)
                pts.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
            runs.append(pts)
    return runs


def records(data):
    """Itère (offset, opword, [8 mots]) en sautant l'en-tête (1er enr.)."""
    for i in range(16, len(data) - 15, 16):
        w = struct.unpack('>8H', data[i:i + 16])
        yield i, w[0], w


def parse(data):
    """Renvoie une liste de primitives normalisées (coords signées)."""
    prims = []
    for off, opw, w in records(data):
        if opw >= 0xFFF0:        # sections de bibliothèque (-1..-6 = 0xFFFF..0xFFFA)
            continue
        typ = opw & 0xFF         # type = octet bas ; modificateur = octet haut
        mod = opw >> 8
        if typ in (0x64, 0x65, 0x66, 0x67):   # marqueurs structurels (groupes…)
            continue
        a, b, c, d, attr = (s(w[1]), s(w[2]), s(w[3]), s(w[4]), w[5])
        if typ in (0, 1, 2, 3, 4):              # segments / droites : (y1,x1,y2,x2)
            prims.append(('line', a, b, c, d, attr, typ))
        elif typ == 5:                          # cercle/point : [255, rayon, cy, cx]
            prims.append(('circle', d, c, b, attr))   # cx=w4, cy=w3, r=w2
        elif typ == 6:                          # rectangle : (y1,x1,y2,x2), mod=arrondi
            prims.append(('rect', a, b, c, d, attr, mod, False))
        elif typ == 7:                          # surface remplie
            prims.append(('rect', a, b, c, d, attr, 0, True))
        elif typ == 8:                          # caractère de texte : [_, code, y, x]
            prims.append(('char', d, c, w[2] & 0xFF, attr))   # x=w4, y=w3
        elif typ == 9:                          # arc de cercle : [masque, rayon, cy, cx]
            prims.append(('ellipse', d, c, b, b, a, attr, True))
        elif typ in (10, 11):                   # ellipse : [ry, rx, cy, cx] (centre+rayons)
            prims.append(('ellipse', d, c, b, a, mod, attr, typ == 11))  # cx,cy,rx,ry,mod,attr,arc
        elif typ == 12:                         # flèche : (y1,x1,y2,x2)
            prims.append(('arrow', a, b, c, d, attr))
    return prims


def bbox(prims):
    xs, ys = [], []
    for p in prims:
        k = p[0]
        if k in ('line', 'arrow', 'rect'):
            _, y1, x1, y2, x2 = p[:5]
            xs += [x1, x2]; ys += [y1, y2]
        elif k in ('circle', 'ellipse'):
            cx, cy, rx, ry = (p[1], p[2], p[3], p[3]) if k == 'circle' else p[1:5]
            xs += [cx - rx, cx + rx]; ys += [cy - ry, cy + ry]
        elif k == 'char':
            _, x, y, code, attr = p
            xs += [x, x + 10]; ys += [y, y + 12]
    if not xs:
        return 0, 0, 100, 100
    return min(xs), min(ys), max(xs), max(ys)


def render(data):
    prims = parse(data)
    x0, y0, x1, y1 = bbox(prims)
    pad = 16
    W = (x1 - x0) + 2 * pad
    H = (y1 - y0) + 2 * pad

    def X(x):
        return x - x0 + pad

    def Y(y):                       # bascule Y (fichier bas-gauche -> SVG haut-gauche)
        return (y1 - y) + pad

    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
           f'viewBox="0 0 {W} {H}" style="background:#fff">']
    for p in prims:
        k = p[0]
        if k == 'line':
            _, ya, xa, yb, xb, attr, typ = p
            out.append(f'<line x1="{X(xa)}" y1="{Y(ya)}" x2="{X(xb)}" y2="{Y(yb)}" '
                       f'stroke="#000" stroke-width="1"/>')
        elif k == 'arrow':
            _, ya, xa, yb, xb, attr = p
            out.append(f'<line x1="{X(xa)}" y1="{Y(ya)}" x2="{X(xb)}" y2="{Y(yb)}" '
                       f'stroke="#000" stroke-width="1" marker-end="url(#ah)"/>')
        elif k == 'rect':
            _, ya, xa, yb, xb, attr, mod, fill = p
            rx0, ry0 = min(xa, xb), min(ya, yb)
            w, h = abs(xb - xa), abs(yb - ya)
            f = '#bbb' if fill else 'none'
            out.append(f'<rect x="{X(rx0)}" y="{Y(ry0 + h)}" width="{w}" height="{h}" '
                       f'rx="{mod}" fill="{f}" stroke="#000" stroke-width="1"/>')
        elif k == 'circle':
            _, cx, cy, r = p[:4]
            out.append(f'<circle cx="{X(cx)}" cy="{Y(cy)}" r="{max(abs(r),1)}" '
                       f'fill="none" stroke="#000" stroke-width="1"/>')
        elif k == 'ellipse':
            _, cx, cy, rx, ry, mod, attr, arc = p
            rx, ry = abs(rx) or 1, abs(ry) or 1
            if arc and mod:                       # arc partiel : quadrants du masque
                for run in arc_points(cx, cy, rx, ry, mod):
                    pts = ' '.join(f'{X(x)},{Y(y)}' for x, y in run)
                    out.append(f'<polyline points="{pts}" fill="none" '
                               f'stroke="#000" stroke-width="1"/>')
            else:                                  # ellipse complète
                out.append(f'<ellipse cx="{X(cx)}" cy="{Y(cy)}" rx="{rx}" ry="{ry}" '
                           f'fill="none" stroke="#000" stroke-width="1"/>')
        elif k == 'char':
            _, x, y, code, attr = p
            ch = chr(code) if 32 <= code < 127 else '?'
            ch = ch.replace('&', '&amp;').replace('<', '&lt;')
            out.append(f'<text x="{X(x)}" y="{Y(y)}" font-size="11" '
                       f'font-family="monospace">{ch}</text>')
    out.append('<defs><marker id="ah" markerWidth="8" markerHeight="8" refX="6" '
               'refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#000"/>'
               '</marker></defs></svg>')
    return '\n'.join(out)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit("usage: planrender.py fichier.plan [sortie.svg]")
    data = open(sys.argv[1], 'rb').read()
    svg = render(data)
    dst = sys.argv[2] if len(sys.argv) > 2 else sys.argv[1].rsplit('.', 1)[0] + '.svg'
    open(dst, 'w').write(svg)
    print(f"écrit : {dst}")
