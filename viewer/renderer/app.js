import { decodeSmakyText, textRatio } from "./decoders/smakytext.js";
import { renderTypoReadableHTML, renderTypoSourceHTML } from "./decoders/typo.js";
import { decodeImage } from "./decoders/smakyimage.js";
import { decodePlan, planToSVG } from "./decoders/smakyplan.js";
import { computeReport, formatReport, smakyExt } from "./report.js";

// Extensions considérées comme du texte par défaut (sinon : affichage hexa).
const TEXT_EXTS = new Set([
  "text", "txt", "doc", "news", "pas", "bas", "cbas", "asm", "asi",
  "h", "c", "genc", "pdef", "ref", "cle", "list", "a-lire", "filer",
]);
const HEX_LIMIT = 64 * 1024; // octets affichés en mode hexa

const el = (id) => document.getElementById(id);
const state = { manifest: null, node: null, bytes: null, mode: "text", currentDir: null, dualRatio: 50, imageIndex: null };

// Affiche la version de l'application dans l'en-tête.
window.api.getVersion().then((v) => { el("appVersion").textContent = "v" + v; });

// --- Ouverture du dossier --------------------------------------------------

el("openBtn").addEventListener("click", openFolder);

async function openFolder() {
  const res = await window.api.pickFolder();
  if (!res) return;
  if (res.error) { showError(res.error); return; }
  await loadManifestInto(res.root);
}

// Rouvre automatiquement le dernier dossier (mémorisé entre sessions).
async function openLastFolder() {
  const res = await window.api.openLast();
  if (res && res.root) await loadManifestInto(res.root);
}

// Charge le manifeste du dossier déjà sélectionné côté principal et met à jour l'UI.
async function loadManifestInto(root) {
  el("folderPath").textContent = root;
  const m = await window.api.readManifest();
  if (m.error) { showError(m.error); return; }
  state.manifest = m.manifest;
  state.currentDir = null;
  state.imageIndex = null; // sera reconstruit pour ce disque
  el("reportBtn").disabled = false;
  el("extBtn").disabled = false;
  el("textSearch").disabled = false;
  el("searchBtn").disabled = false;
  el("optCase").disabled = false;
  el("optRegex").disabled = false;
  el("optName").disabled = false;
  resetFilter();
  resetSearch();
  buildExtList();
  renderTree(m.manifest.tree || []);
  const s = m.manifest.stats || {};
  el("content").innerHTML =
    `<p class="placeholder">Disque chargé : ${s.dirs || 0} dossiers, ` +
    `${s.files || 0} fichiers. Sélectionne un fichier à gauche.</p>`;
}

// Au lancement : restaure les préférences (ratio du dual view) puis le dernier dossier.
async function restoreSession() {
  try {
    const cfg = await window.api.getConfig();
    if (cfg && typeof cfg.dualRatio === "number") state.dualRatio = cfg.dualRatio;
  } catch { /* config indisponible : valeurs par défaut */ }
  await openLastFolder();
}
restoreSession();

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
  const e = smakyExt(node);
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
    b.textContent = smakyExt(node);
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
  plan:        { label: "Plan",    render: renderPlan },
  text:        { label: "Texte",   render: renderText },
  "typo-read": { label: "Lecture", render: (b) => renderHTMLView(renderTypoReadableHTML(b), b, "rendu indicatif") },
  "typo-src":  { label: "Source",  render: (b) => renderHTMLView(renderTypoSourceHTML(b), b) },
  "typo-dual": { label: "Source + Lecture", render: renderTypoDual },
  assoc:       { label: "Fichiers associés", render: renderAssoc },
  hex:         { label: "Hexa",    render: renderHex },
};

function modesForNode(node, bytes) {
  if (isAssoc(node)) return ["assoc", "text", "hex"]; // manifeste « nom!type »
  if (node.smaky_ext === "image" || node.smaky_ext === "color") return ["image", "hex"];
  if (node.smaky_ext === "plan") return ["plan", "hex"];
  if (node.smaky_ext === "typo") return ["typo-read", "typo-src", "typo-dual", "hex"];
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
  el("content").className = "content"; // repart d'un état propre (retire content--split, etc.)
  MODES[mode].render(state.bytes);
  // Surligne les correspondances de recherche dans les modes texte.
  if (state.searchRe && ["text", "typo-read", "typo-src", "typo-dual"].includes(mode))
    highlightDOM(el("content"), state.searchRe);
  // Réapplique la recherche Ctrl-F au nouveau contenu si la barre est ouverte.
  if (findVisible()) runFind();
  // Affiche les images référencées dans le rendu Typo (asynchrone).
  if (["typo-read", "typo-dual"].includes(mode) && state.node)
    hydrateFigures(el("content"), state.node);
}

