# Aide — Navigateur Smaky

Cet outil permet d'explorer le contenu d'un disque Smaky (format FOS). Il affiche
l'arborescence, visualise les fichiers (textes, images, format Typo…) et permet de
filtrer et de rechercher.

## Ouvrir un disque

Deux façons d'ouvrir un disque :

- **« 💿 Ouvrir une image .DI… »** — le plus simple : choisis directement une image
  disque Smaky (fichier `.DI`). L'outil la lit lui-même et l'extrait dans un dossier
  `«nom»_extracted` (il te demande où le créer). Une barre de progression s'affiche ;
  pour un gros disque dur, compter quelques dizaines de secondes. Aucune installation
  supplémentaire n'est nécessaire — ni WSL, ni Python.
- **« 📂 Ouvrir un dossier extrait… »** — si le disque a **déjà** été extrait : choisis
  le dossier produit (celui qui contient `manifest.json` et un sous-dossier `tree/`).

Dans les deux cas, l'arborescence apparaît ensuite à gauche.

> L'image `.DI` d'origine n'est **jamais modifiée** : l'outil la lit en lecture seule.
> Conseil : pour aller plus vite, crée le dossier d'extraction sur un disque local
> plutôt que dans un dossier synchronisé (Dropbox, OneDrive…).

Le programme **mémorise le dernier dossier ouvert** et le **rouvre automatiquement**
au prochain démarrage.

## Naviguer dans l'arborescence

- Clique un **dossier** pour le déplier / replier.
- Clique un **fichier** pour l'afficher à droite, avec ses informations (taille,
  type, dates de création / modification / dernier accès).

## Visualiser un fichier

Selon le type de fichier, des modes d'affichage apparaissent en haut du volet de
droite :

- **Texte** : le contenu décodé (jeu de caractères Smaky, accents corrects).
- **Hexa** : les octets bruts, utile pour les fichiers binaires.
- **Image** : pour les fichiers `.image` (noir/blanc) et `.color` (couleur), avec
  des boutons de zoom **×1 ×2 ×4 ×8**.
- **Lecture** / **Source** / **Source + Lecture** : pour les fichiers **Typo**
  (composition typographique). *Lecture* reconstruit la structure (titres, sections
  numérotées, listes, paragraphes) et masque les commandes ; *Source* montre le texte
  avec les commandes `\…` mises en évidence ; *Source + Lecture* affiche les deux
  **côte à côte**, avec une séparation **ajustable** (glisse la poignée centrale) —
  idéal pour comprendre quelle commande produit quel effet. Les **images** référencées
  par `\image` sont affichées directement dans la Lecture lorsque le fichier est présent.
