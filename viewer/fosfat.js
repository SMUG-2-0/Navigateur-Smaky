/*
 * Navigateur Smaky — Copyright (C) 2026 Epsitec SA, Pierre-Yves Rochat.
 * Logiciel libre sous GNU General Public License v3 — voir le fichier LICENSE.
 *
 * Ce module est un portage en JavaScript de libfosfat (projet FOSfat,
 * Mathieu Schroeter, Epsitec SA), lui-même sous GPL v3.
 */

// Lecture du système de fichiers FOS des disques Smaky, directement depuis une
// image .DI, sans dépendance native (ni FOSfat compilé, ni WSL, ni Python).
//
// Porté de FOSfat (libfosfat/fosfat.c) et validé au fichier près contre la
// sortie de l'outil `fosread`. Reproduit ce que faisait tools/extract_di.py :
// produit <outDir>/tree/ (copie binaire fidèle) + <outDir>/manifest.json
// (métadonnées FOS). L'image source n'est jamais modifiée (lecture seule).
//
// Tout est en blocs de 256 octets. Les entiers multi-octets sont en BIG-ENDIAN
// (fonction c2l). L'adresse d'un bloc sur le disque = (block + fosboot) * 256,
// où fosboot vaut 0x10 (disquette) ou 0x20 (disque dur), autodétecté.

"use strict";

const fs = require("fs");
const path = require("path");

const BLK = 256; // taille d'un bloc FOS
const SYSLIST = 0x01; // bloc du SYS_LIST racine
const FOSBOOT_FD = 0x10; // décalage (en blocs) pour une disquette
const FOSBOOT_HD = 0x20; // décalage (en blocs) pour un disque dur
const Y2K = 70; // pivot des années sur deux chiffres

// Attributs FOS (champ att, 4 octets, lu en big-endian).
const ATT_OPENEX = 1 << 0;
const ATT_MULTIPLE = 1 << 1;
const ATT_DIR = 1 << 12;
const ATT_VISIBLE = 1 << 13;
const ATT_ENCODED = 1 << 17;
const ATT_LINK = 1 << 24;
const TYPE_SYSTEM = 0xf8; // type « système » : 5 bits de poids fort du champ typ

// --- Conversions de base ------------------------------------------------------

// Combine `size` octets en un entier, big-endian (équiv. de c2l dans fosfat.c).
// Multiplication plutôt que décalage pour éviter les soucis de signe 32 bits.
function c2l(buf, off, size) {
  let res = 0;
  for (let i = 0; i < size; i++) res = res * 256 + buf[off + i];
  return res;
}

// BCD (un octet code deux chiffres décimaux) -> entier (cf. bcd2int).
function bcd2int(hex) {
  const res = (hex >> 4) * 10 + (hex & 0x0f);
  return res > 99 ? 0 : res;
}

// Année sur deux chiffres -> quatre chiffres (cf. y2k).
function y2k(y) {
  return (y < Y2K ? 2000 : 1900) + y;
}

const pad2 = (n) => String(n).padStart(2, "0");

// Date FOS (champs BCD) -> "YYYY-MM-DD HH:MM", ou "" si date nulle.
// On reproduit le format et la normalisation de tools/extract_di.py (à la minute).
function fosDate(buf, dOff, hOff) {
  const year = y2k(bcd2int(buf[dOff + 2]));
  const month = bcd2int(buf[dOff + 1]);
  const day = bcd2int(buf[dOff + 0]);
  const hour = bcd2int(buf[hOff + 0]);
  const minute = bcd2int(buf[hOff + 1]);
  const s = `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}`;
  return s.startsWith("2000-00-00") || s.includes("-00-00") ? "" : s;
}

// Extension Smaky : après le dernier '.' ou '!' (ex. "fmm10!typo", "arbre!pas").
function smakyExt(name) {
  for (const sep of [".", "!"]) {
    const i = name.lastIndexOf(sep);
    if (i >= 0) return name.slice(i + 1).toLowerCase();
  }
  return "";
}