function renderText(bytes) {
  const pre = document.createElement("pre");
  pre.textContent = decodeSmakyText(bytes);
  setContent(pre);
  el("viewerNote").textContent = `${bytes.length.toLocaleString("fr")} octets`;
}

// Fichier d'association Smaky « nom!type » : repéré par un « ! » dans le nom.
function isAssoc(node) {
  return node.type === "file" && !!node.name && node.name.includes("!");
}

// Retrouve un nœud de l'arbre par son chemin FOS (recherche unique, pas de hot loop).
function findNodeByPath(path) {
  let found = null;
  (function walk(ns) {
    for (const n of ns) {
      if (found) return;
      if (n.fos_path === path) { found = n; return; }
      if (n.children) walk(n.children);
    }
  })(state.manifest.tree || []);
  return found;
}

// Mode « Fichiers associés » : affiche la liste des fichiers liés, chacun cliquable
// pour ouvrir le fichier correspondant (résolu dans le même dossier).
function renderAssoc(bytes) {
  const lines = decodeSmakyText(bytes).split("\n").map((s) => s.trim()).filter(Boolean);

  // Frères du fichier d'association = enfants de son dossier parent.
  const parentPath = state.node.fos_path.split("/").slice(0, -1).join("/");
  const parent = parentPath ? findNodeByPath(parentPath) : { children: state.manifest.tree };
  const byName = new Map();
  for (const c of (parent && parent.children) || [])
    if (c.type === "file") byName.set(c.name.toLowerCase(), c);

  const wrap = document.createElement("div");
  wrap.className = "assoc-view";
  const head = document.createElement("p");
  head.className = "assoc-head";
  head.textContent = `Fichier d'association — ${lines.length} fichier(s) lié(s) :`;
  wrap.appendChild(head);

  const ul = document.createElement("ul");
  ul.className = "assoc-list";
  for (const line of lines) {
    const baseName = line.split("/")[0].trim();        // retire l'attribut /D, /M, etc.
    const target = byName.get(baseName.toLowerCase());
    const li = document.createElement("li");
    const isSelf = target && target.fos_path === state.node.fos_path;
    if (target && !isSelf) {
      const a = document.createElement("a");
      a.className = "assoc-link";
      a.href = "#";
      a.textContent = line;
      a.addEventListener("click", (e) => { e.preventDefault(); selectFile(target); });
      li.appendChild(a);
    } else {
      li.className = "assoc-plain";
      li.textContent = isSelf ? `${line}  (ce fichier)` : `${line}  (non trouvé dans ce dossier)`;
    }
    ul.appendChild(li);
  }
  wrap.appendChild(ul);
  setContent(wrap);
  el("viewerNote").textContent = `${bytes.length.toLocaleString("fr")} octets`;
}

function renderHTMLView(html, bytes, note) {
  el("content").innerHTML = html;
  el("viewerNote").textContent =
    `${bytes.length.toLocaleString("fr")} octets` + (note ? ` — ${note}` : "");
}

// Mode « Source + Lecture » : les deux rendus côte à côte, défilement indépendant,
// séparation ajustable par glisser-déposer de la poignée centrale.
function renderTypoDual(bytes) {
  el("content").classList.add("content--split");
  const wrap = document.createElement("div");
  wrap.className = "typo-dual";
  const pane = (title, inner) => {
    const p = document.createElement("div");
    p.className = "dual-pane";
    p.innerHTML = `<div class="dual-title">${title}</div>${inner}`;
    return p;
  };
  const left = pane("Source", renderTypoSourceHTML(bytes));
  const right = pane("Lecture", renderTypoReadableHTML(bytes));
  const divider = document.createElement("div");
  divider.className = "dual-divider";
  divider.title = "Glisser pour ajuster";
  left.style.flex = `0 0 ${state.dualRatio}%`;
  right.style.flex = "1 1 0";

  divider.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const move = (ev) => {
      const r = wrap.getBoundingClientRect();
      const pct = Math.max(15, Math.min(85, ((ev.clientX - r.left) / r.width) * 100));
      state.dualRatio = pct;             // mémorisé pour les fichiers suivants
      left.style.flex = `0 0 ${pct}%`;
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
      window.api.setConfig({ dualRatio: state.dualRatio }); // mémorise entre sessions
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
    document.body.style.cursor = "col-resize";
  });

  wrap.append(left, divider, right);
  setContent(wrap);
  el("viewerNote").textContent = `${bytes.length.toLocaleString("fr")} octets — source ↔ rendu`;
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

