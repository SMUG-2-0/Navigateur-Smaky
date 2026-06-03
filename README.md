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
| 2 | Bibliothèque d'analyse Python (décodage texte, images, inventaire) | à venir |
| 3 | Livrables pour la recherche (rapport navigable, exports) | à venir |

## Démarrage rapide

Voir le mode d'emploi complet : **[docs/extraction-phase1.md](docs/extraction-phase1.md)**.

En résumé, dans WSL (où FOSfat est compilé) :

```bash
cd /mnt/d/Dropbox/35-Prof/epsitec/Analyse_DI
python3 tools/extract_di.py ALPINE.DI ALPINE_extracted   # extraction complète
python3 tools/verify_extract.py ALPINE_extracted          # contrôle d'intégrité
```

## Contenu du dépôt

```
tools/
  extract_di.py      extraction .DI → dossier (+ manifest.json)
  verify_extract.py  contrôle d'intégrité (manifeste vs fichiers extraits)
docs/
  extraction-phase1.md   mode d'emploi détaillé de la phase 1
README.md
.gitignore
```