// Nom d'une entrée (16 octets), tronqué au premier NUL, mis en minuscules.
function readName(buf, off) {
  let end = off;
  const max = off + 16;
  while (end < max && buf[end] !== 0) end++;
  return buf.toString("latin1", off, end).toLowerCase();
}

// --- Handle disque ------------------------------------------------------------

// Ouvre une image .DI : charge l'image entière en mémoire et détecte le fosboot.
// (Une image disque dur fait quelques centaines de Mo : un Buffer convient, et
//  l'accès à un bloc devient un simple subarray, donc rapide.)
function openImage(diPath) {
  const buf = fs.readFileSync(diPath);
  const h = { buf, fosboot: -1, foschk: 0, size: buf.length, path: diPath };
  h.fosboot = diskAuto(h);
  if (h.fosboot < 0) {
    throw new Error(
      "Type de disque FOS non reconnu (ni disquette ni disque dur). " +
        "L'image est-elle bien un disque Smaky au format FOS ?"
    );
  }
  return h;
}

// Position (octet) d'un bloc dans l'image (cf. blk2add).
function blkAddr(h, block) {
  return (block + h.fosboot) * BLK;
}

// Renvoie une vue de 256 octets sur le bloc `block`, ou null si hors limites.
function blockBytes(h, block) {
  const off = blkAddr(h, block);
  if (off < 0 || off + BLK > h.size) return null;
  return h.buf.subarray(off, off + BLK);
}

// Autodétection disquette/disque dur (cf. fosfat_diskauto).
// On teste fosboot = FD puis HD ; valide si le CHK du BD SYS_LIST (bloc 1) et
// celui du premier BL (bloc 2) coïncident, et que sys_list.pts[0] == 2.
function diskAuto(h) {
  for (const fb of [FOSBOOT_FD, FOSBOOT_HD]) {
    h.fosboot = fb;
    const sysList = blockBytes(h, SYSLIST); // BD : chk à l'offset 246
    const firstBl = blockBytes(h, SYSLIST + 1); // BL : chk à l'offset 244
    if (
      sysList &&
      firstBl &&
      sysList[246] === firstBl[244] &&
      sysList[247] === firstBl[245] &&
      sysList[248] === firstBl[246] &&
      sysList[249] === firstBl[247] &&
      c2l(sysList, 10, 4) === SYSLIST + 1 // pts[0] (offset 10) == bloc 2
    ) {
      return fb;
    }
  }
  return -1;
}

// Nom du disque (bloc 0, champ nlo de 16 octets à l'offset 44).
function diskName(h) {
  const b0 = blockBytes(h, 0);
  if (!b0 || b0[44] === 0xff) return "";
  return readName(b0, 44);
}

// --- Lecture d'un fichier -----------------------------------------------------

// Reconstitue le contenu binaire d'un fichier à partir de son premier BD.
// On suit la liste chaînée de BD ; pour chaque tranche i (< npt), on lit nbs[i]
// blocs DATA consécutifs depuis pts[i]. Le tout dernier bloc de la dernière
// tranche de chaque BD est tronqué à `lst` octets (cf. fosfat_get).
function getFileBytes(h, firstBd) {
  const chunks = [];
  let bdBlock = firstBd;
  let guard = 0;
  while (bdBlock && guard++ < 1_000_000) {
    const bd = blockBytes(h, bdBlock);
    if (!bd) break;
    const npt = c2l(bd, 8, 2); // npt à l'offset 8
    const lst = c2l(bd, 240, 2); // octets dans la dernière tranche (offset 240)
    for (let i = 0; i < npt; i++) {
      const ptr = c2l(bd, 10 + i * 4, 4); // pts[i] (offset 10, 4 octets chacun)
      const nbs = bd[194 + i]; // nbs[i] (offset 194, 1 octet chacun)
      for (let j = 0; j < nbs; j++) {
        const data = blockBytes(h, ptr + j);
        if (!data) return Buffer.concat(chunks);
        const lastBlock = i === npt - 1 && j === nbs - 1;
        const take = lastBlock ? lst : BLK;
        chunks.push(Buffer.from(data.subarray(0, take)));
      }
    }
    bdBlock = c2l(bd, 0, 4); // next BD (offset 0) ; 0 = fin de chaîne
  }
  return Buffer.concat(chunks);
}

