// Visualiseur du format TEXT.CODE (éditeur de texte Smaky, antérieur à Typo/Page).
//
// Les documents .TEXT partagent le langage à commandes « \cmd; » de la famille
// Smaky, mais avec leurs propres conventions (cf. docs/text-format.md) :
//  - un préambule de présentation (\ver, \prespri, marges, \justmode, \textdef…)
//    jusqu'à \enable <cr>;, puis des \define de styles, puis le corps ;
//  - dans le corps : \hn = début de ligne, \h = espace de justification,
//    macros de style \g_Fond;/\g_Gras;/\g_Evidence;/\g_Titre; (mode persistant),
//    fontes \fam(flags)taillepg où flag b = gras, i = italique ;
//  - CR (0x0d) = fin de ligne voulue par l'auteur ; LF (0x0a) = retour à la ligne
//    automatique de l'éditeur (recollé) ; 0x0b = césure conditionnelle.
//
// Deux rendus, comme pour Typo : Lecture (structure reconstituée, commandes
// masquées) et Source (texte décodé, commandes \... mises en évidence).
// Rendu indicatif (best-effort) ; tableaux et tabulations alignées non reconstitués.

import { SMAKY2ISO } from "./smakytext.js";

// Décode les octets en préservant les marqueurs de structure nécessaires :
//   CR (13)   -> '\n'   (fin de ligne/paragraphe voulue par l'auteur)
//   LF (10)   -> '\x01' (retour à la ligne automatique : à recoller)
//   0x0b (11) -> '\x02' (césure conditionnelle en fin de ligne automatique)
//   tab (9)   -> '\t' ; 0x02 -> ' ' (espace insécable)
//   15..31    -> lettres accentuées (table SMAKY2ISO) ; 32..126 -> ASCII.
// Le reste (autres contrôles, > 127) est ignoré.
function decodeMarked(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b > 127) continue;
    if (b === 13) { out += "\n"; continue; }
    if (b === 10) { out += "\x01"; continue; }
    if (b === 11) { out += "\x02"; continue; }
    if (b === 9)  { out += "\t"; continue; }
    if (b === 2)  { out += " "; continue; }
    const c = SMAKY2ISO[b];
    if (c < 32) continue;
    out += String.fromCharCode(c);
  }
  return out;
}

// Reconnaît un document TEXT.CODE : son entête commence par « \ver » (après
// d'éventuels CR/espaces de tête). Les nombreux .TEXT en texte brut sont ainsi
// laissés au rendu texte générique.
function isTextCode(bytes) {
  let i = 0;
  while (i < bytes.length && (bytes[i] === 13 || bytes[i] === 10 || bytes[i] === 32 || bytes[i] === 9)) i++;
  const sig = "\\ver ";
  for (let k = 0; k < sig.length; k++) if (bytes[i + k] !== sig.charCodeAt(k)) return false;
  return true;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// --- Styles -----------------------------------------------------------------

// Style (gras/italique) déduit d'une fonte « \fam(flags)taillepg » ou de
// l'expansion d'une macro. Les drapeaux entre parenthèses portent b = gras,
// i = italique ; les autres (o, f, s, n…) concernent la fonte, pas le style.
function styleFromExpansion(exp) {
  const m = exp.match(/\(([A-Za-z]*)\)/);
  const flags = m ? m[1] : "";
  return { bold: /b/i.test(flags), ital: /i/i.test(flags) };
}

function wrapRun(s, style) {
  let h = escapeHTML(s);
  if (style.bold) h = `<strong>${h}</strong>`;
  if (style.ital) h = `<em>${h}</em>`;
  return h;
}

// --- Macros (\define NOM:EXPANSION;) ----------------------------------------

function buildMacros(text) {
  const macros = new Map();
  const re = /\\define\s+([A-Za-z_][A-Za-z0-9_]*)\s*:([^;\n]*);/g;
  let m;
  while ((m = re.exec(text))) macros.set(m[1], m[2]);
  return macros;
}

// --- Figures (\image NOM,…) -------------------------------------------------

const FIG_CMDS = new Set(["image", "figplan", "spfdd", "colleplan"]);

// Nom de fichier d'une figure (même logique que le rendu Typo) : pour \image le
// nom est le 1er argument ; pour les autres, le dernier (après un éventuel « : »).
function figFromCmd(cmd) {
  const m = cmd.match(/^(image|figplan|spfdd|colleplan)\b(.*)$/);
  if (!m) return null;
  const q = m[2].match(/"([^"]+)"/);
  if (q) { const s = q[1]; return s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : s; }
  const toks = m[2].split(",").map((t) => t.trim()).filter(Boolean);
  if (!toks.length) return "?";
  if (m[1] === "image") return toks[0].split(/\s+/)[0] || "?";
  const last = toks[toks.length - 1];
  return last.includes(":") ? last.slice(last.lastIndexOf(":") + 1) : last;
}

// --- Rendu d'un segment (un paragraphe délimité par CR) ---------------------

