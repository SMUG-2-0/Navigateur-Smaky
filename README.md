# Analyse de disques Smaky (FOS)

Outils pour **extraire et analyser le contenu d'images de disques Smaky** au format
propriétaire FOS, dans le cadre du mandat de préservation du patrimoine Smaky
confié par Epsitec SA.

Les disques Smaky (ordinateurs suisses, ici fin des années 1990) utilisent le
système de fichiers FOS. Le projet [FOSfat](https://github.com/Skywalker13/Fosfat)
(développé chez Epsitec) fournit un accès **en lecture seule** à ces disques.

L'application **Navigateur Smaky** (`viewer/`) ouvre désormais une image `.DI`
**directement**, sans aucune dépendance externe : la lecture du format FOS y est
portée en JavaScript (portage de `libfosfat`). C'est la voie recommandée — il suffit
de l'installer et d'ouvrir l'image. Une chaîne d'outils Python historique
(`tools/extract_di.py`, s'appuyant sur le binaire natif de FOSfat sous WSL) reste
disponible comme voie avancée / de référence.

> ⚠️ **Confidentialité.** Les images disque (`.DI`) et tout ce qui en est extrait
> sont des **données privées** sous autorisation restreinte. Elles ne sont **pas**
> versionnées (voir `.gitignore`) et ne doivent pas être diffusées. Ce dépôt ne
> contient que des **outils** et de la **documentation**.

## Approche

Une image `.DI` est transformée **une seule fois** en un dossier sur le PC — copie
binaire fidèle de l'arborescence et des fichiers, accompagnée d'un `manifest.json`
décrivant toutes les métadonnées FOS. L'analyse interactive travaille ensuite sur ce
dossier (fichiers ordinaires + manifeste).

Cette extraction est faite **directement par l'application** (lecture du format FOS
portée en JavaScript) — aucun outil externe requis :

```
image .DI ──[ Navigateur Smaky (JS) ]──► dossier (tree/ + manifest.json) ──► navigation / analyse
   (lecture seule)                            (artefact d'archive)
```

> **Voie héritée (avancée).** Le même dossier peut aussi être produit par
> `tools/extract_di.py`, qui pilote le binaire natif `fosread` de FOSfat **sous WSL**.
> C'est la chaîne d'origine, qui a servi de **référence de validation** au portage JS
> (sortie identique au fichier près). Voir [docs/extraction-phase1.md](docs/extraction-phase1.md).

## État des phases

| Phase | Description | État |
|-------|-------------|------|
| 0 | Compiler FOSfat, valider la lecture de l'image | ✅ fait |
| 1 | Extraction `.DI` → `tree/` + `manifest.json` (chaîne Python/WSL de référence) | ✅ fait — voir [docs/extraction-phase1.md](docs/extraction-phase1.md) |
| 2 | Navigateur/visualiseur interactif (Electron) | ✅ fait — voir [`viewer/`](viewer/) |
| 2b | Lecture FOS portée en JS : ouvrir un `.DI` **directement** dans l'app | ✅ fait — `viewer/fosfat.js` |
| 3 | Livrables pour la recherche (rapports, exports) | à venir |

L'analyse interactive se fait dans une application **Electron** (`viewer/`) : interface
de navigation (arbre + visualiseur), génération de rapports, et visualiseurs de
formats Smaky décodés à la volée (texte ; format Typo — voir
[docs/format-typo.md](docs/format-typo.md)).

## Démarrage rapide

Application Electron (Node.js) :

```bash
cd viewer
npm install      # la première fois
npm start
```

Puis **« 💿 Ouvrir une image .DI… »** et choisir une image disque Smaky : l'application
la lit elle-même, l'extrait dans un dossier `«nom»_extracted` et affiche
l'arborescence. (Le bouton **« 📂 Ouvrir un dossier extrait… »** reste disponible pour
un dossier déjà produit, contenant `manifest.json` et `tree/`.)

> **Voie héritée (Python/WSL).** Pour produire le dossier d'extraction sans l'app — ou
> pour revalider le portage — voir le mode d'emploi complet
> **[docs/extraction-phase1.md](docs/extraction-phase1.md)**. En résumé, dans WSL (où
> FOSfat est compilé) :
>
> ```bash
> cd /mnt/d/Dropbox/35-Prof/epsitec/Analyse_DI
> python3 tools/extract_di.py ALPINE.DI ALPINE_extracted   # extraction complète
> python3 tools/verify_extract.py ALPINE_extracted          # contrôle d'intégrité
> ```

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
- **macOS** est requis par `electron-builder` pour produire un `.dmg` en local. Sans
  Mac, on le construit **dans le nuage** via GitHub Actions (voir ci-dessous).

### Construire la version macOS sans Mac (GitHub Actions)

Le workflow [`.github/workflows/build-macos.yml`](.github/workflows/build-macos.yml)
construit le `.dmg` sur un runner macOS gratuit de GitHub :

- **manuel** : onglet **Actions** → **Build macOS** → **Run workflow** ; le `.dmg` est
  téléchargeable en bas du run (section *Artifacts*) ;
- **sur tag** : pousser un tag `vX.Y.Z` (`git tag v0.1.0 && git push origin v0.1.0`)
  construit le `.dmg` **et** crée une *Release* avec le fichier attaché.

Le `.dmg` est **universel** (Intel + Apple Silicon) mais **non signé** (pas de compte
Apple Developer). Au premier lancement, macOS bloque l'app (« développeur non
identifié », voire « endommagée » sur Apple Silicon). Pour l'ouvrir :

- **clic droit** sur l'app → **Ouvrir** → confirmer (à faire **une seule fois**) ; ou
- en Terminal : `xattr -dr com.apple.quarantine "/Applications/Navigateur Smaky.app"`.

Pour supprimer tout avertissement, il faudrait signer et *notariser* l'app avec un
compte Apple Developer (99 $/an) — non nécessaire pour un usage interne.

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
  fosfat.js          lecture du format FOS en JS (ouverture directe des .DI)
  extract-worker.js  extraction dans un thread (interface réactive + progression)
  renderer/          interface (HTML/CSS/JS) + décodeurs de formats Smaky
docs/
  extraction-phase1.md   mode d'emploi détaillé de la phase 1
  format-typo.md         notes sur le format de composition Typo
README.md
.gitignore
```
