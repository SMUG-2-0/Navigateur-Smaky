// Pont sécurisé entre le renderer et le processus principal.
// N'expose qu'un petit ensemble de fonctions de lecture.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  pickFolder: () => ipcRenderer.invoke("pick-folder"),
  // Ouvre une image .DI et l'extrait ; renvoie { root } | { canceled } | { error }.
  openDi: () => ipcRenderer.invoke("open-di"),
  // S'abonne à la progression de l'extraction ; renvoie une fonction de désabonnement.
  onExtractProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on("extract-progress", listener);
    return () => ipcRenderer.removeListener("extract-progress", listener);
  },
  readManifest: () => ipcRenderer.invoke("read-manifest"),
  // Renvoie { bytes: ArrayBuffer } ou { error }.
  readFile: (fosPath) => ipcRenderer.invoke("read-file", fosPath),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  saveText: (defaultName, content) => ipcRenderer.invoke("save-text", { defaultName, content }),
  // params: { paths, query, regex, caseSensitive, accentInsensitive }
  search: (params) => ipcRenderer.invoke("search", params),
  readHelp: () => ipcRenderer.invoke("read-help"),
  getVersion: () => ipcRenderer.invoke("get-version"),
});