// Parcourt le segment et le découpe en « pièces » de texte porteuses du style
// courant (les TAB sont conservés tels quels). Les commandes « \…; » sont
// interprétées (style, espace, figure) ou masquées (mise en page). Le style
// persiste d'un segment à l'autre (les \g_… sont des modes, pas des portées).
function renderSegment(seg, macros, styleIn) {
  let style = { ...styleIn };
  const pieces = [];
  const figs = [];
  let title = false;
  let buf = "";

  const flush = () => { if (buf) { pieces.push({ text: buf, style }); buf = ""; } };

  const applyCmd = (cmd) => {
    if (/^[A-Za-z]\(/.test(cmd)) { flush(); style = styleFromExpansion(cmd); return; } // fonte inline \q(b)7pg
    const name = (cmd.match(/^[A-Za-z_][A-Za-z0-9_]*/) || [""])[0];
    if (!name) return;
    if (macros.has(name)) {
      flush();
      style = styleFromExpansion(macros.get(name));
      if (/titre/i.test(name)) title = true;
      return;
    }
    if (name === "h") { buf += " "; return; }       // espace de justification
    if (FIG_CMDS.has(name)) { const f = figFromCmd(cmd); if (f) figs.push(f); return; }
    // \hn, \interligne, \marge, \justif, \define… : mise en page -> masqué
  };

  let i = 0;
  while (i < seg.length) {
    if (seg[i] === "\\") {
      flush();
      let j = i + 1;
      while (j < seg.length && seg[j] !== ";") j++;
      applyCmd(seg.slice(i + 1, j));
      i = j < seg.length ? j + 1 : j;
    } else { buf += seg[i]; i++; }
  }
  flush();
  return { pieces, figs, title, style };
}

// Texte brut concaténé des pièces (TAB compris).
function piecesPlain(pieces) { return pieces.map((p) => p.text).join(""); }

// Rend les pièces sur la plage de caractères [from, to) en HTML : échappe le
// texte, applique le style de chaque pièce et convertit les TAB en espaces de
// tabulation visibles.
function piecesToHTML(pieces, from, to) {
  let out = "", idx = 0;
  for (const p of pieces) {
    let take = "";
    for (const ch of p.text) { if (idx >= from && idx < to) take += ch; idx++; }
    if (take) out += wrapRun(take, p.style);
  }
  return out.replace(/\t/g, '<span class="t-tab"></span>');
}

// --- Mode Lecture : HTML structuré ------------------------------------------

function renderTextReadableHTML(bytes) {
  const text = decodeMarked(bytes);
  const macros = buildMacros(text);
  const paras = text.split("\n"); // CR = séparateur de paragraphe

  const out = [];
  let blanks = 0;
  let started = false;                    // a-t-on dépassé le préambule (commandes seules) ?
  let style = { bold: false, ital: false }; // style courant (mode persistant)

  for (const rawPara of paras) {
    // En-têtes / pieds de page (\debutpage, \cpage = numéro de page…) : non rendus.
    if (/\\(debutpage|finpage|cpage)\b/.test(rawPara)) continue;
    // Recolle les retours automatiques : césure (\x02\x01) -> rien ; sinon -> espace.
    const seg = rawPara.replace(/\x02\x01/g, "").replace(/\x01/g, " ").replace(/\x02/g, "");
    const r = renderSegment(seg, macros, style);
    style = r.style;

    if (r.figs.length) {
      for (const f of r.figs)
        out.push(`<div class="t-fig" data-fig="${escapeHTML(f)}">🖼 figure : ${escapeHTML(f)}</div>`);
      started = true; blanks = 0;
    }

    const plain = piecesPlain(r.pieces);
    if (!plain.trim()) {
      if (r.figs.length) continue;
      // Ligne vide : ignorée dans le préambule ; sinon un seul blanc visuel.
      if (started && ++blanks <= 1) out.push('<div class="t-blank"></div>');
      continue;
    }
    started = true; blanks = 0;

    if (r.title) { out.push(`<h3>${escapeHTML(plain.replace(/\t+/g, " ").trim())}</h3>`); continue; }

    // Tabulations. Deux usages distincts :
    //  - liste indentée (numérotation Smaky) : « TAB* libellé-court TAB+ corps »
    //    où le corps ne contient plus de TAB -> retrait = nombre de TAB, libellé
    //    en saillie, corps replié en retrait ;
    //  - ligne en colonnes (tableau) : plusieurs TAB dans le corps -> chaque TAB
    //    devient un espace de tabulation (alignement exact non reconstitué).
    const m = plain.match(/^(\t*)([^\t]{0,12}?)(\t+)([\s\S]*)$/);
    if (m && !m[4].includes("\t") && m[4].trim()) {
      const depth = m[1].length + m[3].length;
      const label = escapeHTML(m[2].trim());
      const marker = label ? `<span class="t-marker">${label}</span>` : "";
      const body = piecesToHTML(r.pieces, m[1].length + m[2].length + m[3].length, plain.length);
      out.push(`<p class="t-line t-item" style="margin-left:${(depth * 1.6).toFixed(1)}em">${marker}${body}</p>`);
    } else {
      out.push(`<p class="t-line">${piecesToHTML(r.pieces, 0, plain.length)}</p>`);
    }
  }

  if (!out.length)
    out.push('<p class="t-line" style="color:var(--muted);font-style:italic">Document sans contenu visible (préambule de présentation seul).</p>');
  return `<div class="typo-read textcode-read">${out.join("\n")}</div>`;
}

// --- Mode Source : texte décodé, commandes mises en évidence ----------------

function renderTextSourceHTML(bytes) {
  const text = decodeMarked(bytes)
    .replace(/\x02/g, "")      // césure : invisible
    .replace(/\x01/g, "\n");   // retour automatique -> saut de ligne
  const hl = escapeHTML(text).replace(/\\[^;\n]*;?/g, (m) => `<span class="t-cmd">${m}</span>`);
  return `<pre class="typo-src">${hl}</pre>`;
}

export { isTextCode, renderTextReadableHTML, renderTextSourceHTML };
