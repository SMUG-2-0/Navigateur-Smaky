#!/usr/bin/env python3
"""Vérifie l'extraction : compare le manifeste aux fichiers réellement présents."""
import json, os, sys, collections

OUT = sys.argv[1] if len(sys.argv) > 1 else "ALPINE_extracted"
m = json.load(open(f"{OUT}/manifest.json", encoding="utf-8"))

missing, present = [], 0

def walk(nodes):
    global present
    for n in nodes:
        if n["type"] == "dir":
            walk(n["children"])
        elif n["type"] == "file":
            p = os.path.join(OUT, "tree", *n["fos_path"].split("/"))
            if os.path.exists(p):
                present += 1
            else:
                missing.append(n)

walk(m["tree"])
print(f"presents : {present}    manquants : {len(missing)}")

ext = collections.Counter((n["smaky_ext"] or "(sans)") for n in missing)
enc = sum(n["encoded"] for n in missing)
zero = sum(n["size"] == 0 for n in missing)
nonascii = sum(any(ord(c) > 126 for c in n["name"]) for n in missing)
print(f"  encodes : {enc}    taille 0 : {zero}    noms non-ASCII : {nonascii}")
print("  extensions des manquants :", dict(ext.most_common(15)))

# Y a-t-il, dans un meme dossier, des noms qui collisionnent une fois ecrits ?
bydir = collections.defaultdict(list)
def collect(nodes, parent=""):
    for n in nodes:
        if n["type"] == "dir":
            collect(n["children"], n["fos_path"])
        elif n["type"] == "file":
            bydir[parent].append(n["name"])
collect(m["tree"])
coll = 0
for d, names in bydir.items():
    c = collections.Counter(names)
    coll += sum(v - 1 for v in c.values() if v > 1)
print(f"  doublons exacts de nom dans un meme dossier : {coll}")

print("\n  20 premiers manquants :")
for n in missing[:20]:
    print(f"   {n['fos_path']!r}  ({n['size']} o, enc={n['encoded']})")
