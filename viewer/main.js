/*
 * Navigateur Smaky — exploration de disques Smaky (format FOS).
 * Copyright (C) 2026 Epsitec SA, Pierre-Yves Rochat.
 *
 * Logiciel libre, redistribuable et modifiable selon les termes de la GNU
 * General Public License version 3 (Free Software Foundation). Distribué SANS
 * AUCUNE GARANTIE. Voir le fichier LICENSE.
 */

// Processus principal Electron.
// Crée la fenêtre et expose, via IPC, un accès fichier restreint au dossier
// extrait choisi par l'utilisateur (lecture seule, jamais en dehors du dossier).

const { app, BrowserWindow, ipcMain, dialog, clipboard } = require("electron");
const fs = require("fs/promises");
const path = require("path");

let currentRoot = null; // dossier extrait actuellement ouvert (contient manifest.json + tree/)

// Petite configuration persistante (dernier dossier ouvert, etc.).
const configFile = () => path.join(app.getPath("userData"), "config.json");
async function readConfig() {
  try { return JSON.parse(await fs.readFile(configFile(), "utf-8")); }
  catch { return {}; }
}
async function writeConfig(obj) {
  try { await fs.writeFile(configFile(), JSON.stringify(obj, null, 2), "utf-8"); }
  catch { /* non bloquant */ }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: `Navigateur Smaky v${app.getVersion()}`,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// Ouvre un sélecteur de dossier ; valide la présence de manifest.json.
ipcMain.handle("pick-folder", async () => {
  const res = await dialog.showOpenDialog({
    title: "Choisir un dossier extrait (contenant manifest.json)",
    properties: ["openDirectory"],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const folder = res.filePaths[0];
  try {
    await fs.access(path.join(folder, "manifest.json"));
  } catch {
    return { error: "manifest.json introuvable dans ce dossier." };
  }
  currentRoot = folder;
  await writeConfig({ ...(await readConfig()), lastFolder: folder }); // mémorise sans écraser le reste
  return { root: folder };
});

// Lecture / écriture (fusion) de la configuration persistante.
ipcMain.handle("get-config", async () => readConfig());
ipcMain.handle("set-config", async (_evt, patch) => {
  const next = { ...(await readConfig()), ...(patch || {}) };
  await writeConfig(next);
  return next;
});

// Rouvre le dernier dossier mémorisé (s'il existe encore et contient manifest.json).
ipcMain.handle("open-last", async () => {
  const { lastFolder } = await readConfig();
  if (!lastFolder) return null;
  try { await fs.access(path.join(lastFolder, "manifest.json")); }
  catch { return null; }
  currentRoot = lastFolder;
  return { root: lastFolder };
});

// Charge et renvoie le manifeste (objet JSON).
ipcMain.handle("read-manifest", async () => {
  if (!currentRoot) return { error: "Aucun dossier ouvert." };
  try {
    const txt = await fs.readFile(path.join(currentRoot, "manifest.json"), "utf-8");
    return { manifest: JSON.parse(txt) };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

// Lit les octets d'un fichier désigné par son chemin FOS (relatif à tree/).
// Empêche toute sortie du dossier tree/ (anti-traversée de chemin).
ipcMain.handle("read-file", async (_evt, fosPath) => {
  if (!currentRoot) return { error: "Aucun dossier ouvert." };
  const treeDir = path.join(currentRoot, "tree");
  const target = path.resolve(treeDir, ...String(fosPath).split("/"));
  const rel = path.relative(treeDir, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { error: "Chemin hors du dossier extrait." };
  }
  try {
    const buf = await fs.readFile(target);
    // On renvoie un ArrayBuffer transférable vers le renderer.
    return { bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

// Copie un texte dans le presse-papiers.
ipcMain.handle("copy-text", (_evt, text) => {
  clipboard.writeText(String(text ?? ""));
  return true;
});

// Enregistre un texte dans un fichier choisi par l'utilisateur.
ipcMain.handle("save-text", async (_evt, { defaultName, content }) => {
  const res = await dialog.showSaveDialog({ defaultPath: defaultName });
  if (res.canceled || !res.filePath) return { canceled: true };
  try {
    await fs.writeFile(res.filePath, content, "utf-8");
    return { path: res.filePath };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

// --- Recherche plein-texte (dans le processus principal, pour la vitesse) ---

// Table Smaky -> ISO-8859-1 (cf. renderer/decoders/smakytext.js).
const SMAKY2ISO = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0xFC,
  0xE0, 0xE2, 0xE9, 0xE8, 0xEB, 0xEA, 0xEF, 0xEE, 0xF4, 0xF9, 0xFB, 0xE4, 0xF6, 0xE7, 0xAB, 0xBB,
  ...Array.from({ length: 96 }, (_, i) => 32 + i),
];

function decodeSmaky(buf) {
  let out = "";
  for (const b of buf) {
    if (b > 127) continue;
    if (b === 13) { out += "\n"; continue; }
    if (b === 2) { out += " "; continue; }
    const c = SMAKY2ISO[b];
    if (c === 9 || c === 10) { out += String.fromCharCode(c); continue; }
    if (c < 32) continue;
    out += String.fromCharCode(c);
  }
  return out;
}

const deaccent = (s) => s
  .replace(/[àâä]/g, "a").replace(/[éèêë]/g, "e").replace(/[îï]/g, "i")
  .replace(/[ôö]/g, "o").replace(/[ùûü]/g, "u").replace(/ç/g, "c");

ipcMain.handle("search", async (_evt, { paths, query, regex, caseSensitive, accentInsensitive }) => {
  if (!currentRoot) return { error: "Aucun dossier ouvert." };
  const treeDir = path.join(currentRoot, "tree");

  let re = null, needle = null, transform = null;
  if (regex) {
    try { re = new RegExp(query, caseSensitive ? "g" : "gi"); }
    catch (e) { return { error: "Expression régulière invalide : " + e.message }; }
  } else {
    transform = (s) => {
      let r = caseSensitive ? s : s.toLowerCase();
      return accentInsensitive ? deaccent(r) : r;
    };
    needle = transform(query);
    if (!needle) return { results: [], scanned: 0 };
  }

  const results = [];
  let scanned = 0;
  for (const fp of paths) {
    let buf;
    try { buf = await fs.readFile(path.join(treeDir, ...String(fp).split("/"))); }
    catch { continue; }
    scanned++;
    const text = decodeSmaky(buf);
    let count = 0, first = -1;
    if (re) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        count++;
        if (first < 0) first = m.index;
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    } else {
      const hay = transform(text);
      let i = hay.indexOf(needle);
      first = i;
      while (i >= 0) { count++; i = hay.indexOf(needle, i + needle.length); }
    }
    if (count > 0) {
      const ls = text.lastIndexOf("\n", first) + 1;
      let le = text.indexOf("\n", first);
      if (le < 0) le = text.length;
      results.push({ fos_path: fp, count, line: text.slice(ls, le).trim().slice(0, 200) });
    }
  }
  results.sort((a, b) => b.count - a.count || a.fos_path.localeCompare(b.fos_path));
  return { results, scanned };
});

// Version de l'application (depuis package.json).
ipcMain.handle("get-version", () => app.getVersion());

// Renvoie le texte du fichier d'aide (help.md, à côté de main.js).
ipcMain.handle("read-help", async () => {
  try {
    return { text: await fs.readFile(path.join(__dirname, "help.md"), "utf-8") };
  } catch (e) {
    return { error: String(e.message || e) };
  }
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
