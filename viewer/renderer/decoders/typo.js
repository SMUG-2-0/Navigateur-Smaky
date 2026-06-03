// Visualiseur du format Typo (composition typographique EPFL, labo J.-D. Nicoud).
//
// Deux rendus :
//  - Lecture : commandes masquées, texte « propre » (titres, paragraphes, filets).
//  - Source  : texte décodé avec les commandes \... mises en évidence.
// Rendu indicatif (best-effort) : ce n'est pas un moteur de composition complet.

import { SMAKY2ISO } from "./smakytext.js";

// Décodage Typo : comme le texte Smaky, mais l'octet 0x02 = espace insécable,
// et on conserve les tabulations (utilisées avec \newtab pour les tableaux).
function decodeTypo(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b > 127) continue;
    if (b === 13) { out += "\n"; continue; }
    if (b === 2) { out += " "; continue; } // espace insécable
    const c = SMAKY2ISO[b];
    if (c === 9) { out += "\t"; continue; }
    if (c === 10) { out += "\n"; continue; }
    if (c < 32) continue;
    out += String.fromCharCode(c);
  }
  return out;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Retire les commandes d'une portion de texte (sur une ligne).
function stripCommands(s) {
  return s
    .replace(/\\[A-Za-z=_][^;\n]*;/g, "")        // \cmd args;  (jusqu'au ; de la ligne)
    .replace(/\\[A-Za-z=_][A-Za-z0-9=_]*/g, "")  // \cmd  sans point-virgule
    .replace(/\\[=_-];?/g, "")                    // \=  \-  \_
    .replace(/\\/g, "");                          // backslash isolé
}

// --- Mode Lecture : HTML « propre » ---------------------------------------

function renderTypoReadableHTML(bytes) {
  const lines = decodeTypo(bytes).split("\n");
  const out = [];
  let blanks = 0;
  for (const raw of lines) {
    const heading = /\\stitre;/.test(raw) ? "h3" : /\\sstitre;/.test(raw) ? "h4" : null;
    const hasTrait = /\\trait/.test(raw);
    const images = [...raw.matchAll(/\\image\s+([^,;\s]+)/g)].map((m) => m[1]);

    if (hasTrait) out.push("<hr>");
    for (const im of images) out.push(`<div class="t-img">🖼 image : ${escapeHTML(im)}</div>`);

    let txt = stripCommands(raw).replace(/\t+/g, "  ").replace(/[ ]+$/g, "");
    const content = txt.trim();

    if (!content && !heading) {
      if (++blanks <= 1) out.push('<div class="t-blank"></div>');
      continue;
    }
    blanks = 0;
    if (heading) out.push(`<${heading}>${escapeHTML(content)}</${heading}>`);
    else out.push(`<div class="t-line">${escapeHTML(content) || "&nbsp;"}</div>`);
  }
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
