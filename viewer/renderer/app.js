import { decodeSmakyText, textRatio } from "./decoders/smakytext.js";
import { renderTypoReadableHTML, renderTypoSourceHTML } from "./decoders/typo.js";
import { decodeImage } from "./decoders/smakyimage.js";
import { computeReport, formatReport } from "./report.js";

// Extensions considérées comme du texte par défaut (sinon : affichage hexa).
const TEXT_EXTS = new Set([
  "text", "txt", "doc", "news", "pas", "bas", "cbas", "asm", "asi",
  "h", "c", "genc", "pdef", "ref", "cle", "list", "a-lire", "filer",
]);
const HEX_LIMIT = 64 * 1024; // octets affichés en mode hexa

const el = (id) => document.getElementById(id);
const state = { manifest: null, node: null, bytes: null, mode: "text", currentDir: null };

// Affiche la version de l'application dans l'en-tête.
window.api.getVersion().then((v) => { el("appVersion").textContent = "v" + v; });

// --- Ouverture (dossier extrait ou image .DI) ------------------------------

el("openBtn").addEventListener("click", openFolder);
el("openDiBtn").addEventListener("click", openDi);

// Ouvre un dossier déjà extrait (contenant manifest.json + tree/).
async function openFolder() {
  const res = await window.api.pickFolder();
  if (!res) return;
  if (res.error) { showError(res.error); return; }
  await loadFolder(res.root);
}

// Ouvre une image .DI : l'extrait (avec barre de progression) puis l'affiche.
async function openDi() {
  showProgress("Préparation…");
  const unsubscribe = window.api.onExtractProgress((p) => {
    showProgress(
      `Extraction en cours… ${p.dirs.toLocaleString("fr")} dossiers, ` +
      `${p.files.toLocaleString("fr")} fichiers, ` +
      `${formatBytes(p.bytes)}`
    );
  });
  try {
    const res = await window.api.openDi();
    if (!res || res.canceled) { hideProgress(); return; }
    if (res.error) { hideProgress(); showError(res.error); return; }
    showProgress("Chargement du disque…");
    await loadFolder(res.root);
  } finally {
    unsubscribe();
    hideProgress();
  }
}

// Charge le manifeste d'un dossier extrait et configure l'interface.
async function loadFolder(root) {
  el("folderPath").textContent = root;
  const m = await window.api.readManifest();
  if (m.error) { showError(m.error); return; }
  state.manifest = m.manifest;
  state.currentDir = null;
  el("reportBtn").disabled = false;
  el("extBtn").disabled = false;
  el("textSearch").disabled = false;
  el("optCase").disabled = false;
  el("optRegex").disabled = false;
  resetFilter();
  resetSearch();
  buildExtList();
  renderTree(m.manifest.tree || []);
  const s = m.manifest.stats || {};
  el("content").innerHTML =
    `<p class="placeholder">Disque chargé : ${s.dirs || 0} dossiers, ` +
    `${s.files || 0} fichiers. Sélectionne un fichier à gauche.</p>`;
}

// Octets -> chaîne lisible (Ko/Mo).
function formatBytes(n) {
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " Mo";
  if (n >= 1024) return (n / 1024).toFixed(0) + " Ko";
  return n + " o";
}

// Affiche/masque l'overlay de progression d'extraction.
function showProgress(text) {
  let ov = el("progressOverlay");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "progressOverlay";
    ov.className = "progress-overlay";
    ov.innerHTML =
      '<div class="progress-box"><div class="spinner"></div>' +
      '<div id="progressText" class="progress-text"></div></div>';
    document.body.appendChild(ov);
  }
  ov.classList.remove("hidden");
  el("progressText").textContent = text;
}

function hideProgress() {
  const ov = el("progressOverlay");
  if (ov) ov.classList.add("hidden");
}

// --- Arbre (rendu paresseux) ----------------------------------------------

function sortNodes(nodes) {
  return [...nodes].sort((a, b) => {
    if ((a.type === "dir") !== (b.type === "dir")) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, "fr");
  });
}

// --- Filtre par extension --------------------------------------------------

const filter = { mode: "include", exts: new Set() };
const filterActive = () => filter.exts.size > 0;

function fileVisible(node) {
  if (!filterActive()) return true;
  const e = node.smaky_ext || "(sans)";
  return filter.mode === "include" ? filter.exts.has(e) : !filter.exts.has(e);
}

