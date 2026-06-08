# Format `.PLAN` (Smaky — dessin vectoriel, ~1985)

État : **rétro-ingénierie en cours**. Ce document consigne les faits établis et les
hypothèses à confirmer par fichiers de test contrôlés (émulateur Smaky Infini).

Corpus analysé : 2596 fichiers `.plan` sous `ALPINE_extracted/tree/`.

## 1. Structure générale (établi)

- **Big-endian**, mots de **16 bits** (CPU 68000).
- Fichier = suite d'**enregistrements de 16 octets** = **8 mots**.
- Le **1er mot de chaque enregistrement = type** :
  - valeurs **positives petites (1–10)** = primitives de dessin ;
  - valeurs **≥ 0x60** = structure (`0x66`/`0x67` = début/fin d'objet) ;
  - valeurs **négatives (0xFFFA–0xFFFF)** = sections de bibliothèque (palettes).
- Certaines primitives sont à **longueur variable** : des enregistrements de
  *continuation* suivent, dont le 1er mot n'est alors pas un opcode mais de la donnée
  (souvent de forme `0xNN08`). À cartographier.

### En-tête (1er enregistrement, 16 o.)
Champs `[w0, w1, w2, w3=largeur, w4=hauteur, …]` — w3/w4 = dimensions du canevas.
Exemples : `res` `[2,198,3,48,136]` → 48×136 ; `gentil` `[7,2,768,188,164]` → 188×164 ;
`cond` `[2,1,258,36,24]` ; `inv2` `[1,1,770,32,56]`.
Sémantique exacte de w0–w2 : **à confirmer**.

### Bibliothèque / préambule (sections à 1er mot négatif)
Présente dans les documents « complets » (p. ex. `inv.plan`, `res.plan`), **identique
octet pour octet** entre fichiers → préambule fixe. Les petits fichiers symboles
(`cond`, `econd`, `inv2`) en sont **dépourvus** : ils sautent directement aux primitives.

| Tag | Valeur | Contenu |
|-----|--------|---------|
| -1  | 0xFFFF | 20 motifs de remplissage 8×8 (bitmaps), index 0x00–0x13 |
| -2  | 0xFFFE | 23 styles (bitmap 8×8 + attributs `(couleur,largeur?)`) |
| -3  | 0xFFFD | calques nommés ASCII : « Fond », « Unités » |
| -4  | 0xFFFC | 20 définitions de plume/style |
| -5  | 0xFFFB | 9 entrées (b1–b9) |
| -6  | 0xFFFA | marqueur de fin de bibliothèque |

### Objet de dessin
Encadré par `0x66` (début) … `0x67` (fin). Les 4 mots suivant `0x66`/`0x67` semblent
être un point de référence / placement (valeurs **signées**, p. ex. `res` :
(-648,-344) répété). À confirmer.

## 2. Primitives (opcodes 1–10)

### Système de coordonnées (CONFIRMÉ — fichiers de test contrôlés)
- **Origine en bas à gauche, Y vers le haut** (convention math), côté éditeur ET fichier.
- **Échelle ×4** : `valeur_stockée = 4 × coordonnée_affichée` par PLAN. Pas de décalage.
- Grille de l'éditeur : tous les 2 mm, trait fort tous les 8 mm.

### Enregistrement-ligne (CONFIRMÉ)
`[opcode, y1, x1, y2, x2, attr, 0, 0]` — **l'ordonnée précède l'abscisse**.
`attr` = `256` (0x100) par défaut (plume/style ; sémantique fine à confirmer).

Vérité-terrain (`test_plan/`, tous tracés depuis le coin (16,8)) :
| Fichier | op | y1,x1,y2,x2 | affiché PLAN | outil |
|---|----|-------------|--------------|-------|
| T2 | 1 | 32,64,96,96  | (16,8)→(24,24) | droite quelconque |
| T3 | 4 | 32,64,32,192 | (16,8)→(48,8)  | droite horizontale |
| T4 | 4 | 32,64,160,64 | (16,8)→(16,40) | droite verticale |

→ **l'opcode encode la contrainte de l'outil** : `1` = droite quelconque,
`4` = droite H/V. (Le menu PLAN offre : main levée courbe ouverte/fermée, droites
[quelconques | H/V | élastiques…], flèches, rectangles [arrondi 4/8/12/16],
polygones [ouvert | fermé | H-V], surface, texte.)

### Mot-opcode = `(modificateur << 8) | type` (CONFIRMÉ)
L'octet **bas** = type de primitive ; l'octet **haut** = modificateur propre au type.
Fréquences sur tout le corpus (octet bas), décroissant :
8 (392k) > 7 (285k) > 4 (196k) > 3 (96k) > 0 (74k) > **5 (70k)** > 6 (48k) >
1 (11k) > 9 (7k) > 2 (1.8k) > 0x64/0x65 (≈1.3k) > 10 (509) > 12 (31) > 11 (20).

| Type | Primitive | Modificateur (octet haut) | Test |
|---|---|---|---|
| 0 | **segment de tracé libre** (chaîné, dans groupe `0x66`/`0x67`) | 0 | T9 |
| 1 | droite quelconque | 0 | T2 |
| 3 | côté de polygone (dans un groupe `0x66`/`0x67`) | 0 (ouvert/fermé ?) | T6 |
| 4 | droite horizontale/verticale | 0 | T3, T4 |
| 2 | droite (variante, p. ex. élastique) | 0 | corpus (inv2) |
| 5 | **cercle/point** : `[5, 255, rayon, y, x, attr]` — pastilles de `genes2.plan` (rendu validé) | — | corpus |
| 6 | rectangle (2 coins `y1,x1,y2,x2`) | **arrondi** = 4/8/12/16 (`0x0406`, `0x0C06`) | T5, T12 |
| 7 | **surface remplie** (rect.) ; `attr` octet bas = motif de remplissage (`0x010D`) | 0 | T11 |
| 8 | **caractère** de texte (1 enreg./caractère) | **style/calque** (`0x0908` = Évidence) | T7 |
| 5 | cercle/point : `[5, 255, rayon, cy, cx, attr]` (centre+rayon) | — | genes2 |
| 10 | **ellipse complète** : `[10, ry, rx, cy, cx, attr]` (rayons puis centre) — modif. toujours 0 | 0 | T13 |
| 11 | **arc** d'ellipse (mêmes champs `[ry,rx,cy,cx]`) ; octet haut = **masque de quadrants** | quadrants | T13, corpus |
| 12 | **flèche** | type de pointe (palette `fleches.png`) ? | T10 |

PLAN dessine les ellipses/cercles **en quarts**. Ellipse entière = `op 10` (modif. 0).
Arc partiel = `op 11`, octet haut = **masque de quadrants, 2 bits par quadrant**
(CONFIRMÉ T13/T15/T16/T17, mapping validé visuellement) :

| Quadrant | bits | masque | angles (trigo, Y↑) |
|---|---|---|---|
| NE (haut-droite) | 1-0 | `0x03` | 0°–90° |
| NO (haut-gauche) | 3-2 | `0x0C` | 90°–180° |
| SO (bas-gauche)  | 5-4 | `0x30` | 180°–270° |
| SE (bas-droite)  | 7-6 | `0xC0` | 270°–360° |

Demis = 2 paires : `0x0F`=haut, `0xF0`=bas, `0xC3`=droite, `0x3C`=gauche.

**`op 9` = arc de cercle** `[9, masque_quadrants, rayon, cy, cx, attr]` — comme
`op 11` mais **circulaire** (rayon unique) et le masque est dans le **mot 1** (pas
l'octet haut de l'opcode). Mêmes bits de quadrant : ex. porte ET `and.plan` =
`0xC3` (moitié droite du « D »), `diin.plan` = quarts simples (`0x03/0x0C/0x30/0xC0`).

⚠️ Format ellipse = **centre + rayons** `[ry,rx,cy,cx]`, PAS boîte englobante (corrigé
après T13 : objet 1, bbox (8,8)-(40,24) = centre (24,16) rx16 ry8 = `[32,64,64,96]` ×4).

Inconnus restants : **9** (7k occ.), 0x64/0x65 (proches de `0x66/0x67` → groupes
imbriqués ?), encodage exact des quadrants d'arc (`op 11`).

## 5. Prototype de rendu (`tools/planrender.py`)
Lit un `.plan` → SVG (et rasterisation PIL pour PNG). Bascule l'axe Y via la
bounding-box. Valide visuellement le décodage : `res.plan` → résistance,
`inv2.plan` → inverseur, `ciseaux.plan` → ciseaux, `genes2.plan` → circuit imprimé.
Galerie : `test_plan/render/`.

**Texte** (T7) : `[type 8, fonte, (style<<8)|car, y, x, attr]`. Octet bas du 3ᵉ mot
= code ASCII ; `y` = ligne de base ; `x` = position absolue du caractère (1 enr./car).
La **fonte** (mot 1) est souvent un code **ASCII** 2 lettres (« UL », « UR », « DA »…)
ou un descripteur `0xCE8x` (partagé avec les calques -3 : Fond=…80, Évidence=…81).
La fonte PLAN est **proportionnelle** : l'avance `x[n+1]-x[n]` = largeur du glyphe
(varie par caractère), **pas** la taille. Pour le rendu : taille **uniforme par ligne**
= médiane des avances / 0,55 (sinon i/M auraient des tailles différentes).

**Groupes** : `0x66` (début) … `0x67` (fin). Un polygone = groupe d'arêtes `op=3`.
Des paires `0x66/0x67` **vides** peuvent apparaître (objets annulés à la saisie).

### Mot `attr`
Défaut `0x0100` (256). En changeant le motif de trait : `0x0137` (T8). Octet **haut**
= plume (0x01), octet **bas** = **motif de trait** (index palette, cf. `traits.png`).
Couleur non observée en monochrome. Indexation fine de la palette : à cartographier.

### Reste à identifier
Opcodes **2, 5, 7 (le + fréquent !), 9, 10**. Candidats d'après le menu PLAN :
courbe à main levée (ouverte/fermée), flèche, surface. `op 7` ultra-fréquent →
probablement la **courbe à main levée** (suite de micro-segments). À mapper via tests.

⚠️ Anciennes hypothèses (cercle centre+rayon en op 5…) **caduques** : refaites avec
l'ordre `(y1,x1,y2,x2)` désormais établi.

## 3. Outils

- `tools/` (à créer) : `planparse.py` — dump hex/décodé d'un `.plan`.
- Petits fichiers idéaux pour débuter : `exemples/plan/cond.plan` (80 o.),
  `econd.plan` (80 o.), `inv2.plan` (112 o.).

## 4. Plan d'expériences contrôlées (émulateur)

Créer des dessins **minimaux à géométrie connue** pour lever chaque ambiguïté
(voir §2). Un primitive par fichier, coordonnées notées. Liste détaillée à convenir.
