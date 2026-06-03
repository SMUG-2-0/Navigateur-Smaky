// Décodage du texte Smaky -> Unicode.
//
// Fidèle à FOSfat (libfosfat/ascii.c) : table Smaky -> ISO-8859-1 (Latin-1).
// - octet 13 (CR) = fin de ligne Smaky -> '\n'
// - octets 15..31 = lettres accentuées (voir table)
// - octets > 127 = non représentables -> ignorés
// Latin-1 -> Unicode est l'identité (String.fromCharCode sur le code Latin-1).

// 128 entrées (index = octet Smaky, valeur = code ISO-8859-1).
const SMAKY2ISO = [
  0, 1, 2, 3, 4, 5, 6, 7,
  8, 9, 10, 11, 12, 13, 14, 0xFC,
  0xE0, 0xE2, 0xE9, 0xE8, 0xEB, 0xEA, 0xEF, 0xEE,
  0xF4, 0xF9, 0xFB, 0xE4, 0xF6, 0xE7, 0xAB, 0xBB,
  ...Array.from({ length: 96 }, (_, i) => 32 + i), // 32..127 : ASCII identité
];

// Décode un Uint8Array de texte Smaky en chaîne JS.
function decodeSmakyText(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b > 127) continue;          // non représentable
    if (b === 13) { out += "\n"; continue; } // CR Smaky -> saut de ligne
    const c = SMAKY2ISO[b];
    if (c === 9 || c === 10) { out += String.fromCharCode(c); continue; } // tab, LF
    if (c < 32) continue;           // autres caractères de contrôle : ignorés
    out += String.fromCharCode(c);
  }
  return out;
}

// Heuristique : proportion d'octets « texte » (utile pour deviner si binaire).
function textRatio(bytes, sample = 4096) {
  const n = Math.min(bytes.length, sample);
  if (n === 0) return 1;
  let printable = 0;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 13 || b === 10 || b === 9) { printable++; continue; }
    if (b >= 15 && b <= 31) { printable++; continue; } // accents Smaky
    if (b >= 32 && b <= 126) { printable++; continue; }
  }
  return printable / n;
}

export { decodeSmakyText, textRatio, SMAKY2ISO };
