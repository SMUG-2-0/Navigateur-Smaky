#!/usr/bin/env python3
"""
extract_di.py — Extraction d'une image disque Smaky (.DI) vers un dossier.

Transforme une image FOS (lue par l'outil `fosread` de FOSfat) en :
  <outdir>/tree/          copie binaire fidèle de l'arborescence et des fichiers
  <outdir>/manifest.json  métadonnées FOS complètes (type, attributs, dates, taille)

L'image originale n'est jamais modifiée (FOSfat est en lecture seule).
Les conversions (texte Smaky -> UTF-8, .IMAGE -> PNG, etc.) ne sont PAS faites
ici : le dump reste binaire et fidèle ; l'analyse/conversion se fait ensuite
côté Python à partir de ce dossier.

À exécuter dans WSL (où FOSfat est compilé). Exemple :
  python3 extract_di.py \
      /mnt/d/Dropbox/35-Prof/epsitec/Analyse_DI/ALPINE.DI \
      /mnt/d/Dropbox/35-Prof/epsitec/Analyse_DI/ALPINE_extracted

Options utiles :
  --manifest-only   ne construit que le manifeste (pas de dump binaire) — sert
                    à mesurer la taille du travail avant l'extraction complète.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, asdict, field
from pathlib import Path

# Emplacements par défaut de FOSfat (compilé sous ~/Fosfat dans WSL).
DEFAULT_FOSREAD = os.path.expanduser("~/Fosfat/tools/fosread")
DEFAULT_LIBDIRS = [
    os.path.expanduser("~/Fosfat/libfosfat"),
    os.path.expanduser("~/Fosfat/libfosgra"),
]

# Une ligne de `fosread ... list` :
#   attr  taille  date_creation  date_modif  date_acces  nom
# Les dates peuvent être nulles ("2000-00-00 00:00"), d'où \d{2} permissif.
_DT = r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}"
LINE_RE = re.compile(
    r"^(?P<attr>[dlhe\-]{3})\s+(?P<size>\d+)\s+"
    rf"(?P<created>{_DT})\s+(?P<changed>{_DT})\s+(?P<viewed>{_DT})\s+"
    r"(?P<name>\S.*?)\s*$"
)


@dataclass
class Node:
    fos_path: str          # chemin FOS depuis la racine, ex. "systeme/efs/iso9660.efs"
    name: str
    type: str              # "dir" | "file" | "link"
    size: int
    hidden: bool
    encoded: bool
    smaky_ext: str         # extension Smaky (après le dernier . ou !), ou ""
    created: str
    changed: str
    viewed: str
    children: list = field(default_factory=list)  # uniquement pour les dossiers


class Fosread:
    """Petit wrapper autour du binaire fosread."""

    def __init__(self, fosread: str, libdirs: list[str], image: str):
        self.fosread = fosread
        self.image = image
        self.env = dict(os.environ)
        self.env["LD_LIBRARY_PATH"] = ":".join(
            libdirs + [self.env.get("LD_LIBRARY_PATH", "")]
        ).strip(":")
        self.opens = 0  # compteur d'ouvertures de l'image (diagnostic perf)

    def list(self, node: str) -> list[Node]:
        """Liste un dossier FOS (non récursif). `node` = "/" pour la racine."""
        self.opens += 1
        out = subprocess.run(
            [self.fosread, self.image, "list", node],
            env=self.env, capture_output=True,
        ).stdout.decode("latin-1", errors="replace")
        nodes: list[Node] = []
        for line in out.splitlines():
            m = LINE_RE.match(line)
            if not m:
                continue
            name = m.group("name")
            if name in (".", ".."):
                continue
            attr = m.group("attr")
            ntype = "dir" if attr[0] == "d" else "link" if attr[0] == "l" else "file"
            child_path = name if node == "/" else f"{node}/{name}"
            nodes.append(Node(
                fos_path=child_path,
                name=name,
                type=ntype,
                size=int(m.group("size")),
                hidden=attr[1] == "h",
                encoded=attr[2] == "e",
                smaky_ext=_ext(name),
                created=_norm_dt(m.group("created")),
                changed=_norm_dt(m.group("changed")),
                viewed=_norm_dt(m.group("viewed")),
            ))
        return nodes

    def get(self, node: str, cwd: str) -> tuple[bool, str]:
        """Extrait récursivement `node` ; le contenu atterrit dans `cwd`."""
        self.opens += 1
        r = subprocess.run(
            [self.fosread, self.image, "get", node],
            env=self.env, cwd=cwd, capture_output=True,
        )
        ok = r.returncode == 0
        return ok, r.stderr.decode("latin-1", errors="replace")

    def get_to(self, node: str, dest: str) -> tuple[bool, str]:
        """Extrait un fichier précis vers le chemin `dest` (parent doit exister)."""
        self.opens += 1
        r = subprocess.run(
            [self.fosread, self.image, "get", node, dest],
            env=self.env, capture_output=True,
        )
        return r.returncode == 0, r.stderr.decode("latin-1", errors="replace")


def _ext(name: str) -> str:
    # Smaky sépare l'extension par '.' ou '!' (ex. "fmm10!typo", "arbre!pas").
    for sep in (".", "!"):
        if sep in name:
            return name.rsplit(sep, 1)[1].lower()
    return ""


def _norm_dt(dt: str) -> str:
    # Dates nulles "2000-00-00 00:00" -> None côté JSON.
    return "" if dt.startswith("2000-00-00") or "-00-00" in dt else dt


# ----------------------------------------------------------------------------

def walk(fr: Fosread, node: str = "/", depth: int = 0, stats: dict = None) -> list[Node]:
    """Parcours récursif via `list` ; construit l'arbre + métadonnées."""
    entries = fr.list(node)
    for e in entries:
        if e.type == "dir":
            stats["dirs"] += 1
            # progression : un point par dossier visité
            if stats["dirs"] % 25 == 0:
                print(f"  ... {stats['dirs']} dossiers, {stats['files']} fichiers "
                      f"({fr.opens} lectures)", file=sys.stderr)
            e.children = walk(fr, e.fos_path, depth + 1, stats)
        elif e.type == "file":
            stats["files"] += 1
            stats["bytes"] += e.size
        else:  # link : on ne suit pas (évite les boucles)
            stats["links"] += 1
    return entries


