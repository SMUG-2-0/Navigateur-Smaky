// Visualiseur du format Typo (composition typographique Smaky, labo LAMI de l'EPFL).
//
// Deux rendus :
//  - Lecture : structure reconstituée (titres, sections numérotées, listes,
//              paragraphes, filets), commandes masquées.
//  - Source  : texte décodé avec les commandes \... mises en évidence.
//
// Rendu indicatif (best-effort). Voir docs/typo-format.md pour le format.
// Phase 1 : hiérarchie & listes + développement des macros \define du document.
//   (gras/italique, tableaux et images réelles : phases ultérieures.)

import { SMAKY2ISO } from "./smakytext.js";

// Décodage Typo : comme le texte Smaky, mais l'octet 0x02 = espace insécable,
// et on conserve les tabulations (utilisées avec \newtab pour les tableaux).
function decodeTypo(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b > 127) continue;
    if (b === 13) { out += "\n"; continue; }
    if (b === 2) { out += " "; continue; } // espace insécable
    const c = SMAKY2ISO[b];
    if (c === 9) { out += "\t"; continue; }
    if (c === 10) { out += "\n"; continue; }
    if (c < 32) continue;
    out += String.fromCharCode(c);
  }
  return out;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Retire les commandes d'une portion de texte (sur une ligne), en conservant
// le texte des portées stylées inline « \cmd:texte| » (le ':' ouvre, le '|' ferme).
function stripCommands(s) {
  return s
    .replace(/\\[A-Za-z=_][A-Za-z0-9=_]*\s*:([^|\n]*)\|/g, "$1") // \cmd:texte| -> texte
    .replace(/\\[A-Za-z=_][A-Za-z0-9=_]*\s*:/g, "")              // \cmd:texte (sans |) -> texte
    .replace(/\\[A-Za-z=_][^;\n]*;/g, "")                        // \cmd args;
    .replace(/\\[A-Za-z=_][A-Za-z0-9=_]*/g, "")                  // \cmd seul
    .replace(/\\[=_-];?/g, "")                                    // \=  \-  \_
    .replace(/\|/g, "")                                           // | résiduel (retour de fonte)
    .replace(/\\/g, "");                                          // backslash isolé
}

// Détermine si une commande dénote du gras ('b') ou de l'italique ('i').
// - raccourcis courants \b / \i ;
// - fontes logiques \<fam><style><corps> (ex. \ub10 = style b = gras, \ui12 = italique) ;
// - macro dont l'expansion est une telle fonte (ex. \define b:\ub10;).
function styleOf(name, macros) {
  if (name === "b" || name === "gras") return "b";
  if (name === "i" || name === "ital") return "i";
  let m = name.match(/^[a-z]([rbiel])\d{2}$/);
  if (m) return m[1] === "b" ? "b" : m[1] === "i" ? "i" : null;
  if (macros && macros.has(name)) {
    const exp = macros.get(name);
    const mm = exp.match(/\\[a-z]([rbiel])\d{2}/);
    if (mm) return mm[1] === "b" ? "b" : mm[1] === "i" ? "i" : null;
    if (/\\b\b/.test(exp)) return "b";
    if (/\\i\b/.test(exp)) return "i";
  }
  return null;
}

// Rend une portion de texte en HTML : conserve gras/italique des portées
// stylées « \cmd:texte| », retire les autres commandes, échappe le HTML.
function renderInline(line, macros) {
  const esc = (s) => escapeHTML(stripCommands(s).replace(/\t+/g, "  "));
  const re = /\\([A-Za-z=_][A-Za-z0-9=_]*)\s*:([^|\n]*)\|/g;
  let out = "", last = 0, m;
  while ((m = re.exec(line))) {
    out += esc(line.slice(last, m.index));          // texte avant la portée
    const st = styleOf(m[1], macros), inner = esc(m[2]);
    out += st === "b" ? `<strong>${inner}</strong>`
         : st === "i" ? `<em>${inner}</em>` : inner;
    last = re.lastIndex;
  }
  out += esc(line.slice(last));
  return out.trim();
}

// --- Macros (\define NOM:EXPANSION;) ---------------------------------------

// Construit la table des macros déclarées dans le document.
function buildMacros(text) {
  const macros = new Map();
  const re = /\\define\s+([A-Za-z][A-Za-z0-9]*)\s*:([^\r\n;]*);/g;
  let m;
  while ((m = re.exec(text))) macros.set(m[1], m[2]);
  return macros;
}

// Développe récursivement les appels de macros d'une ligne (garde-fou de profondeur).
function expandMacros(s, macros, depth = 0) {
  if (!macros.size || depth > 8) return s;
  let changed = false;
  const out = s.replace(/\\([A-Za-z][A-Za-z0-9]*)/g, (full, name) => {
    if (macros.has(name)) { changed = true; return macros.get(name); }
    return full;
  });
  return changed ? expandMacros(out, macros, depth + 1) : out;
}

// --- Outils de structure ----------------------------------------------------

function cleanText(line) {
  return stripCommands(line).replace(/\t+/g, "  ").replace(/[ ]+$/g, "").trim();
}

// Étiquette de section numérotée (ex. [1,2,0] niveau 2 -> "1.2").
function numLabel(counters, level) {
  const parts = counters.slice(0, level);
  while (parts.length > 1 && parts[0] === 0) parts.shift();
  return parts.join(".");
}

