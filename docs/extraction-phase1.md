# Phase 1 — Extraction d'une image `.DI` vers un dossier

> **Note.** L'application **Navigateur Smaky** ouvre désormais une image `.DI`
> **directement** (bouton « 💿 Ouvrir une image .DI… »), sans WSL ni Python : la
> lecture du format FOS y est portée en JavaScript (`viewer/fosfat.js`). C'est la
> voie recommandée. Le présent document décrit la **chaîne d'origine** (Python +
> binaire natif FOSfat sous WSL), conservée comme voie avancée et comme **référence
> de validation** : le portage JS produit une sortie identique au fichier près.

Mode d'emploi complet de l'extraction d'une image disque Smaky (FOS) vers un
dossier ordinaire du PC, avec préservation des métadonnées.

- [1. Principe](#1-principe)
- [2. Prérequis et installation](#2-prérequis-et-installation)
- [3. Utilisation de `extract_di.py`](#3-utilisation-de-extract_dipy)
- [4. Structure de la sortie](#4-structure-de-la-sortie)
- [5. Le fichier `manifest.json`](#5-le-fichier-manifestjson)
- [6. Vérification de l'intégrité](#6-vérification-de-lintégrité)
- [7. Particularités du format FOS gérées](#7-particularités-du-format-fos-gérées)
- [8. Extraire une nouvelle image](#8-extraire-une-nouvelle-image)
- [9. Dépannage](#9-dépannage)

---

## 1. Principe

`extract_di.py` pilote l'outil `fosread` de [FOSfat](https://github.com/Skywalker13/Fosfat)
pour produire, à partir d'une image `.DI` :

- `tree/` — copie **binaire fidèle** de l'arborescence et des fichiers (aucune
  conversion : les octets sont ceux du disque Smaky) ;
- `manifest.json` — toutes les **métadonnées FOS** (type, attributs, dates, taille)
  que le simple dépôt de fichiers sur le système hôte perdrait.

L'image source n'est **jamais modifiée** (FOSfat est en lecture seule).

Le script fait deux passes :

1. **Parcours** (`fosread list`, récursif) : construit l'arbre + le manifeste.
2. **Dump binaire** (`fosread get`, récursif) : un appel par entrée racine, suivi
   d'une **passe de réparation** (voir [§7](#7-particularités-du-format-fos-gérées)).

---

## 2. Prérequis et installation

L'extraction s'exécute sous **WSL** (Linux sur Windows), car FOSfat est conçu pour
des systèmes POSIX. L'image et le dossier de sortie restent accessibles côté
Windows via `/mnt/<lettre>/...`.

### 2.1 WSL

WSL 2 avec une distribution Ubuntu (testé : Ubuntu 24.04). Vérifier depuis PowerShell :

```powershell
wsl.exe -l -v
```

### 2.2 Chaîne de compilation et dépendances (dans WSL)

```bash
sudo apt update
sudo apt install -y build-essential autoconf automake libtool pkg-config libfuse3-dev git
```

### 2.3 Compiler FOSfat (dans WSL)

On compile FOSfat dans le **home Linux** (`~`), pas sur `/mnt/...`, pour éviter les
soucis d'autotools sur le système de fichiers Windows :

```bash
cd ~
git clone --depth 1 https://github.com/Skywalker13/Fosfat.git
cd Fosfat
./configure
make -j$(nproc)
```

Les binaires et bibliothèques restent dans l'arborescence de compilation
(pas de `make install`) :

- outil : `~/Fosfat/tools/fosread`
- bibliothèques : `~/Fosfat/libfosfat/`, `~/Fosfat/libfosgra/`

Comme FOSfat n'est pas installé au niveau système, il faut indiquer où trouver les
bibliothèques partagées via `LD_LIBRARY_PATH`. **`extract_di.py` s'en charge
automatiquement** ; pour appeler `fosread` à la main :

```bash
export LD_LIBRARY_PATH=~/Fosfat/libfosfat:~/Fosfat/libfosgra
~/Fosfat/tools/fosread <image.di> list /
```

### 2.4 Python

Python 3 (présent par défaut sur Ubuntu). Le script n'utilise que la bibliothèque
standard — aucune dépendance à installer.

---

## 3. Utilisation de `extract_di.py`

```
python3 tools/extract_di.py IMAGE OUTDIR [options]
```

| Argument / option | Rôle |
|---|---|
| `IMAGE` | chemin de l'image `.DI` |
| `OUTDIR` | dossier de sortie (contiendra `tree/` et `manifest.json`) |
| `--manifest-only` | ne construit **que** le manifeste (pas de dump binaire) — utile pour mesurer l'ampleur du travail avant l'extraction complète |
| `--dump-only` | réutilise un `manifest.json` existant ; ne fait **que** le dump binaire + réparation |
| `--fosread CHEMIN` | chemin du binaire `fosread` (défaut : `~/Fosfat/tools/fosread`) |
| `--lib DOSSIER` | dossier de bibliothèque `.so` (répétable ; défauts : `~/Fosfat/libfosfat`, `~/Fosfat/libfosgra`) |

### Exemples

Extraction complète (parcours + dump + réparation) :

```bash
cd /mnt/d/Dropbox/35-Prof/epsitec/Analyse_DI
python3 tools/extract_di.py ALPINE.DI ALPINE_extracted
```

Mesurer d'abord (rapide à décider, écrit seulement le manifeste) :

```bash
python3 tools/extract_di.py ALPINE.DI ALPINE_extracted --manifest-only
# => affiche : nb de dossiers, fichiers, octets
```

Refaire seulement le dump binaire après un `--manifest-only` :

```bash
python3 tools/extract_di.py ALPINE.DI ALPINE_extracted --dump-only
```

> **Performance.** Chaque appel à `fosread` rouvre l'image (~0,7 s). Le dump fait
> donc **un seul `get` récursif par entrée racine** (et non un par fichier). Le
> facteur lent reste l'écriture de dizaines de milliers de petits fichiers ;
> écrire sur un disque local (hors dossier synchronisé) est plus rapide.

---

## 4. Structure de la sortie

```
OUTDIR/
├── tree/            arborescence Smaky reconstituée (copie binaire fidèle)
│   ├── <dossier>/…
│   └── <fichier.ext>
└── manifest.json    métadonnées FOS complètes
```

Les noms de fichiers/dossiers sont conservés tels quels (Smaky utilise `.` ou `!`
comme séparateur d'extension, d'où des noms comme `arbre!pas` ou `fmm10!typo`).

---

## 5. Le fichier `manifest.json`

Structure générale :

```jsonc
{
  "image": "/chemin/absolu/ALPINE.DI",
  "image_size": 576716800,
  "stats": { "dirs": 391, "files": 33536, "links": 0, "bytes": 381469309 },
  "binary_dump": {
    "ok": 63,                 // entrées racine extraites sans erreur
    "failed": [],             // échecs éventuels du dump récursif
    "repair": {               // passe de réparation (voir §7)
      "touched_empty": 269,   // fichiers vides matérialisés
      "reextracted": 2,       // fichiers ré-extraits nommément (ex. dotfiles)
      "failed": []
    }
  },
  "tree": [ /* arbre des nœuds, voir ci-dessous */ ]
}
```

Chaque **nœud** de `tree` :

```jsonc
{
  "fos_path": "systeme/efs/iso9660.efs",  // chemin FOS depuis la racine
  "name": "iso9660.efs",
  "type": "file",                          // "dir" | "file" | "link"
  "size": 19872,                           // octets (0 pour les dossiers/fichiers vides)
  "hidden": false,                         // attribut FOS « caché »
  "encoded": false,                        // attribut FOS « encodé »
  "smaky_ext": "efs",                      // extension (après le dernier . ou !), minuscule
  "created": "1996-01-08 19:27",           // date de création  (""=date nulle)
  "changed": "2022-02-04 05:44",           // dernière modification
  "viewed":  "2022-02-04 05:44",           // dernier accès
  "children": [ /* sous-nœuds, uniquement pour les dossiers */ ]
}
```

Les trois dates proviennent directement de FOS. Une valeur vide (`""`) correspond à
une date nulle dans le système de fichiers (`2000-00-00` ou mois/jour à `00`).

> **Lecture côté Python (Windows).** `manifest.json` est en UTF-8. Le chemin hôte
> d'un fichier s'obtient en joignant `OUTDIR/tree/` aux composants de `fos_path`.

---

## 6. Vérification de l'intégrité

```bash
python3 tools/verify_extract.py OUTDIR
```

Le script compare le manifeste aux fichiers réellement présents sur le disque et
indique :

- le nombre de fichiers présents vs manquants ;
- pour les manquants : combien sont encodés / de taille 0 / à nom non‑ASCII ;
- les éventuels doublons de noms dans un même dossier ;
- les premiers fichiers manquants.

Après une extraction réussie, on attend **0 manquant** (sur ALPINE.DI : 33 536/33 536).

---

## 7. Particularités du format FOS gérées

Le `fosread get` récursif présente deux comportements à corriger ; `extract_di.py`
le fait automatiquement dans sa **passe de réparation** (après le dump), à partir
du manifeste :

1. **Fichiers de taille 0 non matérialisés.** `fosread` n'écrit pas les fichiers
   vides. La réparation les recrée vides (`touch`) pour que l'arbre soit fidèle.
2. **Noms commençant par `.` ignorés.** Lors du parcours récursif, `fosread` saute
   les entrées dont le nom commence par un point (ex. `cn/.text`, `l/.mat`), les
   confondant avec l'entrée « . ». La réparation les ré-extrait **nommément** via
   `fosread get <chemin> <destination>`.

Autres points :

- **Jeu de caractères Smaky.** Le contenu texte n'est **pas** de l'ASCII/UTF-8 :
  Smaky a son propre encodage (p. ex. l'octet `0x12` code « é »), et la fin de
  ligne est un retour chariot `CR` (`0x0d`). Le dump conserve ces octets bruts ;
  la conversion en UTF-8 se fera à la **phase 2** (en s'inspirant de
  `fosfat_sma2iso8859` / l'outil `smascii` de FOSfat).
- **Liens.** Les liens FOS ne sont pas suivis (évite les boucles) ; ils sont notés
  dans le manifeste avec `"type": "link"`.

---

## 8. Extraire une nouvelle image

La chaîne est générique. Pour une autre image `XYZ.DI` :

```bash
cd /mnt/<lettre>/.../dossier_du_projet
python3 tools/extract_di.py XYZ.DI XYZ_extracted
python3 tools/verify_extract.py XYZ_extracted
```

Le type de disque (disque dur / disquette) est **autodétecté** par `fosread`.
Rappel : les dossiers `*_extracted/` et les fichiers `*.DI` sont exclus de git.

---

## 9. Dépannage

| Symptôme | Cause / solution |
|---|---|
| `error while loading shared libraries: libfosfat.so.2` | `LD_LIBRARY_PATH` non défini. `extract_di.py` le gère ; en appel manuel, exporter le chemin (voir §2.3). |
| `fosread introuvable` | passer `--fosread ~/Fosfat/tools/fosread` ou recompiler FOSfat (§2.3). |
| `Image introuvable` | vérifier le chemin de l'image (depuis WSL, c'est `/mnt/<lettre>/...`). |
| Extraction très lente | écriture de milliers de petits fichiers, surtout sur un dossier synchronisé (Dropbox) ou sur `/mnt/...` (DrvFs). Extraire sur un disque local accélère nettement. |
| `verify_extract.py` signale des manquants non vides | relancer avec `--dump-only` (qui inclut la réparation), ou extraire le fichier nommément avec `fosread get <chemin> <dest>`. |