// Marque chaque dossier (node.__match) selon qu'il contient un fichier visible.
function computeMatches(nodes) {
  let any = false;
  for (const n of nodes) {
    if (n.type === "dir") { n.__match = computeMatches(n.children || []); any ||= n.__match; }
    else if (n.type === "file" && fileVisible(n)) any = true;
  }
  return any;
}

// Enfants visibles (dossiers avec correspondance, fichiers du bon type), triés.
function visibleNodes(nodes) {
  if (!filterActive()) return sortNodes(nodes);
  return sortNodes(nodes.filter((n) =>
    n.type === "dir" ? n.__match : (n.type === "file" && fileVisible(n))));
}

function applyFilter() {
  if (filterActive()) computeMatches(state.manifest.tree || []);
  renderTree(state.manifest.tree || []);
  const n = filter.exts.size;
  const verb = filter.mode === "include" ? "Afficher" : "Masquer";
  el("extBtn").textContent = n ? `${verb} ${n} type${n > 1 ? "s" : ""} ▾` : "Tous les types ▾";
}

function renderTree(nodes) {
  const root = el("tree");
  root.innerHTML = "";
  const ul = document.createElement("ul");
  for (const n of visibleNodes(nodes)) ul.appendChild(makeNode(n));
  root.appendChild(ul);
}

function makeNode(node) {
  const li = document.createElement("li");
  const row = document.createElement("div");
  row.className = "node-row " + node.type;

  const twisty = document.createElement("span");
  twisty.className = "twisty";
  twisty.textContent = node.type === "dir" ? "▶" : "";

  const name = document.createElement("span");
  name.className = "node-name";
  name.textContent = node.name;

  row.append(twisty, name);
  if (node.type === "file" && node.smaky_ext) {
    const b = document.createElement("span");
    b.className = "badge";
    b.textContent = node.smaky_ext;
    row.appendChild(b);
  }
  li.appendChild(row);

  if (node.type === "dir") {
    let childrenUl = null;
    let expanded = false;
    row.addEventListener("click", () => {
      state.currentDir = node; // mémorise pour le périmètre du rapport
      expanded = !expanded;
      twisty.textContent = expanded ? "▼" : "▶";
      if (expanded && !childrenUl) {
        childrenUl = document.createElement("ul");
        for (const c of visibleNodes(node.children || [])) childrenUl.appendChild(makeNode(c));
        li.appendChild(childrenUl);
      } else if (childrenUl) {
        childrenUl.classList.toggle("hidden", !expanded);
      }
    });
  } else {
    row.addEventListener("click", () => { markSelected(row); selectFile(node); });
  }
  return li;
}

// --- Sélection / visualisation --------------------------------------------

async function selectFile(node, forceMode) {
  state.node = node;
  showMeta(node);

  const res = await window.api.readFile(node.fos_path);
  if (res.error) { showError(res.error); return; }
  state.bytes = new Uint8Array(res.bytes);
  showViewer(node, state.bytes, forceMode);
}

function markSelected(elem) {
  document.querySelectorAll(".node-row.selected, .res-item.selected")
    .forEach((e) => e.classList.remove("selected"));
  elem.classList.add("selected");
}

function showMeta(node) {
  const meta = el("meta");
  meta.classList.remove("hidden");
  const row = (k, v) => `<div><span class="k">${k} :</span> ${v ?? "—"}</div>`;
  const flags = [node.hidden && "caché", node.encoded && "encodé"].filter(Boolean).join(", ") || "—";
  meta.innerHTML =
    `<div class="path">${node.fos_path}</div>` +
    row("Taille", `${node.size.toLocaleString("fr")} o`) +
    row("Type Smaky", node.smaky_ext || "—") +
    row("Attributs", flags) +
    row("Création", node.created || "—") +
    row("Modifié", node.changed || "—") +
    row("Dernier accès", node.viewed || "—");
}

// --- Visualiseur : modes dynamiques selon le type de fichier ---------------

const MODES = {
  image:       { label: "Image",   render: renderImage },
  text:        { label: "Texte",   render: renderText },
  "typo-read": { label: "Lecture", render: (b) => renderHTMLView(renderTypoReadableHTML(b), b, "rendu indicatif") },
  "typo-src":  { label: "Source",  render: (b) => renderHTMLView(renderTypoSourceHTML(b), b) },
  hex:         { label: "Hexa",    render: renderHex },
};

