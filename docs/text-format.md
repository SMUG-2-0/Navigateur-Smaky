# Le format TEXT.CODE (Smaky) — notes de rétro-ingénierie

> Reconstitué à partir de l'examen des fichiers `.text` du disque ALPINE
> (558 fichiers de type FOS `text`), en l'absence de spécification d'origine.
> **Niveaux de confiance** : ✅ confirmé par les octets · 🟡 fortement probable · ❓ hypothèse.
>
> **TEXT.CODE** (auteur **Daniel Roux**, également auteur des programmes **PAGE** et
> **PLAN** du Smaky) est l'éditeur de texte mis en page du Smaky, antérieur à *Typo* et
> à *Page*. Sa version ultérieure est **Text4** (même extension `.text`, pas de `.text4`).
> Ce document sert de base au visualiseur (`viewer/renderer/decoders/textcode.js`).

## 1. Extension et reconnaissance ✅

- Tous les documents portent l'extension **`.text`** (type FOS `text`), partagée avec
  d'autres usages : sur le disque ALPINE, **224 / 558** fichiers `.text` sont en réalité
  du **texte simple** (notes, listes, courriels) sans balisage.
- Un document TEXT.CODE commence par **`\ver `** (après d'éventuels CR/espaces de tête).
  C'est le critère de reconnaissance employé par le visualiseur ; les `.text` en texte
  simple sont laissés au rendu texte générique.
- **Text4** se distingue par `\prespri text4` (voir §2) et un `\zoom` ≠ vide ; il n'a
  **pas** d'extension propre.

## 2. Structure logique du fichier ✅

Trois parties successives, séparées par des `CR` (`0x0D`) :

1. **Préambule de présentation** — paramètres de page globaux, jusqu'à `\enable <cr>;` :

   | Commande | Sens |
   |----------|------|
   | `\ver 1;` | version du format |
   | `\prespri text` / `text4` / *(vide)* | présentation (« presse ») associée : variante TEXT / Text4 |
   | `\zoom [n];` | facteur d'affichage |
   | `\width 7pt;` | chasse |
   | `\hauteur`, `\marsup`, `\marinf` | hauteur de page, marges haut/bas |
   | `\interligne`, `\marge`, `\large`, `\renf` | interligne, marge gauche, largeur, renfoncement |
   | `\dimcar`, `\justmode`, `\textfact` | dimensions de caractère, mode de justification, facteurs |
   | `\textdef <n>;` | fonte par défaut (entier compactant fonte + corps) ❓ |
   | `\disable …;` / `\enable …;` | (dés)activation d'options d'édition |

2. **Définitions de styles** — `\define NOM:EXPANSION;` (un par ligne). Noms usuels :
   `g_Fond` (texte normal), `g_Evidence` / `g_Gras` (gras), `g_Italique`, `g_Titre`,
   `g_legende`, `g_gothique`… L'expansion est une **fonte logique** (§4).

3. **Corps** — texte avec commandes inline (§3, §4).

## 3. Encodage des caractères et fins de ligne ✅

Identique au texte Smaky (cf. `smakytext.js`), avec ces spécificités :

| Octet | Sens |
|------:|------|
| `0x0D` (CR) | **fin de ligne voulue par l'auteur** (= fin de paragraphe) |
| `0x0A` (LF) | **retour à la ligne automatique** de l'éditeur (mot suivant ne tenait pas) |
| `0x0B` | **césure conditionnelle** : un mot a été coupé en fin de ligne automatique |
| `0x02` | espace insécable |
| `0x09` | tabulation (colonnes, avec `\newtab` / `\justtab`) |
| `15..31` | lettres accentuées (`à é è ë ê ï î ô ù û ä ö ç`…) |
| `32..126` | ASCII identité ; `>127` ignoré |

**Recollage des lignes** (clé du rendu *Lecture*) : pour reconstituer les paragraphes
tels que saisis, on traite `CR` comme un vrai saut de paragraphe, on **fusionne** les
`LF` (retour automatique) en un espace, et on **soude** le mot autour d'une césure
(`0x0B` suivi de `LF` → rien). Exemple : `…d'en fai‹0B›‹0A›\hn 3pg;re…` → « d'en faire ».

## 4. Commandes inline ✅🟡

Forme générale : `\nom args;`. Le texte littéral est conservé tel quel.

| Commande | Effet | Rendu *Lecture* |
|----------|-------|-----------------|
| `\hn <n>pg;` | début de ligne (position horizontale) | masquée |
| `\h <n>pg;` | espace de justification (micro-espace inter-mots) | espace |
| `\g_Fond;`, `\g_Gras;`, `\g_Evidence;`, `\g_Titre;`… | appel d'un style `\define` — **mode persistant** jusqu'au prochain | applique gras / italique / titre |
| `\fam(flags)<n>pg` | fonte directe ; `flags` contient `b`=gras, `i`=italique (les autres — `o f s n p` — désignent la fonte) | gras / italique |
| `\image NOM,facteur,taille;` | image incluse | figure (image réelle si trouvée) |
| `\justif;`, `\drapeau;`, `\drapd;`, `\centre;` | mode de justification | masquée |
| `\interligne`, `\marge`, `\large`, `\renf`, `\newtab`, `\justtab`, `\coupe`, `\nocoupe`, `\zoom` | mise en page | masquée |
| `\debutpage:…`, `\finpage:…`, `\cpage` | en-tête / pied / numéro de page | non rendus |

Les **styles** sont des *modes* (contrairement à Typo qui borne aussi par `:texte|`) :
`\g_Evidence;` active le gras jusqu'au prochain `\g_Fond;`. Le visualiseur déduit
gras/italique de l'expansion `\define` (présence de `b` / `i` dans les drapeaux).

## 5. Tabulateurs ✅🟡

Les positions de colonnes sont fixées par `\newtab <pos>,<pos>,…;` (en mm depuis la
marge) et leur justification par `\justtab <j>,<j>,…;` (`n`/`i`/`d`…). Dans le corps, le
caractère **TAB (`0x09`)** fait avancer au prochain taquet. Deux usages observés :

- **Indentation / listes numérotées** : `TAB* <libellé court> TAB+ <corps sans TAB>`.
  Le **nombre de TAB** donne le niveau ; le libellé (« 1.2.1 ») précède le corps. Cf.
  `exemples/text/indentat.text`. Le visualiseur en fait un **retrait hiérarchique** :
  retrait ∝ nombre de TAB, libellé en saillie, corps replié en retrait.
- **Colonnes (tableaux)** : plusieurs TAB répartis dans la ligne. Le visualiseur insère
  un **espace de tabulation** à chaque TAB (séparation visible, alignement exact non
  reconstitué).

## 6. Limites du visualiseur actuel

- Les **tabulateurs en colonnes** sont séparés mais **non alignés** sur les taquets
  `\newtab` : les tableaux restent lisibles sans reproduire la mise en page exacte.
  (La **taille des caractères est constante** : ni `\textdef`, ni `\dimcar`, ni les
  changements de corps des fontes ne sont appliqués.)
- `\textdef` (fonte par défaut compactée) et les fontes gothiques ne sont pas interprétés
  au-delà du gras/italique.
- Rendu **indicatif**, *best-effort* : l'objectif est la lisibilité du contenu pour la
  recherche, pas la reproduction typographique fidèle.
