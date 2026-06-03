# Analyse de disques Smaky (FOS)

Outils pour **extraire et analyser le contenu d'images de disques Smaky** au format
propriétaire FOS, dans le cadre du mandat de préservation du patrimoine Smaky
confié par Epsitec SA.

Les disques Smaky (ordinateurs suisses, ici fin des années 1990) utilisent le
système de fichiers FOS. Le projet [FOSfat](https://github.com/Skywalker13/Fosfat)
(développé chez Epsitec) fournit un accès **en lecture seule** à ces disques.
Ce dépôt ajoute, par-dessus FOSfat, une chaîne d'outils Python pour extraire une
image vers un dossier ordinaire, puis l'analyser.

> ⚠️ **Confidentialité.** Les images disque (`.DI`) et tout ce qui en est extrait
> sont des **données privées** sous autorisation restreinte. Elles ne sont **pas**
> versionnées (voir `.gitignore`) et ne doivent pas être diffusées. Ce dépôt ne
> contient que des **outils** et de la **documentation**.

## Approche

Plutôt que d'appeler FOSfat (en C) depuis Python, on procède en deux temps :

1. **Extraction** : une image `.DI` est transformée **une seule fois** en un dossier
   sur le PC — copie binaire fidèle de l'arborescence et des fichiers, accompagnée
   d'un `manifest.json` décrivant toutes les métadonnées FOS.
2. **Analyse** : des programmes **Python** travaillent ensuite sur ce dossier
   (fichiers ordinaires + manifeste), sans plus jamais toucher au C.

Cette séparation isole la partie fragile (lecture du format FOS) dans une étape
unique, rend le dump réutilisable et archivable, et permet de développer toute
l'analyse en Python pur — réutilisable pour les futures images.

```
image .DI ──[ FOSfat / extract_di.py ]──► dossier (tree/ + manifest.json) ──[ Python ]──► analyses
   (C, lecture seule, dans WSL)               (artefact d'archive)            (natif Windows)
```

## État des phases

| Phase | Description | État |
|-------|-------------|------|
| 0 | Compiler FOSfat, valider la lecture de l'image | ✅ fait |
| 1 | Extraction `.DI` → `tree/` + `manifest.json` | ✅ fait — voir [docs/extraction-phase1.md](docs/extraction-phase1.md) |
| 2 | Navigateur/visualiseur interactif (Electron) | 🚧 en cours — voir [`viewer/`](viewer/) |
| 3 | Livrables pour la recherche (rapports, exports) | à venir |

L'analyse interactive se fait dans une application **Electron** (`viewer/`) : interface
de navigation (arbre + visualiseur), génération de rapports, et visualiseurs de
formats Smaky décodés à la volée (texte ; format Typo — voir
[docs/format-typo.md](docs/format-typo.md)).

## Démarrage rapide

Voir le mode d'emploi complet : **[docs/extraction-phase1.md](docs/extraction-phase1.md)**.

En résumé, dans WSL (où FOSfat est compilé) :

```bash
cd /mnt/d/Dropbox/35-Prof/epsitec/Analyse_DI
python3 tools/extract_di.py ALPINE.DI ALPINE_extracted   # extraction complète
python3 tools/verify_extract.py ALPINE_extracted          # contrôle d'intégrité
```

## L'application (viewer/)

Application Electron (Node.js). Lancement :

```bash
cd viewer
npm install      # la première fois
npm start
```

Puis « Ouvrir un dossier extrait… » et choisir le dossier produit en phase 1
(celui qui contient `manifest.json` et `tree/`).

## Construire des exécutables (distribution)

Depuis `viewer/`, avec [electron-builder](https://www.electron.build/) :

```bash
npm run dist:win        # Windows : installateur NSIS + version portable
npm run dist:linux      # Linux : AppImage + .deb + tar.gz  (à lancer SOUS Linux)
npm run dist:linux:tar  # Linux : tar.gz seul  (constructible aussi sous Windows)
npm run dist:mac        # macOS : .dmg  (à lancer sous macOS uniquement)
```

Les artefacts sont produits dans `viewer/dist/` (ignoré par git).

**Important — contrainte de plateforme.** Chaque format se construit sur le système
correspondant :

- l'**AppImage** et le **.deb** nécessitent des outils Linux (`mksquashfs`, `dpkg`) :
  ils ne se construisent **pas** sous Windows (l'étape échoue après `linux-unpacked`).
  Construis-les **sous Linux** (machine Linux ou **WSL** : installer Node, p. ex. via
  `nvm`, puis `npm install` et `npm run dist:linux`) ;
- le **`tar.gz`** ne fait qu'archiver l'application : il se construit **partout**, y
  compris sous Windows (`npm run dist:linux:tar`) ;
- **macOS** est requis pour produire une version Mac.

### Tester / lancer sous Linux (ex. Zorin OS, GNOME)

- **AppImage** : `chmod +x "Navigateur Smaky-0.1.0.AppImage"` puis double-clic (ou
  `./Navigateur\ Smaky-0.1.0.AppImage`). Si le lancement échoue faute de FUSE :
  `sudo apt install libfuse2`, ou lancer avec `--appimage-extract-and-run`.
- **tar.gz** : extraire l'archive, puis exécuter le binaire `smaky-viewer` du dossier.
- **Depuis les sources** (le plus simple pour un test) : copier le dossier `viewer/`,
  puis `npm install` et `npm start`.

## Licence

Logiciel libre sous **GNU General Public License v3** — voir [LICENSE](LICENSE).
© 2026 Epsitec SA et Pierre-Yves Rochat. S'appuie sur FOSfat / libfosgra
(Mathieu Schroeter, Epsitec SA), également sous GPL v3.

## Contenu du dépôt

```
tools/
  extract_di.py      extraction .DI → dossier (+ manifest.json)
  verify_extract.py  contrôle d'intégrité (manifeste vs fichiers extraits)
viewer/              application Electron (navigateur, rapports, visualiseurs)
  main.js, preload.js, package.json
  renderer/          interface (HTML/CSS/JS) + décodeurs de formats Smaky
docs/
  extraction-phase1.md   mode d'emploi détaillé de la phase 1
  format-typo.md         notes sur le format de composition Typo
README.md
.gitignore
```
