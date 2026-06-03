// Processus principal Electron.
// Crée la fenêtre et expose, via IPC, un accès fichier restreint au dossier
// extrait choisi par l'utilisateur (lecture seule, jamais en dehors du dossier).

const { app, BrowserWindow, ipcMain, dialog, clipboard } = require("electron");
const fs = require("fs/promises");
const path = require("path");

let currentRoot = null; // dossier extrait actuellement ouvert (contient manifest.json + tree/)

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "Navigateur Smaky",
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
  return { root: folder };
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

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