// --- Dessins vectoriels .PLAN ----------------------------------------------

function renderPlan(bytes) {
  const content = el("content");
  content.innerHTML = "";
  const dec = decodePlan(bytes);
  if (!dec) {
    content.innerHTML = '<p class="error">Dessin .plan vide ou non décodable. Essaie le mode Hexa.</p>';
    el("viewerNote").textContent = "";
    return;
  }
  const wDisp = (dec.x1 - dec.x0) / 4, hDisp = (dec.y1 - dec.y0) / 4;
  let scale = Math.min(6, Math.max(1, Math.floor(240 / Math.max(1, Math.min(wDisp, hDisp))) || 1));
  const wrap = document.createElement("div");
  wrap.className = "plan-wrap";
  const bar = document.createElement("div");
  bar.className = "img-zoom";
  const apply = () => {
    wrap.innerHTML = planToSVG(dec, { scale });
    bar.querySelectorAll("button").forEach((b) => b.classList.toggle("active", +b.dataset.s === scale));
  };
  for (const s of [1, 2, 4, 6]) {
    const b = document.createElement("button");
    b.textContent = "×" + s;
    b.dataset.s = s;
    b.addEventListener("click", () => { scale = s; apply(); });
    bar.appendChild(b);
  }
  content.append(bar, wrap);
  apply();
  el("viewerNote").textContent =
    `${dec.prims.length} éléments — ${Math.round(wDisp)}×${Math.round(hDisp)}`;
}

// Index { nom_de_base -> [nœuds .plan] }, construit une fois par disque.
function buildPlanIndex() {
  const idx = new Map();
  (function walk(ns) {
    for (const n of ns) {
      if (n.type === "dir") walk(n.children || []);
      else if (n.type === "file" && n.smaky_ext === "plan") {
        const dot = n.name.lastIndexOf(".");
        const base = (dot > 0 ? n.name.slice(0, dot) : n.name).toLowerCase();
        if (!idx.has(base)) idx.set(base, []);
        idx.get(base).push(n);
      }
    }
  })(state.manifest.tree || []);
  return idx;
}

// Résout une référence de figure \figplan vers un nœud .plan (même logique que
// resolveFigure : on préfère le dossier courant, on renonce si ambigu).
function resolvePlanFigure(ref, currentDir) {
  if (!ref) return null;
  let base = ref.includes(":") ? ref.slice(ref.lastIndexOf(":") + 1) : ref;
  base = base.trim().toLowerCase();
  if (!base || base.includes("%")) return null;
  state.planIndex = state.planIndex || buildPlanIndex();
  const cands = state.planIndex.get(base);
  if (!cands || !cands.length) return null;
  const same = cands.find((n) => n.fos_path.slice(0, n.fos_path.lastIndexOf("/")) === currentDir);
  if (same) return same;
  return cands.length === 1 ? cands[0] : null;
}

// --- Images dans le rendu Typo (\image …) ----------------------------------

// Décode des octets image/color en un canvas (ou null si indécodable).
function decodedCanvas(bytes, ext) {
  const img = decodeImage(bytes, ext);
  if (!img) return null;
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext("2d").putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
  return { canvas, img };
}

// Index { nom_de_base -> [nœuds image/color] } construit une fois par disque.
function buildImageIndex() {
  const idx = new Map();
  (function walk(ns) {
    for (const n of ns) {
      if (n.type === "dir") walk(n.children || []);
      else if (n.type === "file" && (n.smaky_ext === "image" || n.smaky_ext === "color")) {
        const dot = n.name.lastIndexOf(".");
        const base = (dot > 0 ? n.name.slice(0, dot) : n.name).toLowerCase();
        if (!idx.has(base)) idx.set(base, []);
        idx.get(base).push(n);
      }
    }
  })(state.manifest.tree || []);
  return idx;
}