function modesForNode(node, bytes) {
  if (node.smaky_ext === "image" || node.smaky_ext === "color") return ["image", "hex"];
  if (node.smaky_ext === "typo") return ["typo-read", "typo-src", "hex"];
  const looksText = TEXT_EXTS.has(node.smaky_ext) || textRatio(bytes) > 0.85;
  return looksText ? ["text", "hex"] : ["hex", "text"];
}

function showViewer(node, bytes, forceMode) {
  const modes = modesForNode(node, bytes);
  const tb = el("viewerToolbar");
  tb.classList.remove("hidden");
  tb.querySelectorAll("button").forEach((b) => b.remove());
  const note = el("viewerNote");
  for (const id of modes) {
    const btn = document.createElement("button");
    btn.textContent = MODES[id].label;
    btn.dataset.mode = id;
    btn.addEventListener("click", () => setMode(id));
    tb.insertBefore(btn, note);
  }
  setMode(forceMode && modes.includes(forceMode) ? forceMode : modes[0]);
}

function setMode(mode) {
  state.mode = mode;
  el("viewerToolbar").querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode));
  if (!state.bytes) return;
  MODES[mode].render(state.bytes);
  // Surligne les correspondances de recherche dans les modes texte.
  if (state.searchRe && ["text", "typo-read", "typo-src"].includes(mode))
    highlightDOM(el("content"), state.searchRe);
}

function renderText(bytes) {
  const pre = document.createElement("pre");
  pre.textContent = decodeSmakyText(bytes);
  setContent(pre);
  el("viewerNote").textContent = `${bytes.length.toLocaleString("fr")} octets`;
}

function renderHTMLView(html, bytes, note) {
  el("content").innerHTML = html;
  el("viewerNote").textContent =
    `${bytes.length.toLocaleString("fr")} octets` + (note ? ` — ${note}` : "");
}

function renderImage(bytes) {
  const content = el("content");
  content.innerHTML = "";
  const img = decodeImage(bytes, state.node.smaky_ext);
  if (!img) {
    content.innerHTML = '<p class="error">Image non décodable (en-tête inattendu). Essaie le mode Hexa.</p>';
    el("viewerNote").textContent = "";
    return;
  }
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.className = "img-canvas";
  canvas.getContext("2d").putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);

  // Barre de zoom (les images Smaky sont souvent petites).
  let scale = Math.min(8, Math.max(1, Math.floor(160 / Math.min(img.width, img.height)) || 1));
  const apply = () => {
    canvas.style.width = img.width * scale + "px";
    canvas.style.height = img.height * scale + "px";
    bar.querySelectorAll("button").forEach((b) => b.classList.toggle("active", +b.dataset.s === scale));
  };
  const bar = document.createElement("div");
  bar.className = "img-zoom";
  for (const s of [1, 2, 4, 8]) {
    const b = document.createElement("button");
    b.textContent = "×" + s;
    b.dataset.s = s;
    b.addEventListener("click", () => { scale = s; apply(); });
    bar.appendChild(b);
  }
  const wrap = document.createElement("div");
  wrap.className = "img-wrap";
  wrap.appendChild(canvas);
  content.append(bar, wrap);
  apply();
  el("viewerNote").textContent = `${img.width}×${img.height}, ${img.bpp} bpp`;
}

function renderHex(bytes) {
  const n = Math.min(bytes.length, HEX_LIMIT);
  const lines = [];
  for (let off = 0; off < n; off += 16) {
    const slice = bytes.subarray(off, Math.min(off + 16, n));
    const hex = [...slice].map((b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = [...slice].map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : ".")).join("");
    lines.push(off.toString(16).padStart(8, "0") + "  " + hex.padEnd(16 * 3 - 1, " ") + "  " + ascii);
  }
  const pre = document.createElement("pre");
  pre.className = "hex";
  pre.textContent = lines.join("\n");
  setContent(pre);
  el("viewerNote").textContent =
    bytes.length > HEX_LIMIT
      ? `${bytes.length.toLocaleString("fr")} octets (premiers ${HEX_LIMIT.toLocaleString("fr")} affichés)`
      : `${bytes.length.toLocaleString("fr")} octets`;
}

function setContent(node) {
  const c = el("content");
  c.innerHTML = "";
  c.appendChild(node);
}

function showError(msg) {
  const c = el("content");
  c.innerHTML = `<p class="error">Erreur : ${msg}</p>`;
}

// --- Dialogue Rapport ------------------------------------------------------

let reportContent = "";

