# Le format Typo (Smaky) — notes de rétro-ingénierie

> Reconstitué à partir de l'examen d'un large corpus de fichiers `.typo`
> (disque ALPINE, 5659 fichiers) en l'absence de spécification d'origine.
> **Niveaux de confiance** : ✅ confirmé par les octets · 🟡 fortement probable · ❓ hypothèse.
>
> Typo est le logiciel de composition typographique du Smaky (labo J.-D. Nicoud / Epsitec).
> Ce document sert de base au visualiseur (`viewer/renderer/decoders/typo.js`).

## 1. Structure physique du fichier ✅

- **Texte brut**, sans en-tête ni nombre magique. Le plus petit fichier observé est
  `essai\r` (6 octets).
- **Fin de ligne = `0x0D` (CR)** seul (convention Smaky), jamais `LF`.
- **Balisage inline** par commandes `\…` insérées dans le texte (voir §3).

## 2. Encodage des caractères ✅

Identique au texte Smaky (cf. `smakytext.js`), avec deux spécificités Typo :

| Octet | Sens |
|------:|------|
| `0x0D` | fin de ligne → `\n` |
| `0x02` | **espace insécable** |
| `0x09` | tabulation (utilisée avec `\newtab` pour les tableaux) |
| `15..31` | lettres accentuées : `ü à â é è ë ê ï î ô ù û ä ö ç « »` |
| `32..126` | ASCII identité |
| `>127` | inutilisé (ignoré) |

Exemple : `s\x12quencement` → `séquencement` (0x12 = 18 → é).

## 3. Syntaxe des commandes ✅

- Forme générale : `\nom arguments;` — terminée par `;`.
- Certaines commandes de niveau ligne sont plutôt closes par le CR de fin de ligne.
- Préfixe `\=` observé en tête de ligne avant un style (ex. `\=\stitre;…`) 🟡 réinitialise
  le contexte / force un nouveau bloc.
- Arguments fréquents : nombres + **unités** `il` (interligne), `mm`, `cw` (largeur colonne),
  `lp`, `p6`/`p8` (corps de référence), coordonnées `h0-h9`, chemins `"@VOL:RÉP:FICHIER"`.
- **Portée stylée inline** : `\cmd:texte|` ✅ — un `:` **collé à une commande** ouvre une
  portée (p.ex. `\b:mot|` met « mot » en gras), le `|` la ferme (retour à la fonte
  précédente). ⚠️ Un `:` **non collé** à une commande est une vraie ponctuation
  (« assemblage: »). Le marqueur `|` sert de « pop » de fonte.

## 4. Catalogue des commandes principales

Classées par rôle. Fréquences indicatives sur le corpus ALPINE.

### Segmentation & structure
| Commande | Fréq. | Rôle | Conf. |
|---|---:|---|:--:|
| `\fichier:NOM` | 1903 | nom du document ; **plusieurs par fichier** = sous-documents concaténés | ✅ |
| `\a;` | 10995 | **alinéa** (début de paragraphe) | ✅ |
| `\stitre;` / `\sstitre;` | 1991 / 2488 | titre / sous-titre (stylés) | ✅ |
| `\num;` / `\snum;` / `\ssnum;` | 3510 / … / 1172 | titres de **section numérotée** (niveaux) | 🟡 |
| `\trait` / `\ln;` | 3145 | filet horizontal / ligne de séparation | 🟡 |
| `\bl;` | 4401 | ligne blanche / blanc vertical | 🟡 |
| `\saute Nmm;` | 35035 | **espace vertical** de N mm (grandes valeurs ≈ saut de page) | ✅ |

### Mise en page
| Commande | Rôle | Conf. |
|---|---|:--:|
| `\marge …;` | marges | 🟡 |
| `\interligne X(il\|mm\|p8);` | interlignage | ✅ |
| `\justif;` | justification | 🟡 |
| `\ind` / `\identoff` | indentation / fin d'indentation | 🟡 |
| `\ecarte …;` | approche (espacement inter-lettres/mots) | ❓ |
| `\hspace …;` | espace horizontal | 🟡 |
| `\up N u;` / `\down N u;` | décalage de ligne de base (haut/bas, exposant/indice) | 🟡 |
| `\top …;` | position verticale / haut de bloc | ❓ |
| `\newtab …;` / `\mtable;` / `\t;` | tabulations / **tableaux** | 🟡 |

### Polices
- **`\phchgen CODE;`** = sélection de la **fonte physique** (bas niveau), p.ex. `trp23`, `ulp16`. ✅
- **Fontes logiques `\<fam><style><corps>`** (ex. `\ur12`, `\lb14`, `\ub08`) : 🟡
  - `fam` = famille : `u` (la plus courante — vraisemblablement la fonte maison « Swiss »),
    `l`, `t`, `m`, `n`, `f`, `g`, `d`, `b`… ❓
  - `style` = `r` roman/normal · `b` **gras** · `i` *italique* · `e`/`l` variantes (light) ❓
  - `corps` = 2 chiffres = corps en points (03…96).
