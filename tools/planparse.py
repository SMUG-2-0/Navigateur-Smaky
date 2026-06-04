#!/usr/bin/env python3
"""Dump décodé d'un fichier .PLAN (Smaky, dessin vectoriel ~1985).

Big-endian, enregistrements de 16 octets (8 mots de 16 bits). Le 1er mot de
chaque enregistrement est un type/opcode :
  - 1..10        : primitives de dessin
  - 0x66 / 0x67  : début / fin d'objet
  - 0xFFFA..FFFF : sections de bibliothèque (palettes)

Voir docs/plan-format.md. Usage : python3 planparse.py fichier.plan
"""
import struct
import sys


def signed(w):
    return w - 0x10000 if w >= 0x8000 else w


def parse(path):
    data = open(path, 'rb').read()
    n = len(data) // 16
    print(f"# {path}  ({len(data)} octets, {n} enregistrements)")
    for i in range(0, len(data) - 15, 16):
        w = struct.unpack('>8H', data[i:i + 16])
        op = signed(w[0])
        asc = ''.join(chr(c) if 32 <= c < 127 else '.' for c in data[i:i + 16])
        rest = ' '.join(f'{signed(x):6d}' for x in w[1:])
        print(f"{i:04x} op={op:6d} | {rest} | {asc}")


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit("usage: planparse.py fichier.plan")
    parse(sys.argv[1])
