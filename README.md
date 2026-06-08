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
| 2c | Visualiseur de dessins vectoriels `.PLAN` ; Typo enrichi (gras/italique, figures) | ✅ fait — `viewer/renderer/decoders/smakyplan.js` |
| 3 | Livrables pour la recherche (rapports, exports) | à venir |

L'analyse interactive se fait dans une application **Electron** (`viewer/`) : navigation
(arbre + visualiseur), recherche plein-texte et par nom, rapports, et visualiseurs de
formats Smaky décodés à la volée :

- **texte** (jeu de caractères Smaky) ;
- **images** `.IMAGE` / `.COLOR` ;
- **Typo** (composition typographique) en *Lecture* / *Source* / côte à côte —
  voir [docs/typo-format.md](docs/typo-format.md) ;
- **dessins vectoriels `.PLAN`** rendus en SVG — voir [docs/plan-format.md](docs/plan-format.md).

## Télécharger l'application (versions prêtes à l'emploi)

Pas besoin de compiler quoi que ce soit : les exécutables des trois systèmes sont
publiés sur la **page des _Releases_ du dépôt**, téléchargeables **sans compte
GitHub** :

**➡️ <https://github.com/SMUG-2-0/Navigateur-Smaky/releases/latest>**

| Système | Fichier à télécharger |
|---------|-----------------------|
| **macOS** (Intel + Apple Silicon) | `…-universal.dmg` |
| **Windows** — installateur | `…Setup….exe` |
| **Windows** — portable (sans installation) | `….exe` (celui **sans** « Setup ») |
| **Linux** — universel | `….AppImage` |
| **Linux** — Debian / Ubuntu / Zorin / Mint | `…_amd64.deb` |
| **Linux** — archive | `….tar.gz` |

> ⚠️ **Premier lancement.** Les binaires ne sont **pas signés** (pas de compte
> payant Apple/Microsoft) : le système affiche un avertissement, c'est normal.
>
> - **macOS** : clic droit sur l'app → **Ouvrir** → confirmer (une seule fois) ;
> - **Windows** : écran « Windows a protégé votre ordinateur » →
>   **Informations complémentaires** → **Exécuter quand même** ;
> - **Linux** : rendre l'AppImage exécutable (`chmod +x`), voir la section Linux plus bas.
>
> Détails par système : voir « Builds automatiques » et « Installer / lancer sous
> Linux » ci-dessous.

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

### Builds automatiques multi-plateformes (GitHub Actions)

Le workflow [`.github/workflows/build.yml`](.github/workflows/build.yml) construit les
**trois** systèmes (macOS, Windows, Linux) sur les runners gratuits de GitHub, puis
rassemble tous les binaires dans **une seule Release**. Aucune machine Mac/Windows/Linux
n'est donc nécessaire en local.

- **manuel** : onglet **Actions** → **Build** → **Run workflow** ; les fichiers sont
  téléchargeables en bas du run (section *Artifacts*) — ⚠️ visibles **uniquement si vous
  êtes connecté à GitHub**, et ils expirent après quelques semaines ;
- **sur tag** : pousser un tag `vX.Y.Z` construit tout **et** crée une *Release*
  **publique** (téléchargeable **sans compte**) — la voie à privilégier pour partager :
  ```bash
  # après avoir mis à jour "version" dans viewer/package.json
  git commit -am "vX.Y.Z : ..."
  git tag -a vX.Y.Z -m "vX.Y.Z"
  git push origin main && git push origin vX.Y.Z
  ```

> **Artifacts vs Releases.** Les *Artifacts* d'un run ne sont accessibles qu'aux
> personnes **connectées** à GitHub et expirent ; les *Releases* (créées par un tag)
> sont **publiques** et permanentes. Pour diffuser l'application, utilisez toujours la
> page *Releases*.

#### Premier lancement : binaires non signés

Faute de certificat payant, les exécutables ne sont pas signés ; chaque système
affiche un avertissement au premier lancement.

- **macOS** — le `.dmg` est **universel** (Intel + Apple Silicon). macOS bloque l'app
  (« développeur non identifié », voire « endommagée » sur Apple Silicon) :
  - **clic droit** sur l'app → **Ouvrir** → confirmer (à faire **une seule fois**) ; ou
  - en Terminal : `xattr -dr com.apple.quarantine "/Applications/Navigateur Smaky.app"`.
  - *(Pour supprimer tout avertissement, il faudrait signer et notariser l'app avec un
    compte Apple Developer — 99 $/an, non nécessaire pour un usage interne.)*
- **Windows** — Microsoft Defender SmartScreen affiche « Windows a protégé votre
  ordinateur » : cliquer **Informations complémentaires** → **Exécuter quand même**
  (idem pour l'installateur `Setup` et la version portable).
- **Linux** — pas de signature à gérer ; il suffit de rendre l'AppImage exécutable
  (voir ci-dessous).

### Installer / lancer sous Linux (ex. Zorin OS, GNOME)

Trois formats sont produits ; choisis selon l'usage.

| Format | Pour qui | Intégration au menu | Multi-distribution |
|--------|----------|---------------------|--------------------|
| **AppImage** | tout le monde, « ça marche » | non (sauf script ci-dessous) | ✅ oui |
| **.deb** | Debian / Ubuntu / Zorin / Mint | ✅ automatique | ❌ non |
| **tar.gz** | usage technique, archivage | non | ✅ oui |

- **AppImage** — un seul fichier portable, aucune installation ni droits root :
  ```bash
  chmod +x Navigateur.Smaky-0.4.0.AppImage
  ./Navigateur.Smaky-0.4.0.AppImage
  ```
  Si le lancement échoue faute de FUSE : `sudo apt install libfuse2`, ou ajouter
  l'option `--appimage-extract-and-run`.

- **.deb** — installation intégrée (menu, icône, désinstallation propre) sur les
  distributions à base Debian :
  ```bash
  sudo apt install ./smaky-viewer_0.4.0_amd64.deb   # ou double-clic
  sudo apt remove smaky-viewer                       # désinstallation
  ```

- **tar.gz** — simple archive : extraire, puis exécuter le binaire `smaky-viewer`
  du dossier obtenu. Aucune intégration au système.

- **Depuis les sources** (le plus simple pour un test rapide) : dans `viewer/`,
  `npm install` puis `npm start`.

#### Ajouter un lanceur au menu (AppImage)

L'AppImage n'apparaît pas d'elle-même dans le menu des applications. Le script
[`viewer/install-desktop-linux.sh`](viewer/install-desktop-linux.sh) crée l'entrée
de menu et installe l'icône, au niveau utilisateur (sans sudo) :

```bash
cd viewer
./install-desktop-linux.sh                 # détecte l'AppImage dans dist/
./install-desktop-linux.sh /chemin/App.AppImage   # ou chemin explicite
./install-desktop-linux.sh --uninstall     # retire le lanceur
```

Il écrit `~/.local/share/applications/smaky-viewer.desktop` et copie l'icône dans
`~/.local/share/icons/`. Cherche ensuite « Navigateur Smaky » dans le menu (au
besoin, ferme/rouvre la session pour rafraîchir le cache d'icônes).

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
  build/             icône de l'application (icon.svg source + icon.png)
  install-desktop-linux.sh   crée un lanceur GNOME/freedesktop (AppImage)
docs/
  extraction-phase1.md   mode d'emploi détaillé de la phase 1
  format-typo.md         notes sur le format de composition Typo
README.md
.gitignore
```