el("reportBtn").addEventListener("click", openReport);
el("reportClose").addEventListener("click", () => el("reportModal").classList.add("hidden"));
el("reportModal").addEventListener("click", (e) => {
  if (e.target === el("reportModal")) el("reportModal").classList.add("hidden");
});
["reportScope", "reportSort", "reportFormat"].forEach((id) =>
  el(id).addEventListener("change", updateReport));
el("reportCopy").addEventListener("click", copyReport);
el("reportSave").addEventListener("click", saveReport);

function openReport() {
  if (!state.manifest) return;
  // Périmètre : tout le disque, et éventuellement le dernier dossier ouvert.
  const scope = el("reportScope");
  scope.innerHTML = "";
  scope.add(new Option("Tout le disque", "all"));
  if (state.currentDir) {
    scope.add(new Option("Dossier : " + state.currentDir.fos_path, "dir"));
  }
  el("reportStatus").textContent = "";
  el("reportModal").classList.remove("hidden");
  updateReport();
}

function reportContext() {
  const scopeVal = el("reportScope").value;
  if (scopeVal === "dir" && state.currentDir) {
    return { nodes: state.currentDir.children || [], label: state.currentDir.fos_path };
  }
  return { nodes: state.manifest.tree || [], label: "Tout le disque" };
}

function updateReport() {
  const { nodes, label } = reportContext();
  const r = computeReport(nodes);
  const format = el("reportFormat").value;
  reportContent = formatReport(r, format, {
    scopeLabel: label,
    sort: el("reportSort").value,
    image: state.manifest.image || "",
    when: new Date().toLocaleString("fr"),
  });
  el("reportPreview").textContent = reportContent;
}

async function copyReport() {
  await window.api.copyText(reportContent);
  el("reportStatus").textContent = "Copié dans le presse-papiers.";
}

async function saveReport() {
  const format = el("reportFormat").value;
  const ext = { text: "txt", csv: "csv", html: "html" }[format];
  const base = (state.manifest.image || "rapport").split(/[\\/]/).pop().replace(/\.[^.]*$/, "");
  const res = await window.api.saveText(`rapport_${base}.${ext}`, reportContent);
  if (res && res.path) el("reportStatus").textContent = "Enregistré : " + res.path;
  else if (res && res.error) el("reportStatus").textContent = "Erreur : " + res.error;
}

// --- Panneau de sélection des extensions -----------------------------------

el("extBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  const p = el("extPanel");
  p.classList.toggle("hidden");
  if (!p.classList.contains("hidden")) el("extSearch").focus();
});
el("extClose").addEventListener("click", () => el("extPanel").classList.add("hidden"));
document.addEventListener("click", (e) => {
  const p = el("extPanel");
  if (!p.classList.contains("hidden") && !p.contains(e.target) && e.target !== el("extBtn"))
    p.classList.add("hidden");
});
el("extSearch").addEventListener("input", () => renderExtList(el("extSearch").value));
el("extAlpha").addEventListener("change", () => renderExtList(el("extSearch").value));
document.querySelectorAll('input[name="extmode"]').forEach((r) =>
  r.addEventListener("change", () => {
    filter.mode = document.querySelector('input[name="extmode"]:checked').value;
    applyFilter();
  }));
el("extAll").addEventListener("click", () => {
  el("extList").querySelectorAll("input[type=checkbox]").forEach((cb) => { filter.exts.add(cb.value); cb.checked = true; });
  applyFilter(); updateSelCount();
});
el("extNone").addEventListener("click", () => {
  el("extList").querySelectorAll("input[type=checkbox]").forEach((cb) => { filter.exts.delete(cb.value); cb.checked = false; });
  applyFilter(); updateSelCount();
});

function resetFilter() {
  filter.exts.clear();
  filter.mode = "include";
  const inc = document.querySelector('input[name="extmode"][value="include"]');
  if (inc) inc.checked = true;
  el("extBtn").textContent = "Tous les types ▾";
  updateSelCount();
}

function buildExtList() {
  const rep = computeReport(state.manifest.tree || []);
  state.extCounts = [...rep.byExt.entries()]
    .map(([ext, v]) => ({ ext, count: v.count }))
    .sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext, "fr"));
  renderExtList("");
}