def dump_binary(fr: Fosread, root_entries: list[Node], tree_dir: Path) -> dict:
    """Extrait le contenu binaire : un `get` récursif par entrée racine."""
    tree_dir.mkdir(parents=True, exist_ok=True)
    res = {"ok": 0, "failed": []}
    for e in root_entries:
        if e.type == "link":
            continue
        if e.type == "dir":
            dest = tree_dir / e.name
            dest.mkdir(parents=True, exist_ok=True)
            ok, err = fr.get(e.name, cwd=str(dest))
        else:  # file racine : atterrit directement dans tree/
            ok, err = fr.get(e.name, cwd=str(tree_dir))
        if ok:
            res["ok"] += 1
            print(f"  [ok] {e.fos_path}", file=sys.stderr)
        else:
            res["failed"].append({"node": e.fos_path, "err": err.strip()[:200]})
            print(f"  [ÉCHEC] {e.fos_path}: {err.strip()[:120]}", file=sys.stderr)
    return res


def repair_missing(fr: Fosread, tree: list[Node], tree_dir: Path) -> dict:
    """Rend l'arbre fidèle : `fosread get` récursif n'écrit pas les fichiers vides
    et saute les noms commençant par '.'. On complète ici depuis le manifeste."""
    res = {"touched_empty": 0, "reextracted": 0, "failed": []}

    def visit(nodes: list[Node]):
        for n in nodes:
            if n.type == "dir":
                visit(n.children)
            elif n.type == "file":
                dest = tree_dir.joinpath(*n.fos_path.split("/"))
                if dest.exists():
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                if n.size == 0:
                    dest.touch()
                    res["touched_empty"] += 1
                else:
                    ok, err = fr.get_to(n.fos_path, str(dest))
                    if ok and dest.exists():
                        res["reextracted"] += 1
                    else:
                        res["failed"].append({"node": n.fos_path, "err": err.strip()[:200]})

    visit(tree)
    return res