- **Fichiers associés** : pour les fichiers `nom!type` (manifestes Smaky qui listent les
  fichiers d'un même ensemble, gérés jadis par le programme *Start*). La liste s'affiche,
  et chaque nom est **cliquable** pour ouvrir le fichier lié.

## Filtrer par type de fichier

Le bouton **« Tous les types ▾ »** ouvre un panneau listant toutes les extensions
présentes, avec leur nombre de fichiers :

- coche une ou plusieurs extensions ;
- choisis **« N'afficher que »** (ne garder que ces types) ou **« Masquer »**
  (cacher ces types) ;
- la case **« Alphabétique »** trie la liste par ordre alphabétique (sinon par
  nombre de fichiers) — pratique pour retrouver une extension rare ;
- le champ de recherche du panneau filtre la liste des extensions.

L'arborescence se met à jour : seuls les dossiers contenant des fichiers
correspondants restent affichés.

Les fichiers d'association `nom!type` apparaissent sous une catégorie distincte
préfixée d'un **`!`** (`!typo`, `!code`…), en tête de liste : cocher « typo » ne
sélectionne donc **pas** les `!typo`.

## Rechercher dans les textes

Tape un mot dans le champ **« Recherche dans les textes »** et clique
**« Rechercher »** (ou appuie sur **Entrée**). Le volet gauche bascule sur
**« Résultats »** : la liste des fichiers contenant ce mot, avec le nombre
d'occurrences et un extrait. Clique un résultat pour ouvrir le fichier ; les
correspondances sont **surlignées**.

Par défaut, la recherche est **insensible à la casse et aux accents** : taper
`reseau` trouve aussi « Réseau » et « réseaux ». L'onglet **« Arborescence »**
ramène à l'arbre.

Deux cases à cocher, sous le champ :

- **« Respecter la casse »** : distingue majuscules et minuscules ;
- **« Expression régulière »** : active les **regex** (voir ci-dessous).

## Les expressions régulières (regex)

Les expressions régulières sont un moyen puissant de décrire un **motif** plutôt
qu'un mot exact. Inutile au début — mais dès qu'on cherche quelque chose de
variable (un numéro, une date, plusieurs orthographes…), elles font gagner un
temps précieux. Active le bouton **`.*`** pour les utiliser.

Quelques briques de base :

- `.` : n'importe quel caractère
- `*` : l'élément précédent, répété 0 fois ou plus
- `+` : l'élément précédent, répété 1 fois ou plus
- `?` : l'élément précédent, optionnel
- `\d` : un chiffre — `\d{3}` : exactement trois chiffres
- `\w` : une lettre, un chiffre ou `_`
- `[abc]` : l'un des caractères a, b ou c — `[ée]` : é ou e
- `motA|motB` : motA **ou** motB
- `^` : début de ligne — `$` : fin de ligne

Exemples utiles sur ces disques :

- `cr[ée]sus` : trouve « crésus » comme « cresus »
- `facture|devis` : les fichiers parlant de facture **ou** de devis
- `19\d\d` : une année des années 1900 (1991, 1997…)
- `\d{3}[ .\-]\d{2}` : un nombre du type « 199 160 » ou « 199-160 »
- `comptab\w*` : « comptab » suivi de lettres (comptable, comptabilité…)
- `^Concerne` : les lignes qui commencent par « Concerne »

N'hésite pas à expérimenter : si l'expression est invalide, l'outil te le signale
sans rien casser.

## Rechercher dans le fichier affiché (Ctrl-F)

Pour chercher **à l'intérieur du fichier ouvert**, appuie sur **Ctrl-F** (Cmd-F sur
Mac). Une petite barre apparaît en haut à droite du visualiseur : tape ton texte,
toutes les occurrences sont surlignées et la courante apparaît en **vidéo inverse**.

- **Entrée** : occurrence suivante — **Maj+Entrée** : précédente (ou les flèches ▲ ▼) ;
- un compteur indique « position / total » ;
- **Échap** (ou ✕) ferme la barre.

À ne pas confondre avec la recherche de gauche : **Ctrl-F** cherche dans le **fichier
courant** (tous les modes, y compris *Source + Lecture*), tandis que « Recherche dans
les textes » cherche dans **tout le disque**.

## Produire un rapport

Le bouton **« 📊 Rapport… »** crée une synthèse du disque (nombre de dossiers et de
fichiers, liste des extensions avec leur nombre). On peut le trier, le limiter à
un dossier, et l'exporter en **Texte**, **CSV** (tableur) ou **HTML**, ou le copier.

## Confidentialité

Tout se passe **sur cette machine** : aucune donnée n'est envoyée sur Internet.
Les images de disque et leur contenu sont des données privées — à ne pas diffuser.

## Version et licence

**Navigateur Smaky — version 0.3.1**

© 2026 **Epsitec SA** et **Pierre-Yves Rochat**.

Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier
selon les termes de la **Licence publique générale GNU (GNU GPL) version 3**, telle
que publiée par la Free Software Foundation. Il est distribué dans l'espoir qu'il
sera utile, mais **SANS AUCUNE GARANTIE**. Le texte complet figure dans le fichier
`LICENSE` accompagnant le programme.

Ce projet s'appuie sur **FOSfat / libfosgra** (Mathieu Schroeter, Epsitec SA),
également sous GPL v3 — notamment pour le décodage des images Smaky.