function renderExtList(q) {
  const list = el("extList");
  list.innerHTML = "";
  const ql = q.trim().toLowerCase();
  const alpha = el("extAlpha").checked;
  const items = [...(state.extCounts || [])].sort((a, b) =>
    alpha ? a.ext.localeCompare(b.ext, "fr") : (b.count - a.count || a.ext.localeCompare(b.ext, "fr")));
  for (const { ext, count } of items) {
    if (ql && !ext.toLowerCase().includes(ql)) continue;
    const label = document.createElement("label");
    label.className = "ext-item";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = ext;
    cb.checked = filter.exts.has(ext);
    cb.addEventListener("change", () => {
      if (cb.checked) filter.exts.add(ext); else filter.exts.delete(ext);
      applyFilter(); updateSelCount();
    });
    const name = document.createElement("span");
    name.className = "ext-name";
    name.textContent = ext;
    const n = document.createElement("span");
    n.className = "ext-n";
    n.textContent = count.toLocaleString("fr");
    label.append(cb, name, n);
    list.appendChild(label);
  }
}

function updateSelCount() {
  el("extSelCount").textContent = filter.exts.size ? `${filter.exts.size} sélectionnée(s)` : "";
}

// --- Aide (rendu Markdown) -------------------------------------------------

let helpLoaded = false;
el("helpBtn").addEventListener("click", openHelp);
el("helpClose").addEventListener("click", () => el("helpModal").classList.add("hidden"));
el("helpModal").addEventListener("click", (e) => {
  if (e.target === el("helpModal")) el("helpModal").classList.add("hidden");
});

async function openHelp() {
  if (!helpLoaded) {
    const r = await window.api.readHelp();
    el("helpBody").innerHTML = r.error
      ? `<p class="error">Aide indisponible : ${r.error}</p>`
      : mdToHTML(r.text);
    helpLoaded = true;
  }
  el("helpModal").classList.remove("hidden");
}

const mdEsc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function mdInline(s) {
  return mdEsc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

// Mini-convertisseur Markdown -> HTML (suffisant pour notre fichier d'aide).
function mdToHTML(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0, list = null;
  const closeList = () => { if (list) { out.push(list === "ul" ? "</ul>" : "</ol>"); list = null; } };
  const special = (l) => l.startsWith("```") || /^(#{1,4})\s/.test(l)
    || /^[-*]\s/.test(l) || /^\d+\.\s/.test(l) || /^---+$/.test(l.trim());
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      closeList(); i++;
      const buf = [];
      while (i < lines.length && !lines[i].startsWith("```")) { buf.push(mdEsc(lines[i])); i++; }
      i++;
      out.push("<pre><code>" + buf.join("\n") + "</code></pre>");
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeList(); out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^---+$/.test(line.trim())) { closeList(); out.push("<hr>"); i++; continue; }
    const ul = line.match(/^[-*]\s+(.*)$/);
    if (ul) { if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; } out.push("<li>" + mdInline(ul[1]) + "</li>"); i++; continue; }
    const ol = line.match(/^\d+\.\s+(.*)$/);
    if (ol) { if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; } out.push("<li>" + mdInline(ol[1]) + "</li>"); i++; continue; }
    if (line.trim() === "") { closeList(); i++; continue; }
    closeList();
    const para = [line]; i++;
    while (i < lines.length && lines[i].trim() !== "" && !special(lines[i])) { para.push(lines[i]); i++; }
    out.push("<p>" + para.map(mdInline).join(" ") + "</p>");
  }
  closeList();
  return out.join("\n");
}

// --- Recherche plein-texte (M3) --------------------------------------------

const SEARCH_EXTS = new Set([...TEXT_EXTS, "typo"]);
const search = { caseSensitive: false, regex: false };

