# Aide — Navigateur Smaky

Cet outil permet d'explorer le contenu d'un disque Smaky (format FOS) qui a été
extrait dans un dossier. Il affiche l'arborescence, visualise les fichiers
(textes, images, format Typo…) et permet de filtrer et de rechercher.

## Ouvrir un disque

Clique sur **« 📂 Ouvrir un dossier extrait… »** et choisis le dossier produit
par l'extraction (celui qui contient `manifest.json` et un sous-dossier `tree/`).
L'arborescence apparaît à gauche.

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
- **Lecture** / **Source** : pour les fichiers **Typo** (composition typographique).
  *Lecture* masque les commandes et montre le texte propre ; *Source* montre le
  texte avec les commandes `\…` mises en évidence.

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

## Rechercher dans les textes

Tape un mot dans le champ **« Recherche dans les textes »** et appuie sur
**Entrée**. Le volet gauche bascule sur **« Résultats »** : la liste des fichiers
contenant ce mot, avec le nombre d'occurrences et un extrait. Clique un résultat
pour ouvrir le fichier ; les correspondances sont **surlignées**.

Par défaut, la recherche est **insensible à la casse et aux accents** : taper
`reseau` trouve aussi « Réseau » et « réseaux ». L'onglet **« Arborescence »**
ramène à l'arbre.

Deux boutons à côté du champ :

- **`Aa`** : respecter la casse (distingue majuscules et minuscules) ;
- **`.*`** : activer les **expressions régulières** (voir ci-dessous).

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

## Produire un rapport

Le bouton **« 📊 Rapport… »** crée une synthèse du disque (nombre de dossiers et de
fichiers, liste des extensions avec leur nombre). On peut le trier, le limiter à
un dossier, et l'exporter en **Texte**, **CSV** (tableur) ou **HTML**, ou le copier.

## Confidentialité

Tout se passe **sur cette machine** : aucune donnée n'est envoyée sur Internet.
Les images de disque et leur contenu sont des données privées — à ne pas diffuser.

## Version et licence

**Navigateur Smaky — version 0.1.0**

© 2026 **Epsitec SA** et **Pierre-Yves Rochat**.

Ce programme est un logiciel libre : vous pouvez le redistribuer et/ou le modifier
selon les termes de la **Licence publique générale GNU (GNU GPL) version 3**, telle
que publiée par la Free Software Foundation. Il est distribué dans l'espoir qu'il
sera utile, mais **SANS AUCUNE GARANTIE**. Le texte complet figure dans le fichier
`LICENSE` accompagnant le programme.

Ce projet s'appuie sur **FOSfat / libfosgra** (Mathieu Schroeter, Epsitec SA),
également sous GPL v3 — notamment pour le décodage des images Smaky.