// Cible d'un lien symbolique (cf. fosfat_get_link) : 1er bloc DATA, à partir de
// l'octet 3, ':' -> '/', on retire le dernier segment. Utilisé seulement pour
// renseigner le manifeste (on ne suit pas les liens).
function getLinkTarget(h, firstBd) {
  const bd = blockBytes(h, firstBd);
  if (!bd) return "";
  const ptr = c2l(bd, 10, 4);
  const data = blockBytes(h, ptr);
  if (!data) return "";
  let end = 3;
  while (end < BLK && data[end] !== 0) end++;
  let s = data.toString("latin1", 3, end).replace(/:/g, "/");
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(0, slash);
  return s.toLowerCase();
}

// --- Lecture d'un répertoire --------------------------------------------------

// Renvoie la liste des BL (chacun = vue 256 octets) d'un répertoire, à partir
// de son BD (cf. fosfat_read_dir). Les pts du BD désignent ici des BL.
function readDirBLs(h, dirBd) {
  const bls = [];
  let bdBlock = dirBd;
  let guard = 0;
  while (bdBlock && guard++ < 1_000_000) {
    const bd = blockBytes(h, bdBlock);
    if (!bd) break;
    const npt = c2l(bd, 8, 2);
    for (let i = 0; i < npt; i++) {
      const ptr = c2l(bd, 10 + i * 4, 4);
      const nbs = bd[194 + i];
      for (let j = 0; j < nbs; j++) {
        const bl = blockBytes(h, ptr + j);
        if (bl) bls.push(bl);
      }
    }
    bdBlock = c2l(bd, 0, 4);
  }
  return bls;
}

// Décrit une entrée fichier (BLF, 60 octets) à l'intérieur d'un BL.
// Offsets dans la BLF : name 0, typ 16, att 18, lgf 54, pt 50,
//   dates création cd 28 / ch 31, écriture wd 34 / wh 37, accès rd 40 / rh 43.
function parseBlf(bl, base) {
  let name = readName(bl, base + 0);
  const typ = bl[base + 16];
  const att = c2l(bl, base + 18, 4);
  const isDir = !!(att & ATT_DIR);
  const isLink = !!(att & ATT_LINK);
  // Comme `fosread`, on tronque le nom des dossiers et des liens à leur dernier
  // '.' (les dossiers FOS portent l'extension « .dir », ex. "trax.dir" -> "trax").
  if ((isDir || isLink) && name.includes(".")) {
    name = name.slice(0, name.lastIndexOf("."));
  }
  const isVisible = !!(att & ATT_VISIBLE);
  const isEncoded = !!(att & ATT_ENCODED);
  const isOpenexm = !!(att & (ATT_OPENEX | ATT_MULTIPLE));
  const isSystem = !!(typ & TYPE_SYSTEM);
  const isNotDel = name.length > 0; // un nom vide = entrée supprimée
  return {
    name,
    typ,
    isDir,
    isLink,
    isVisible,
    isEncoded,
    isOpenexm,
    isSystem,
    isNotDel,
    bd: c2l(bl, base + 50, 4), // pt -> BD de cette entrée
    size: c2l(bl, base + 54, 4), // lgf : taille en octets
    created: fosDate(bl, base + 28, base + 31),
    changed: fosDate(bl, base + 34, base + 37),
    viewed: fosDate(bl, base + 40, base + 43),
  };
}

// Itère les entrées « réelles » d'un répertoire (équiv. fosfat_list_dir, sans la
// pseudo-entrée parent « ..dir ») : non-système, ouvrables (openexm), non
// supprimées. 4 BLF par BL.
function* listDir(h, dirBd) {
  for (const bl of readDirBLs(h, dirBd)) {
    for (let i = 0; i < 4; i++) {
      const e = parseBlf(bl, i * 60);
      if (e.isSystem) continue; // dont SYS_LIST (« ..dir »)
      if (!e.isOpenexm) continue;
      if (!e.isNotDel) continue; // on ignore les fichiers supprimés
      yield e;
    }
  }
}

// --- Extraction complète ------------------------------------------------------

