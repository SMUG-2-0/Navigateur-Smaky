// Calcul et mise en forme d'un rapport synthétique sur un (sous-)arbre du disque.
// Les données proviennent du manifeste déjà chargé : aucun accès disque.

// Extension « effective » d'un fichier.
// Les fichiers d'association Smaky « nom!type » (p. ex. compta!typo) ne sont pas
// des documents : ce sont des manifestes listant les fichiers liés d'un ensemble
// (gérés jadis par le programme Start, pour que la copie entraîne les fichiers liés).
// On les distingue des vrais documents par un préfixe « ! » (ainsi cocher « typo »
// ne sélectionne pas les « !typo »).
function smakyExt(node) {
  const base = node.smaky_ext || "(sans)";
  return node.name && node.name.includes("!") ? "!" + base : base;
}

// Parcourt récursivement les nœuds et agrège les statistiques.
function computeReport(nodes) {
  const r = { dirs: 0, files: 0, links: 0, bytes: 0, hidden: 0, encoded: 0, byExt: new Map() };
  (function walk(ns) {
    for (const n of ns) {
      if (n.type === "dir") { r.dirs++; walk(n.children || []); }
      else if (n.type === "link") { r.links++; }
      else {
        r.files++;
        r.bytes += n.size || 0;
        if (n.hidden) r.hidden++;
        if (n.encoded) r.encoded++;
        const e = smakyExt(n);
        const cur = r.byExt.get(e) || { count: 0, bytes: 0 };
        cur.count++; cur.bytes += n.size || 0;
        r.byExt.set(e, cur);
      }
    }
  })(nodes);
  return r;
}

// Liste des extensions triée selon le critère choisi.
function sortedExts(r, sort) {
  const arr = [...r.byExt.entries()].map(([ext, v]) => ({ ext, ...v }));
  if (sort === "size") arr.sort((a, b) => b.bytes - a.bytes || a.ext.localeCompare(b.ext, "fr"));
  else if (sort === "alpha") arr.sort((a, b) => a.ext.localeCompare(b.ext, "fr"));
  else arr.sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext, "fr"));
  return arr;
}

const nf = (n) => Number(n).toLocaleString("fr");

// --- Format texte lisible --------------------------------------------------

function toText(r, opts) {
  const { scopeLabel, sort, image, when } = opts;
  const exts = sortedExts(r, sort);
  const L = [];
  L.push("RAPPORT — NAVIGATEUR SMAKY");
  L.push("=".repeat(60));
  if (image) L.push("Image       : " + image);
  L.push("Périmètre   : " + scopeLabel);
  if (when) L.push("Généré le   : " + when);
  L.push("");
  L.push("RÉSUMÉ");
  L.push("-".repeat(60));
  L.push("Dossiers          : " + nf(r.dirs));
  L.push("Fichiers          : " + nf(r.files));
  if (r.links) L.push("Liens             : " + nf(r.links));
  L.push("Taille totale     : " + nf(r.bytes) + " octets");
  L.push("Fichiers cachés   : " + nf(r.hidden));
  L.push("Fichiers encodés  : " + nf(r.encoded));
  L.push("Extensions        : " + nf(exts.length) + " distinctes");
  L.push("");
  L.push("EXTENSIONS (" + ({ size: "par taille", alpha: "alphabétique" }[sort] || "par nombre") + ")");
  L.push("-".repeat(60));
  const wExt = Math.max(9, ...exts.map((e) => e.ext.length));
  L.push("extension".padEnd(wExt) + "  " + "fichiers".padStart(9) + "  " + "octets".padStart(14));
  for (const e of exts) {
    L.push(e.ext.padEnd(wExt) + "  " + nf(e.count).padStart(9) + "  " + nf(e.bytes).padStart(14));
  }
  return L.join("\n") + "\n";
}

// --- Format CSV ------------------------------------------------------------

function toCSV(r, opts) {
  const exts = sortedExts(r, opts.sort);
  const L = ["extension;nb_fichiers;octets"];
  for (const e of exts) L.push(`${e.ext};${e.count};${e.bytes}`);
  return L.join("\r\n") + "\r\n";
}

// --- Format HTML -----------------------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function toHTML(r, opts) {
  const { scopeLabel, sort, image, when } = opts;
  const exts = sortedExts(r, sort);
  const rows = exts.map((e) =>
    `      <tr><td>${esc(e.ext)}</td><td class="n">${nf(e.count)}</td><td class="n">${nf(e.bytes)}</td></tr>`
  ).join("\n");
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>Rapport Smaky — ${esc(scopeLabel)}</title>
<style>
  body{font-family:system-ui,Segoe UI,sans-serif;margin:2rem;color:#222}
  h1{font-size:1.3rem} table{border-collapse:collapse;margin-top:1rem}
  th,td{border:1px solid #ccc;padding:4px 10px} th{background:#f0f0f0;text-align:left}
  td.n{text-align:right;font-variant-numeric:tabular-nums} .muted{color:#666}
  dl{display:grid;grid-template-columns:auto auto;gap:2px 16px;width:max-content}
  dt{color:#666}
</style></head><body>
  <h1>Rapport — Navigateur Smaky</h1>
  <p class="muted">${image ? esc(image) + " — " : ""}Périmètre : ${esc(scopeLabel)}${when ? " — " + esc(when) : ""}</p>
  <dl>
    <dt>Dossiers</dt><dd>${nf(r.dirs)}</dd>
    <dt>Fichiers</dt><dd>${nf(r.files)}</dd>
    <dt>Taille totale</dt><dd>${nf(r.bytes)} octets</dd>
    <dt>Fichiers cachés</dt><dd>${nf(r.hidden)}</dd>
    <dt>Fichiers encodés</dt><dd>${nf(r.encoded)}</dd>
    <dt>Extensions distinctes</dt><dd>${nf(exts.length)}</dd>
  </dl>
  <table>
    <thead><tr><th>extension</th><th>fichiers</th><th>octets</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
</body></html>
`;
}

function formatReport(r, format, opts) {
  if (format === "csv") return toCSV(r, opts);
  if (format === "html") return toHTML(r, opts);
  return toText(r, opts);
}

export { computeReport, formatReport, smakyExt };
