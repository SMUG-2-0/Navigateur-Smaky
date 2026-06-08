/*
 * Navigateur Smaky — Copyright (C) 2026 Epsitec SA, Pierre-Yves Rochat.
 * Logiciel libre sous GNU General Public License v3 — voir le fichier LICENSE.
 */

// Décodage des dessins vectoriels Smaky .PLAN (programme PLAN, ~1985).
//
// Rétro-ingénierie : voir docs/plan-format.md. Big-endian, enregistrements de
// 16 octets (8 mots de 16 bits). Le 1er mot = (modificateur << 8) | type.
// Coordonnées (y, x) — l'ordonnée d'abord —, origine en bas à gauche, Y vers le
// haut, stockées à 4× l'échelle affichée. Préambule de bibliothèque à 1er mot
// >= 0xFFF0 ; groupes encadrés par 0x66/0x67.

import { SMAKY2ISO } from "./smakytext.js";

// Arc (type 11) : octet haut = masque de quadrants, 2 bits par quadrant.
// [masque, angle_début, angle_fin] en degrés trigonométriques (Y vers le haut).
const QUADRANTS = [[0x03, 0, 90], [0x0C, 90, 180], [0x30, 180, 270], [0xC0, 270, 360]];

// Points (x, y) monde des quadrants actifs d'un arc (repère Y vers le haut).
function arcRuns(cx, cy, rx, ry, mod, step = 12) {
  const runs = [];
  for (const [mask, a0, a1] of QUADRANTS) {
    if (!(mod & mask)) continue;
    const pts = [];
    for (let k = 0; k <= step; k++) {
      const a = (a0 + ((a1 - a0) * k) / step) * Math.PI / 180;
      pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    runs.push(pts);
  }
  return runs;
}

// Décode un .PLAN (Uint8Array) -> { prims, x0, y0, x1, y1 } ou null si rien.
function decodePlan(bytes) {
  const u16 = (i) => (bytes[i] << 8) | bytes[i + 1];
  const s16 = (i) => { const v = u16(i); return v >= 0x8000 ? v - 0x10000 : v; };
  const prims = [];

  // Table des fontes : les enregistrements 0xFFFD nomment des ressources (calques
  // ET polices). Une police porte sa TAILLE dans son nom — hauteur en pixels de la
  // matrice bitmap (ex. "ur08" = Univers Roman 8 px, "ul06" = Univers Light 6 px,
  // "camor48" = 48 px ; familles Univers L/R/B/I, suffixe p = proportionnel). Chaque
  // entrée a un identifiant de style (octet haut du mot 2) auquel les caractères se
  // réfèrent, ce qui donne la taille réelle de chaque caractère.
  const sizeByStyle = new Map();
  for (let i = 16; i + 16 <= bytes.length; i += 16) {
    if (u16(i) !== 0xFFFD) continue;
    const styleId = bytes[i + 4];
    let nm = "";
    for (let k = i + 6; k < i + 16 && bytes[k] >= 32 && bytes[k] < 127; k++)
      nm += String.fromCharCode(bytes[k]);
    const m = nm.match(/(\d+)[a-z]?$/i);                // chiffres finaux = hauteur (px)
    if (m) {
      const px = parseInt(m[1], 10);
      if (px >= 2 && px <= 200) sizeByStyle.set(styleId, px);
    }
  }

  for (let i = 16; i + 16 <= bytes.length; i += 16) {
    const op = u16(i);
    if (op >= 0xFFF0) continue;                       // sections de bibliothèque
    const typ = op & 0xFF, mod = op >> 8;
    if (typ === 0x64 || typ === 0x65 || typ === 0x66 || typ === 0x67) continue; // groupes
    const a = s16(i + 2), b = s16(i + 4), c = s16(i + 6), d = s16(i + 8);

    switch (typ) {
      case 0: case 1: case 2: case 3: case 4:         // segments / droites (y1,x1,y2,x2)
        prims.push({ k: "line", ya: a, xa: b, yb: c, xb: d }); break;
      case 12:                                        // flèche
        prims.push({ k: "line", ya: a, xa: b, yb: c, xb: d, arrow: true }); break;
      case 5:                                         // cercle/point [255, rayon, cy, cx]
        prims.push({ k: "circle", cx: d, cy: c, r: Math.abs(b) }); break;
      case 6:                                         // rectangle (octet haut = arrondi)
        prims.push({ k: "rect", ya: a, xa: b, yb: c, xb: d, round: mod, fill: false }); break;
      case 7:                                         // surface remplie
        prims.push({ k: "rect", ya: a, xa: b, yb: c, xb: d, round: 0, fill: true }); break;
      case 8:                                         // caractère [fonte, (style<<8)|car, y, x]
        prims.push({ k: "char", x: d, y: c, code: u16(i + 4) & 0xFF, style: bytes[i + 4] }); break;
      case 10: case 11:                               // ellipse [ry, rx, cy, cx] ; 11 = arc
        prims.push({ k: "ellipse", cx: d, cy: c, rx: Math.abs(b), ry: Math.abs(a), mod, arc: typ === 11 }); break;
      // op 9 = arc de cercle : masque de quadrants dans le mot 1, rayon unique.
      case 9:                                         // [masque, rayon, cy, cx]
        prims.push({ k: "ellipse", cx: d, cy: c, rx: Math.abs(b), ry: Math.abs(b), mod: a, arc: true }); break;
      default: break;
    }
  }
  if (!prims.length) return null;

  // Taille de chaque caractère. En priorité : la VRAIE hauteur de sa police (table
  // 0xFFFD), convertie dans les unités du fichier (coordonnées stockées à ×4).
  const FILE_SCALE = 4;                               // valeur_stockée = 4 × affiché
  for (const p of prims) if (p.k === "char") {
    const px = sizeByStyle.get(p.style);
    if (px) p.fs = px * FILE_SCALE;
  }

  // Repli : pour les caractères dont la police reste inconnue, on retombe sur
  // l'heuristique d'origine (taille par ligne = médiane des avances), la fonte PLAN
  // étant proportionnelle (l'avance dépend du glyphe, pas de la taille).
  const lines = new Map();                            // y -> liste de caractères
  for (const p of prims) if (p.k === "char") {
    if (!lines.has(p.y)) lines.set(p.y, []);
    lines.get(p.y).push(p);
  }
  let globalFs = 22;
  for (const chars of lines.values()) {
    chars.sort((a, b) => a.x - b.x);
    if (chars.every((p) => p.fs)) continue;           // ligne déjà résolue par les polices
    const advs = [];
    for (let i = 1; i < chars.length; i++) {
      const dx = chars[i].x - chars[i - 1].x;
      if (dx > 0 && dx < 80) advs.push(dx);
    }
    let fs = globalFs;
    if (advs.length) {
      advs.sort((a, b) => a - b);
      fs = Math.round(advs[advs.length >> 1] / 0.55); // médiane ≈ 0,55 em (minuscules)
      globalFs = fs;
    }
    for (const p of chars) if (!p.fs) p.fs = fs;      // complète les caractères sans police
  }

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ext = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const p of prims) {
    if (p.k === "line") { ext(p.xa, p.ya); ext(p.xb, p.yb); }
    else if (p.k === "rect") { ext(p.xa, p.ya); ext(p.xb, p.yb); }
    else if (p.k === "circle") { ext(p.cx - p.r, p.cy - p.r); ext(p.cx + p.r, p.cy + p.r); }
    else if (p.k === "ellipse") { ext(p.cx - p.rx, p.cy - p.ry); ext(p.cx + p.rx, p.cy + p.ry); }
    else if (p.k === "char") { ext(p.x, p.y); ext(p.x + 40, p.y + 48); }
    else if (p.k === "point") { ext(p.cx, p.cy); }
  }
  return { prims, x0, y0, x1, y1 };
}