- **Macros mono/bi-lettres définies par document** : `\define b:\ub10;` rend `\b` = gras,
  `\i` = italique, `\p`/`\g`/`\c` = variantes de texte courant. **Leur sens dépend des
  `\define` du document** — il faut les lire avant de rendre. ✅

### Ressources externes
| Commande | Rôle | Conf. |
|---|---|:--:|
| `\image NOM,param,taille;` | bitmap inline → `NOM.image`/`NOM.color`. **NOM = 1er argument** ; la taille `90mm` est en fin (⚠️ ne pas confondre) | ✅ |
| `\figplan ,,,NOM;` | dessin **vectoriel** → fichier `NOM.plan` (format Smaky distinct, non décodé ici) | ✅ |
| `\spfdd …,"@VOL:RÉP:FICHIER";` | placement d'un graphique par chemin Smaky (souvent un autre volume) | 🟡 |
| `\importe[-]:NOM` | **inclusion d'un fichier de macros/style** externe | ✅ |
| `\define NOM:EXPANSION;` | **définition de macro** | ✅ |
| `\date;` | insertion de la date | 🟡 |

## 5. Conséquences pour un rendu fidèle

1. **Tokeniser** le flux (suite de runs de texte + commandes), au lieu d'un traitement
   ligne-à-ligne par expressions régulières.
2. **Construire la table des macros** (`\define`) avant rendu, et les **développer**
   (idéalement en résolvant aussi les `\importe`, si les fichiers importés sont présents).
3. **Segmenter** par `\fichier:` (un `.typo` = potentiellement plusieurs documents).
4. **Hiérarchie** : `\stitre`/`\sstitre` + `\num`/`\snum`/`\ssnum` → titres `h1…h4` ;
   lignes débutant par `-` → listes.
5. **Styles** : déduire **gras / italique / corps** des fontes logiques (style `b`/`i` + chiffres).
6. **Tableaux** : `\newtab`/`\mtable` + tabulations `0x09`.
7. **Images** : `\image`/`\figplan`/`\spfdd` → on peut **afficher l'image réelle** via le
   décodeur d'images Smaky déjà présent (`smakyimage.js`), si le fichier est sur le disque.

## 6. État du décodeur (`viewer/renderer/decoders/typo.js`)

**Phase 1 — faite (2026-06-04)** : mode Lecture reconstruit la **structure** :
- segmentation `\fichier:` (sous-documents) ;
- titres `\stitre`/`\sstitre` et **sections numérotées** `\num`/`\snum`/`\ssnum`
  (compteurs 1 / 1.1 / 1.1.1, remis à zéro par `\fichier:`) ;
- **listes** (lignes en « - ») et **paragraphes** ;
- **développement des macros `\define`** du document (imports non résolus) ;
- nettoyage des **portées stylées** `\cmd:texte|` (texte conservé) ;
- figures `\image`/`\figplan`/`\spfdd` → placeholder nommé.
- Validé sans erreur sur les 5659 fichiers du disque ALPINE.

**Images (fait, 2026-06-04)** : les bitmaps référencés par `\image` sont **décodés et
affichés** dans le rendu (mode Lecture et dual view). `typo.js` émet un placeholder
`.t-fig[data-fig]` ; `app.js` l'hydrate via un index global nom→fichier (préférence au
dossier courant) puis `smakyimage.js`. Taux de résolution ~94 % (`\image` sur ALPINE).
Les `\figplan` (`.plan` vectoriels) et chemins `@VOL:…` d'un autre volume restent en
placeholder.

**Gras / italique (fait, 2026-06-04)** : les portées stylées `\cmd:texte|` rendent
`<strong>`/`<em>` selon `styleOf()` (raccourcis `\b`/`\i`, fontes logiques `…b##`/`…i##`,
ou macro `\define` correspondante). `renderInline()` découpe la ligne sur les portées,
échappe chaque segment et insère les balises. Validé : 0 erreur sur 300+ fichiers,
pas de gras parasite.

**Espacement vertical (fait, 2026-06-04)** : `\saute N mm` → espaceur `.t-space`
(hauteur ∝ N, plafonnée) ; `\bl;` → ligne blanche.

**Dessins `.plan` (fait, 2026-06-04)** : `\figplan` hydraté comme `\image` via
`smakyplan.js` (rendu SVG inline). Voir `docs/plan-format.md`.

**Phases ultérieures (à faire)** : tableaux `\newtab`/`\mtable` ; résolution des
`\importe` entre fichiers ; puces `+` (sous-listes).