// Parcourt récursivement le disque depuis le SYS_LIST et :
//  - écrit chaque fichier (copie binaire fidèle) dans <outDir>/tree/
//  - construit l'arbre de nœuds au format de extract_di.py
//  - écrit <outDir>/manifest.json
// onProgress({dirs, files, bytes}) est appelé périodiquement (peut être omis).
function extract(h, outDir, onProgress) {
  const treeDir = path.join(outDir, "tree");
  fs.mkdirSync(treeDir, { recursive: true });

  const stats = { dirs: 0, files: 0, links: 0, bytes: 0 };
  let sinceTick = 0;
  const tick = (force) => {
    if (!onProgress) return;
    if (force || ++sinceTick >= 200) {
      sinceTick = 0;
      onProgress({ dirs: stats.dirs, files: stats.files, bytes: stats.bytes });
    }
  };

  // Parcours d'un répertoire : `fosParent` = chemin FOS, `hostDir` = dossier hôte.
  const walk = (dirBd, fosParent, hostDir, depth) => {
    const children = [];
    for (const e of listDir(h, dirBd)) {
      const fosPath = fosParent ? `${fosParent}/${e.name}` : e.name;
      const ext = smakyExt(e.name);
      const base = {
        fos_path: fosPath,
        name: e.name,
        size: e.size,
        hidden: !e.isVisible,
        encoded: e.isEncoded,
        smaky_ext: ext,
        created: e.created,
        changed: e.changed,
        viewed: e.viewed,
      };

      if (e.isDir && !e.isLink) {
        stats.dirs++;
        const sub = path.join(hostDir, e.name);
        fs.mkdirSync(sub, { recursive: true });
        const node = { ...base, type: "dir", children: [] };
        tick(false);
        node.children = walk(e.bd, fosPath, sub, depth + 1);
        children.push(node);
      } else if (e.isLink) {
        stats.links++;
        // On ne suit pas les liens (évite les boucles) ; noté dans le manifeste.
        children.push({ ...base, type: "link", children: [] });
      } else {
        stats.files++;
        stats.bytes += e.size;
        const bytes = getFileBytes(h, e.bd);
        fs.writeFileSync(path.join(hostDir, e.name), bytes);
        children.push({ ...base, type: "file" });
        tick(false);
      }
    }
    return children;
  };

  const tree = walk(SYSLIST, "", treeDir, 0);
  tick(true);

  const manifest = {
    image: path.resolve(h.path),
    image_size: h.size,
    disk_name: diskName(h),
    stats,
    // Bloc conservé pour la compatibilité de forme avec extract_di.py. Le portage
    // JS écrit chaque fichier directement (y compris vides et noms en « . »), donc
    // pas de « passe de réparation » : la sortie est fidèle par construction.
    binary_dump: { engine: "fosfat.js", ok: tree.length, failed: [] },
    tree,
  };
  fs.writeFileSync(
    path.join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
  return manifest;
}

// Raccourci : ouvre une image et l'extrait vers outDir.
function extractImage(diPath, outDir, onProgress) {
  const h = openImage(diPath);
  return extract(h, outDir, onProgress);
}

module.exports = {
  openImage,
  extract,
  extractImage,
  diskName,
  // exports internes utiles aux tests
  _internal: { c2l, bcd2int, y2k, fosDate, smakyExt },
};

// --- Exécution en ligne de commande (pour validation) -------------------------
//   node viewer/fosfat.js <image.di> <outDir>
if (require.main === module) {
  const [, , img, out] = process.argv;
  if (!img || !out) {
    console.error("Usage: node fosfat.js <image.di> <outDir>");
    process.exit(2);
  }
  const t0 = Date.now();
  const m = extractImage(img, out, (p) => {
    process.stderr.write(
      `\r  ... ${p.dirs} dossiers, ${p.files} fichiers, ${p.bytes} octets   `
    );
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  process.stderr.write("\n");
  console.error(
    `== Terminé en ${dt}s : ${m.stats.dirs} dossiers, ${m.stats.files} fichiers, ` +
      `${m.stats.links} liens, ${m.stats.bytes} octets — disque « ${m.disk_name} » ==`
  );
}