el("optCase").addEventListener("click", () => toggleOpt("optCase", "caseSensitive"));
el("optRegex").addEventListener("click", () => toggleOpt("optRegex", "regex"));
function toggleOpt(id, key) {
  search[key] = !search[key];
  el(id).classList.toggle("active", search[key]);
  if (el("textSearch").value.trim()) runSearch();
}
el("textSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });
el("textSearch").addEventListener("search", () => { if (!el("textSearch").value.trim()) clearSearch(); });

el("tabTree").addEventListener("click", () => showLeft("tree"));
el("tabResults").addEventListener("click", () => showLeft("results"));
function showLeft(which) {
  el("tree").classList.toggle("hidden", which !== "tree");
  el("results").classList.toggle("hidden", which !== "results");
  el("tabTree").classList.toggle("active", which === "tree");
  el("tabResults").classList.toggle("active", which === "results");
}

function resetSearch() {
  el("textSearch").value = "";
  state.search = null;
  state.searchRe = null;
  el("results").innerHTML = "";
  el("tabResults").textContent = "Résultats";
  el("treeTabs").classList.add("hidden");
  showLeft("tree");
}

// Fichiers candidats : extensions « texte », en respectant le filtre M2.
function gatherSearchCandidates() {
  const out = [];
  (function w(ns) {
    for (const n of ns) {
      if (n.type === "dir") w(n.children || []);
      else if (n.type === "file" && SEARCH_EXTS.has(n.smaky_ext) && fileVisible(n)) out.push(n);
    }
  })(state.manifest.tree || []);
  return out;
}

async function runSearch() {
  const query = el("textSearch").value;
  if (!query.trim()) { clearSearch(); return; }

  const candidates = gatherSearchCandidates();
  state.resultNodes = new Map(candidates.map((n) => [n.fos_path, n]));
  state.search = { query, ...search };
  state.searchRe = buildHighlightRegex(query, search);

  el("treeTabs").classList.remove("hidden");
  showLeft("results");
  el("results").innerHTML =
    `<div class="res-info">Recherche dans ${candidates.length.toLocaleString("fr")} fichiers…</div>`;

  const res = await window.api.search({
    paths: candidates.map((n) => n.fos_path),
    query,
    regex: search.regex,
    caseSensitive: search.caseSensitive,
    accentInsensitive: !search.regex,
  });
  if (res.error) {
    el("results").innerHTML = `<div class="res-info error">${res.error}</div>`;
    return;
  }
  renderResults(res.results, res.scanned);
}

function clearSearch() {
  state.search = null;
  state.searchRe = null;
  el("results").innerHTML = "";
  el("tabResults").textContent = "Résultats";
  el("treeTabs").classList.add("hidden");
  showLeft("tree");
  if (state.node && state.bytes) setMode(state.mode); // retire le surlignage
}

function renderResults(list, scanned) {
  el("tabResults").textContent = `Résultats (${list.length})`;
  const box = el("results");
  box.innerHTML = "";
  const info = document.createElement("div");
  info.className = "res-info";
  info.textContent = list.length
    ? `${list.length} fichier(s) — ${scanned.toLocaleString("fr")} analysés`
    : `Aucun résultat — ${scanned.toLocaleString("fr")} fichiers analysés`;
  box.appendChild(info);

  for (const r of list) {
    const node = state.resultNodes.get(r.fos_path);
    const slash = r.fos_path.lastIndexOf("/");
    const item = document.createElement("div");
    item.className = "res-item";
    item.innerHTML =
      '<div class="res-head"><span class="res-name"></span> <span class="res-dir"></span>' +
      `<span class="res-count">${r.count}×</span></div><div class="res-snippet"></div>`;
    item.querySelector(".res-name").textContent = slash >= 0 ? r.fos_path.slice(slash + 1) : r.fos_path;
    item.querySelector(".res-dir").textContent = slash >= 0 ? r.fos_path.slice(0, slash) : "";
    item.querySelector(".res-snippet").textContent = r.line;
    item.addEventListener("click", () => {
      markSelected(item);
      selectFile(node, node.smaky_ext === "typo" ? "typo-src" : undefined);
    });
    box.appendChild(item);
  }
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildHighlightRegex(query, opts) {
  try {
    if (opts.regex) return new RegExp(query, opts.caseSensitive ? "g" : "gi");
    let pat = escapeRe(query);
    const cls = { a: "[aàâä]", e: "[eéèêë]", i: "[iîï]", o: "[oôö]", u: "[uùûü]", c: "[cç]" };
    pat = pat.replace(/[aeiouc]/gi, (ch) => cls[ch.toLowerCase()] || ch);
    return new RegExp(pat, opts.caseSensitive ? "g" : "gi");
  } catch { return null; }
}

// Surligne (<mark>) les correspondances dans tous les nœuds texte d'un conteneur.
function highlightDOM(root, re) {
  if (!re) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let t;
  while ((t = walker.nextNode()))
    if (t.parentNode && t.parentNode.nodeName !== "MARK" && t.nodeValue.trim()) nodes.push(t);
  for (const node of nodes) {
    const s = node.nodeValue;
    re.lastIndex = 0;
    if (!re.test(s)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      const mk = document.createElement("mark");
      mk.textContent = m[0] || "";
      frag.appendChild(mk);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }
}