// Construit une chaîne SVG à partir d'un dessin décodé. Le repère fichier
// (Y vers le haut) est basculé manuellement pour garder le texte à l'endroit.
function planToSVG(dec, opts = {}) {
  const pad = 24;                                     // marge en unités fichier (×4)
  const W = (dec.x1 - dec.x0) + 2 * pad;
  const H = (dec.y1 - dec.y0) + 2 * pad;
  const X = (x) => (x - dec.x0 + pad).toFixed(1);
  const Y = (y) => (dec.y1 - y + pad).toFixed(1);     // bascule de l'axe Y
  const body = [];

  for (const p of dec.prims) {
    if (p.k === "line") {
      body.push(`<line x1="${X(p.xa)}" y1="${Y(p.ya)}" x2="${X(p.xb)}" y2="${Y(p.yb)}"${p.arrow ? ' marker-end="url(#ah)"' : ""}/>`);
    } else if (p.k === "rect") {
      const x = Math.min(p.xa, p.xb), w = Math.abs(p.xb - p.xa), h = Math.abs(p.yb - p.ya);
      const yTop = Math.max(p.ya, p.yb);
      body.push(`<rect x="${X(x)}" y="${Y(yTop)}" width="${w}" height="${h}"`
        + (p.round ? ` rx="${p.round * 4}"` : "")
        + (p.fill ? ' class="fill"' : "") + "/>");
    } else if (p.k === "circle") {
      body.push(`<circle cx="${X(p.cx)}" cy="${Y(p.cy)}" r="${Math.max(p.r, 1)}"/>`);
    } else if (p.k === "ellipse") {
      const rx = Math.max(p.rx, 1), ry = Math.max(p.ry, 1);
      if (p.arc && p.mod) {
        for (const run of arcRuns(p.cx, p.cy, rx, ry, p.mod)) {
          body.push(`<polyline points="${run.map(([x, y]) => `${X(x)},${Y(y)}`).join(" ")}"/>`);
        }
      } else {
        body.push(`<ellipse cx="${X(p.cx)}" cy="${Y(p.cy)}" rx="${rx}" ry="${ry}"/>`);
      }
    } else if (p.k === "char") {
      const iso = SMAKY2ISO[p.code] ?? p.code;        // jeu de caractères Smaky -> Latin-1
      const ch = (iso < 32 ? "" : String.fromCharCode(iso))
        .replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
      body.push(`<text x="${X(p.x)}" y="${Y(p.y)}" class="txt" font-size="${p.fs || 22}">${ch}</text>`);
    } else if (p.k === "point") {
      body.push(`<circle cx="${X(p.cx)}" cy="${Y(p.cy)}" r="3" class="pt"/>`);
    }
  }

  const scale = opts.scale || 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" `
    + `width="${(W / 4 * scale).toFixed(0)}" height="${(H / 4 * scale).toFixed(0)}" class="plan-svg">`
    + `<defs><marker id="ah" markerWidth="10" markerHeight="10" refX="7" refY="4" orient="auto">`
    + `<path d="M0,0 L8,4 L0,8 Z"/></marker></defs>`
    + `<g fill="none" stroke="#111" stroke-width="2" vector-effect="non-scaling-stroke">`
    + body.join("") + `</g></svg>`;
}

export { decodePlan, planToSVG };