def main() -> int:
    ap = argparse.ArgumentParser(description="Extraction d'une image Smaky .DI -> dossier.")
    ap.add_argument("image", help="chemin de l'image .DI")
    ap.add_argument("outdir", help="dossier de sortie (contiendra tree/ et manifest.json)")
    ap.add_argument("--manifest-only", action="store_true",
                    help="ne construit que le manifeste (pas de dump binaire)")
    ap.add_argument("--dump-only", action="store_true",
                    help="réutilise le manifest.json existant ; ne fait que le dump binaire")
    ap.add_argument("--fosread", default=DEFAULT_FOSREAD)
    ap.add_argument("--lib", action="append", default=None,
                    help="dossier de bibliothèque (.so) ; répétable")
    args = ap.parse_args()

    image = os.path.abspath(args.image)
    outdir = Path(os.path.abspath(args.outdir))
    if not os.path.isfile(image):
        print(f"Image introuvable : {image}", file=sys.stderr)
        return 2
    if not os.path.isfile(args.fosread):
        print(f"fosread introuvable : {args.fosread}", file=sys.stderr)
        return 2

    fr = Fosread(args.fosread, args.lib or DEFAULT_LIBDIRS, image)

    manifest_path = outdir / "manifest.json"

    if args.dump_only:
        # Réutilise le manifeste existant pour connaître les entrées racine.
        prev = json.loads(manifest_path.read_text(encoding="utf-8"))
        tree = [Node(**{k: v for k, v in n.items() if k != "children"},
                     children=n.get("children", [])) for n in prev["tree"]]
        stats = prev["stats"]
        print(f"== Dump binaire (manifeste réutilisé) vers {outdir/'tree'} ==", file=sys.stderr)
        binary = dump_binary(fr, tree, outdir / "tree")
        print(f"== Dump : {binary['ok']} entrées racine OK, "
              f"{len(binary['failed'])} échec(s) ==", file=sys.stderr)
        rep = repair_missing(fr, tree, outdir / "tree")
        print(f"== Réparation : {rep['touched_empty']} fichiers vides créés, "
              f"{rep['reextracted']} ré-extraits, {len(rep['failed'])} échec(s) ==",
              file=sys.stderr)
        binary["repair"] = rep
        prev["binary_dump"] = binary
        manifest_path.write_text(json.dumps(prev, ensure_ascii=False, indent=2),
                                 encoding="utf-8")
        print(f"== Manifeste mis à jour : {manifest_path} ==", file=sys.stderr)
        return 0

    print(f"== Parcours de {image} ==", file=sys.stderr)
    stats = {"dirs": 0, "files": 0, "links": 0, "bytes": 0}
    tree = walk(fr, "/", stats=stats)
    print(f"== Arbre : {stats['dirs']} dossiers, {stats['files']} fichiers, "
          f"{stats['links']} liens, {stats['bytes']:,} octets "
          f"({fr.opens} lectures de l'image) ==", file=sys.stderr)

    binary = None
    if not args.manifest_only:
        print(f"== Dump binaire vers {outdir/'tree'} ==", file=sys.stderr)
        binary = dump_binary(fr, tree, outdir / "tree")
        print(f"== Dump : {binary['ok']} entrées racine OK, "
              f"{len(binary['failed'])} échec(s) ==", file=sys.stderr)
        rep = repair_missing(fr, tree, outdir / "tree")
        print(f"== Réparation : {rep['touched_empty']} fichiers vides créés, "
              f"{rep['reextracted']} ré-extraits, {len(rep['failed'])} échec(s) ==",
              file=sys.stderr)
        binary["repair"] = rep

    outdir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "image": image,
        "image_size": os.path.getsize(image),
        "stats": stats,
        "binary_dump": binary,
        "tree": [asdict(n) for n in tree],
    }
    manifest_path = outdir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2),
                             encoding="utf-8")
    print(f"== Manifeste écrit : {manifest_path} ==", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
