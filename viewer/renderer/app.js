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

function renderTree(nodes) {
  const root = el("tree");
  root.innerHTML = "";
  const ul = document.createElement("ul");
  for (const n of sortNodes(nodes)) ul.appendChild(makeNode(n));
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
        for (const c of sortNodes(node.children || [])) childrenUl.appendChild(makeNode(c));
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
