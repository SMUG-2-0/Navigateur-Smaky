# Le format de fichiers `.typo`

Notes sur le format **Typo**, un langage de composition typographique utilisé sur
les Smaky, en vue de son décodage et de sa visualisation.

> ⚠️ Document de travail. Il mêle des faits **observés** sur les fichiers du disque
> ALPINE et des **hypothèses** (signalées comme telles). À compléter au fur et à
> mesure, notamment avec les informations attendues des connaisseurs du format.

## 1. Origine

Typo est un format de composition typographique développé à l'**EPFL**, dans le
laboratoire du professeur **Jean-Daniel Nicoud** (LAMI — Laboratoire de
micro-informatique). On peut le décrire comme une sorte de « LaTeX suisse » :
un texte balisé par des commandes qui décrivent la mise en page, plutôt qu'un
traitement de texte WYSIWYG.

Le disque ALPINE (de Mme Nicoud) en contient **plus de 7100 fichiers** `.typo` —
c'est de loin le type le plus représenté. Une commande `\LAMI;` apparaît dans
certains fichiers (vraisemblablement un en-tête / papier à lettres du labo).

## 2. Structure générale

Un fichier `.typo` est du **texte** (encodé dans le jeu de caractères Smaky, voir
[extraction-phase1.md](extraction-phase1.md) §7) entremêlé de **commandes**.

- **Commande** : `\` suivi d'un nom, souvent terminée par `;` et pouvant porter des
  arguments. Exemples : `\marge 27mm;`, `\interligne 3.8mm;`, `\saute 45mm;`,
  `\image tec,1,90mm;`, `\justif;`, `\date;`.
- **Macros** : `\define nom:…;` définit une commande réutilisable (ensuite appelée
  par `\nom;`).
- **Unités de longueur** observées : `mm`, `cm`, `il` (interligne), `cw`
  (largeur de caractère ?), valeurs absolues ou relatives (`#+85mm`, `#-85mm`).
- **Fin de ligne** : retour chariot (CR, octet 13).
- **Tabulation** (octet 9) : utilisée avec `\newtab` pour aligner des colonnes.

### Caractère spécial : l'octet `0x02`

L'octet `0x02` représente un **espace insécable**. On le voit grouper les chiffres
d'un numéro de téléphone ou d'un CCP, p. ex. `728<0x02>44<0x02>83`. Le visualiseur
le convertit en espace (insécable).

## 3. Commandes les plus fréquentes

Relevé sur les 7105 fichiers `.typo` non vides (≈ 2200 « commandes » distinctes au
total — ce grand nombre vient surtout des macros `\define` propres à chaque
document et des nombreux codes de police).

| Commande | Occur. | Rôle (observé / *hypothèse*) |
|----------|-------:|------------------------------|
| `\saute` | 35042 | saut vertical (espacement) |
| `\phchgen` | 16755 | changement de police générale (arg. : `fsp35`, `fwp45`, …) |
| `\top` | 14951 | *début de colonne / haut de zone* |
| `\ind` | 12299 | *indentation* |
| `\down` | 12149 | déplacement vers le bas |
| `\a` | 11080 | *alinéa / nouveau paragraphe* |
| `\define` | 9663 | définition d'une macro |
| `\newtab` | 8979 | définition des taquets de tabulation |
| `\up` | 8314 | déplacement vers le haut |
| `\interligne` | 7894 | interligne |
| `\marge` | 7823 | marge |
| `\image` | 7324 | insertion d'une image (`nom,index,taille`) |
| `\ecarte` | 7178 | espacement / remplissage horizontal |
| `\b` | 6562 | *gras (begin bold ?)* |
| `\ur12`, `\lr14`, `\lr12`, `\ub12`, `\lb14`, `\ub08`, `\ur10` | — | **sélecteurs de police** : *style + taille* (voir §4) |
| `\bl` | 4401 | *saut de ligne / blanc* |
| `\num` | 3513 | *numérotation* |
| `\identoff` | 3164 | *désactive l'indentation* (souvent en tête de fichier) |
| `\trait` | 3145 | filet horizontal (ligne) |
| `\pulm`, `\polm` | ~2700 | *marges paire/impaire ou plume/?* |
| `\date` | 2553 | insère la date |
| `\justif` | 2519 | justification du texte |
| `\sstitre` | 2488 | **sous-titre** |
| `\stitre` | 1991 | **titre de section** |
| `\figplan` | 1984 | *figure / plan* |
| `\fichier`, `\type` | ~1900 / 1560 | *inclusion de fichier / type* |
| `\=`, `\-`, `\_` | — | commandes courtes (*séparateurs / sauts en tableau ?*) |

## 4. Sélecteurs de police (hypothèse)

Les codes comme `\ur12`, `\ub12`, `\lr14`, `\lb14`, `\ub08` semblent suivre le motif
`<lettre><lettre><taille>` :

- 3ᵉ partie = **corps** en points (`08`, `10`, `12`, `14`, …) ;
- 2ᵉ lettre = **style** : `r` = romain (normal), `b` = gras (*hypothèse*) ;
- 1ʳᵉ lettre = `u` / `l` : signification non confirmée (*casse haute/basse ? variante ?*).

`\phchgen` prend un argument du même genre (`fsp35`, `fwp45`, `xcp80`…) :
*famille + style + corps ?* — à confirmer.

## 5. Commandes structurantes (utiles à la lecture)

Pour restituer le **contenu** (et non la mise en page exacte), les commandes les
plus utiles sont :

- `\stitre;` → titre, `\sstitre;` → sous-titre ;
- `\a;` → nouveau paragraphe ;
- `\trait;` → filet horizontal ;
- `\image nom,…;` → image insérée ;
- `\saute`, `\down`, `\up` → espacements verticaux ;
- `\newtab` + tabulations → tableaux.

## 6. Visualiseur dans NavigateurSmaky

Le module `viewer/renderer/decoders/typo.js` propose deux rendus :

- **Lecture** : masque les commandes et restitue le texte propre (titres mis en
  évidence, paragraphes, filets, images signalées, espace insécable préservé).
  Rendu **indicatif** (best-effort).
- **Source** : le texte décodé avec les commandes `\…` mises en évidence.

### Limites actuelles (pistes d'amélioration)

- pas d'**expansion des macros** `\define` ;
- pas de mise en page des **tableaux** (`\newtab` + tabulations) en colonnes ;
- pas de **gras / italique** (`\b`, `\i`, codes de police) ;
- positionnement absolu (mm) ignoré — non pertinent pour la lecture du contenu.

Ces points pourront être traités selon les besoins de l'analyse, et affinés avec
toute documentation d'époque du format Typo.