// Résout une référence de figure (« schema », « @LEYLA:ART:ABUS_1 ») vers un nœud image.
// Préfère le dossier courant ; si plusieurs candidats ailleurs, renonce (ambigu).
function resolveFigure(ref, currentDir) {
  if (!ref) return null;
  let base = ref.includes(":") ? ref.slice(ref.lastIndexOf(":") + 1) : ref;
  base = base.trim().toLowerCase();
  if (!base || base.includes("%")) return null; // paramètre de macro non résolu
  state.imageIndex = state.imageIndex || buildImageIndex();
  const cands = state.imageIndex.get(base);
  if (!cands || !cands.length) return null;
  const same = cands.find((n) => n.fos_path.slice(0, n.fos_path.lastIndexOf("/")) === currentDir);
  if (same) return same;
  return cands.length === 1 ? cands[0] : null;
}

// Remplace les placeholders « .t-fig » par l'image décodée, quand elle est trouvée.
async function hydrateFigures(container, node) {
  const figEls = [...container.querySelectorAll(".t-fig[data-fig]")];
  if (!figEls.length) return;
  const currentDir = node.fos_path.slice(0, node.fos_path.lastIndexOf("/"));
  for (const figEl of figEls) {
    if (state.node !== node) return; // l'utilisateur a changé de fichier : on abandonne
    const ref = figEl.dataset.fig;

    // 1) Image réelle (\image, .image/.color). En cas d'échec, on tente le .plan.
    const target = resolveFigure(ref, currentDir);
    if (target) {
      const res = await window.api.readFile(target.fos_path);
      const dec = (!res.error && res.bytes)
        ? decodedCanvas(new Uint8Array(res.bytes), target.smaky_ext) : null;
      if (dec) {
        const sc = Math.min(4, Math.max(1, Math.floor(120 / Math.min(dec.img.width, dec.img.height)) || 1));
        dec.canvas.className = "t-fig-canvas";
        dec.canvas.style.width = dec.img.width * sc + "px";
        dec.canvas.style.height = dec.img.height * sc + "px";
        const cap = document.createElement("div");
        cap.className = "t-fig-cap";
        cap.textContent = `${ref} — ${dec.img.width}×${dec.img.height}`;
        figEl.classList.add("t-fig--img");
        figEl.innerHTML = "";
        figEl.append(dec.canvas, cap);
        continue;
      }
    }

    // 2) Dessin vectoriel (\figplan, .plan).
    const ptarget = resolvePlanFigure(ref, currentDir);
    if (!ptarget) continue; // non résolue : on garde le placeholder texte
    const pres = await window.api.readFile(ptarget.fos_path);
    if (pres.error || !pres.bytes) continue;
    const pdec = decodePlan(new Uint8Array(pres.bytes));
    if (!pdec) continue;
    const cap = document.createElement("div");
    cap.className = "t-fig-cap";
    cap.textContent = `${ref} — plan (${pdec.prims.length} éléments)`;
    figEl.classList.add("t-fig--plan");
    figEl.innerHTML = planToSVG(pdec, { scale: 2 });
    figEl.append(cap);
  }
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
const search = { caseSensitive: false, regex: false, byName: false };

el("optCase").addEventListener("change", () => setOpt("caseSensitive", el("optCase").checked));
el("optRegex").addEventListener("change", () => setOpt("regex", el("optRegex").checked));
el("optName").addEventListener("change", () => setOpt("byName", el("optName").checked));

// Construit un test de correspondance (non global) pour les noms de fichiers.
function nameMatcher(query, opts) {
  if (opts.regex) {
    try { return new RegExp(query, opts.caseSensitive ? "" : "i"); } catch { return null; }
  }
  let pat = escapeRe(query);
  const cls = { a: "[aàâä]", e: "[eéèêë]", i: "[iîï]", o: "[oôö]", u: "[uùûü]", c: "[cç]" };
  pat = pat.replace(/[aeiouc]/gi, (ch) => cls[ch.toLowerCase()] || ch);
  try { return new RegExp(pat, opts.caseSensitive ? "" : "i"); } catch { return null; }
}

// Recherche par nom de fichier : tous les fichiers visibles dont le nom correspond.
function searchByFilename(query) {
  const matcher = nameMatcher(query, search);
  const matches = [];
  if (matcher) (function w(ns) {
    for (const n of ns) {
      if (n.type === "dir") w(n.children || []);
      else if (n.type === "file" && fileVisible(n)) {
        const nm = n.name || n.fos_path.slice(n.fos_path.lastIndexOf("/") + 1);
        if (matcher.test(nm)) matches.push(n);
      }
    }
  })(state.manifest.tree || []);
  state.resultNodes = new Map(matches.map((n) => [n.fos_path, n]));
  state.search = { query, ...search };
  state.searchRe = null;                       // pas de surlignage de contenu
  el("treeTabs").classList.remove("hidden");
  showLeft("results");
  renderResults(matches.map((n) => ({
    fos_path: n.fos_path, count: 1,
    line: `${n.smaky_ext || "?"} — ${(n.size || 0).toLocaleString("fr")} o`,
  })), matches.length);
}
function setOpt(key, val) {
  search[key] = val;
  if (el("textSearch").value.trim()) runSearch(); // relance si une recherche est en cours
}
el("searchBtn").addEventListener("click", () => runSearch());
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
  search.caseSensitive = false;
  search.regex = false;
  search.byName = false;
  el("optCase").checked = false;
  el("optRegex").checked = false;
  el("optName").checked = false;
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

  if (search.byName) { searchByFilename(query); return; }   // recherche par nom

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

// --- Recherche dans le fichier courant (Ctrl-F) ----------------------------

const find = { hits: [], idx: -1 };
const findVisible = () => !el("findBar").classList.contains("hidden");

function openFind() {
  if (!state.bytes) return;            // aucun fichier affiché
  el("findBar").classList.remove("hidden");
  const inp = el("findInput");
  inp.focus(); inp.select();
  if (inp.value.trim()) runFind();
}

function closeFind() {
  el("findBar").classList.add("hidden");
  clearFindMarks();
  find.hits = []; find.idx = -1;
  el("findCount").textContent = "";
}

// Retire uniquement les surlignages de Ctrl-F (laisse ceux de la recherche globale).
function clearFindMarks() {
  const content = el("content");
  content.querySelectorAll("mark.find-hit").forEach((m) =>
    m.replaceWith(document.createTextNode(m.textContent)));
  content.normalize();
}

function runFind() {
  clearFindMarks();
  find.hits = []; find.idx = -1;
  const q = el("findInput").value;
  if (!q.trim()) { el("findCount").textContent = ""; return; }
  const re = buildHighlightRegex(q, { regex: false, caseSensitive: false });
  if (!re) { el("findCount").textContent = "—"; return; }

  const content = el("content");
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  const targets = [];
  let t;
  while ((t = walker.nextNode()))
    if (t.parentNode && t.parentNode.nodeName !== "MARK" && t.nodeValue.trim()) targets.push(t);

  for (const node of targets) {
    const s = node.nodeValue;
    re.lastIndex = 0;
    if (!re.test(s)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      const mk = document.createElement("mark");
      mk.className = "find-hit";
      mk.textContent = m[0] || "";
      frag.appendChild(mk);
      find.hits.push(mk);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  if (find.hits.length) setCurrentHit(0);
  else el("findCount").textContent = "0/0";
}

function setCurrentHit(i) {
  if (!find.hits.length) return;
  if (find.idx >= 0 && find.hits[find.idx]) find.hits[find.idx].classList.remove("find-current");
  find.idx = (i + find.hits.length) % find.hits.length;
  const cur = find.hits[find.idx];
  cur.classList.add("find-current");
  cur.scrollIntoView({ block: "center", inline: "nearest" });
  el("findCount").textContent = `${find.idx + 1}/${find.hits.length}`;
}

function navFind(delta) {
  if (find.hits.length) setCurrentHit(find.idx + delta);
}

el("findInput").addEventListener("input", runFind);
el("findInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); navFind(e.shiftKey ? -1 : 1); }
  else if (e.key === "Escape") { e.preventDefault(); closeFind(); }
});
el("findNext").addEventListener("click", () => navFind(1));
el("findPrev").addEventListener("click", () => navFind(-1));
el("findClose").addEventListener("click", closeFind);

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
    e.preventDefault(); openFind();
  } else if (e.key === "Escape" && findVisible()) {
    closeFind();
  }
});
