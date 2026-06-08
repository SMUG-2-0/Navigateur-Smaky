/*
 * Navigateur Smaky — Copyright (C) 2026 Epsitec SA, Pierre-Yves Rochat.
 * Logiciel libre sous GNU General Public License v3 — voir le fichier LICENSE.
 */

// Worker thread d'extraction d'une image .DI.
//
// L'analyse d'une image (plusieurs centaines de Mo) et l'écriture de dizaines de
// milliers de fichiers bloqueraient la boucle d'événements du processus principal
// (interface figée). On exécute donc fosfat.js dans un thread séparé, qui poste
// la progression puis le résultat.
//
// Messages reçus (workerData) : { diPath, outDir }
// Messages postés :
//   { type: "progress", dirs, files, bytes }
//   { type: "done", manifest }
//   { type: "error", message }

"use strict";

const { parentPort, workerData } = require("worker_threads");
const fosfat = require("./fosfat");

try {
  const { diPath, outDir } = workerData;
  let last = 0;
  const manifest = fosfat.extractImage(diPath, outDir, (p) => {
    // Limite le débit de messages (au plus ~20/s) pour ne pas saturer l'IPC.
    const now = Date.now();
    if (now - last >= 50) {
      last = now;
      parentPort.postMessage({ type: "progress", ...p });
    }
  });
  parentPort.postMessage({ type: "done", manifest });
} catch (e) {
  parentPort.postMessage({ type: "error", message: String((e && e.message) || e) });
}
