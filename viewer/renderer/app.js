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

// --- Ouverture du dossier --------------------------------------------------

el("openBtn").addEventListener("click", openFolder);

async function openFolder() {
  const res = await window.api.pickFolder();
  if (!res) return;
  if (res.error) { showError(res.error); return; }
  el("folderPath").textContent = res.root;
  const m = await window.api.readManifest();
  if (m.error) { showError(m.error); return; }
  state.manifest = m.manifest;
  state.currentDir = null;
  el("reportBtn").disabled = false;
  el("extBtn").disabled = false;
  resetFilter();
  buildExtList();
  renderTree(m.manifest.tree || []);
  const s = m.manifest.stats || {};
  el("content").innerHTML =
    `<p class="placeholder">Disque chargé : ${s.dirs || 0} dossiers, ` +
    `${s.files || 0} fichiers. Sélectionne un fichier à gauche.</p>`;
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
    row.addEventListener("click", () => selectFile(node, row));
  }
  return li;
}

// --- Sélection / visualisation --------------------------------------------

async function selectFile(node, row) {
  document.querySelectorAll(".node-row.selected").forEach((r) => r.classList.remove("selected"));
  row.classList.add("selected");
  state.node = node;
  showMeta(node);

  const res = await window.api.readFile(node.fos_path);
  if (res.error) { showError(res.error); return; }
  state.bytes = new Uint8Array(res.bytes);
  showViewer(node, state.bytes);
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

function showViewer(node, bytes) {
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
  setMode(modes[0]);
}

function setMode(mode) {
  state.mode = mode;
  el("viewerToolbar").querySelectorAll("button").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode));
  if (state.bytes) MODES[mode].render(state.bytes);
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