// Nom de fichier d'une figure, selon la commande :
//  \image NOM,param,taille  -> NOM = PREMIER argument (la taille « 90mm » est en fin) ;
//  \figplan ,,,NOM / \colleplan taille:NOM / \spfdd …,"@VOL:RÉP:NOM" -> nom en fin (après « : »).
function figName(cmd, args) {
  const q = args.match(/"([^"]+)"/);
  if (q) { const s = q[1]; return s.includes(":") ? s.slice(s.lastIndexOf(":") + 1) : s; }
  const toks = args.split(",").map((t) => t.trim()).filter(Boolean);
  if (!toks.length) return "?";
  if (cmd === "image") return toks[0].split(/\s+/)[0] || "?";
  const last = toks[toks.length - 1];
  return last.includes(":") ? last.slice(last.lastIndexOf(":") + 1) : last;
}

// --- Mode Lecture : HTML structuré -----------------------------------------

function renderTypoReadableHTML(bytes) {
  const text = decodeTypo(bytes);
  const macros = buildMacros(text);
  const lines = text.split("\n");

  const out = [];
  const counters = [0, 0, 0];
  let inList = false;
  let blanks = 0;

  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };
  const pushBlock = (html) => { closeList(); out.push(html); };

  for (const raw of lines) {
    // Déclarations sans rendu : \define… et \importe… (imports non résolus en phase 1)
    let line = raw
      .replace(/\\define\s+[A-Za-z0-9]+\s*:[^;\r\n]*;/g, "")
      .replace(/\\importe\b[^;\r\n]*;?/g, "");
    line = expandMacros(line, macros);

    // Nouveau segment de document (\fichier:NOM) -> réinitialise la numérotation
    const fileM = line.match(/\\fichier\s*:\s*([^\\\r\n;]*)/);
    if (fileM) {
      counters[0] = counters[1] = counters[2] = 0;
      pushBlock(`<div class="t-file">▣ ${escapeHTML(fileM[1].trim() || "document")}</div>`);
      blanks = 0;
      continue;
    }

    // Espace vertical (\saute N mm) — grandes valeurs ≈ saut de page.
    if (/\\saute\s+\d+\s*mm/.test(line)) {
      let total = 0;
      line = line.replace(/\\saute\s+(\d+)\s*mm\s*;?/g, (m, n) => { total += +n; return ""; });
      pushBlock(`<div class="t-space" style="height:${Math.max(2, Math.min(total * 2, 96))}px"></div>`);
      blanks = 0;
      if (!cleanText(line)) continue;
    }

    // Titres (non numérotés) et sections (numérotées)
    const titleTag = /\\stitre\b/.test(line) ? "h1" : /\\sstitre\b/.test(line) ? "h2" : null;
    const numLevel = /\\ssnum\b/.test(line) ? 3 : /\\snum\b/.test(line) ? 2 : /\\num\b/.test(line) ? 1 : 0;

    // Filet horizontal (\trait, \ln) — uniquement si la ligne n'est pas un titre
    if (!titleTag && !numLevel && /\\(trait|ln)\b/.test(line)) {
      pushBlock("<hr>");
      blanks = 0;
      continue;
    }

    // Figures (placeholder en phase 1 : on n'affiche pas encore l'image réelle)
    const figs = [...line.matchAll(/\\(image|figplan|spfdd|colleplan)\b([^\r\n;]*);?/g)]
      .map((fm) => figName(fm[1], fm[2]));

    const txt = cleanText(line);
    const html = renderInline(line, macros);   // texte stylé (gras/italique)

    if (titleTag) {
      pushBlock(`<${titleTag}>${escapeHTML(txt) || "&nbsp;"}</${titleTag}>`);
      blanks = 0;
      continue;
    }

    if (numLevel) {
      counters[numLevel - 1]++;
      for (let k = numLevel; k < 3; k++) counters[k] = 0;
      const tag = ["h2", "h3", "h4"][numLevel - 1];
      const label = numLabel(counters, numLevel);
      pushBlock(`<${tag}><span class="t-secnum">${label}</span> ${escapeHTML(txt) || "&nbsp;"}</${tag}>`);
      blanks = 0;
      continue;
    }

    if (figs.length) {
      // Placeholder hydraté plus tard par l'app (qui décode l'image réelle si trouvée).
      for (const f of figs)
        pushBlock(`<div class="t-fig" data-fig="${escapeHTML(f)}">🖼 figure : ${escapeHTML(f)}</div>`);
      if (!txt) { blanks = 0; continue; }
    }

    // Listes : ligne dont le texte commence par « - »
    const li = txt.match(/^-\s?(.*)$/);
    if (li) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${html.replace(/^-\s?/, "") || "&nbsp;"}</li>`);
      blanks = 0;
      continue;
    }

    // Ligne vide -> un seul blanc visuel
    if (!txt) {
      if (++blanks <= 1 && !inList) out.push('<div class="t-blank"></div>');
      continue;
    }

    // Paragraphe / ligne de texte
    blanks = 0;
    pushBlock(`<p class="t-line">${html}</p>`);
  }

  closeList();
  return `<div class="typo-read">${out.join("\n")}</div>`;
}

// --- Mode Source : texte décodé, commandes mises en évidence ---------------

function renderTypoSourceHTML(bytes) {
  const esc = escapeHTML(decodeTypo(bytes));
  const hl = esc.replace(/\\[A-Za-z=_][^;\n]*;?|\\[=_-]/g,
    (m) => `<span class="t-cmd">${m}</span>`);
  return `<pre class="typo-src">${hl}</pre>`;
}

export { decodeTypo, renderTypoReadableHTML, renderTypoSourceHTML };
