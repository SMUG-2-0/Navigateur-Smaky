/*
 * Navigateur Smaky — Copyright (C) 2026 Epsitec SA, Pierre-Yves Rochat.
 * Logiciel libre sous GNU General Public License v3 — voir le fichier LICENSE.
 *
 * Ce module est un portage en JavaScript de libfosgra (projet FOSfat,
 * Mathieu Schroeter), lui-même sous GPL v3.
 */

// Décodage des images Smaky .IMAGE (1 bit/pixel) et .COLOR (4 bits/pixel).
//
// Porté de FOSfat (libfosgra/fosgra.c, bmp.c) et validé au pixel près contre les
// BMP produits par `fosread -i`. Produit un tableau RGBA prêt pour un <canvas>.
//
// En-tête 32 octets : typ, cod, bip, dir, dlx (largeur, big-endian), dly (hauteur),
// nbb (taille des données codées). .COLOR : palette de 192 octets après l'en-tête.
// Données pixel éventuellement compressées en RLE (cod == 0x04), décodées de bas
// en haut ; le résultat est en ordre haut→bas, comme attendu par le canvas.

// Décompression RLE (cf. fosgra_image_decod).
function imageDecod(buf, size, offset, length, ucodSize) {
  const dec = new Uint8Array(length);
  let idx = buf[size - 2] >> buf[size - 1]; // premier index
  let cnt = 8 - buf[size - 1];
  size -= 3;
  let it = length - 1;
  let len = length;
  let ucod = ucodSize;
  while (size >= 0 && len > 0) {
    if (cnt === 0) { idx = buf[size]; cnt = 8; size--; continue; }
    if (idx & 1) {                       // objet codé : compteur + motif
      let l = buf[size - 1] ? buf[size - 1] : 256; // 0x00 == 256
      while (l && len > 0) {
        if (ucod <= offset + len) { dec[it] = buf[size]; len--; it--; }
        l--; ucod--;
      }
      size--;
    } else {                             // objet normal : un octet
      if (ucod <= offset + len) { dec[it] = buf[size]; len--; it--; }
      ucod--;
    }
    idx >>= 1; cnt--; size--;
  }
  return dec;
}

// Décode un fichier .IMAGE/.COLOR (Uint8Array) -> { width, height, bpp, rgba }.
// Renvoie null si l'en-tête n'est pas une image valide.
function decodeImage(bytes, ext) {
  const h = (ext === "image" && bytes[0] === 0x82) ? 256 : 0; // en-tête BIN éventuel
  const typ = bytes[h], cod = bytes[h + 1], bip = bytes[h + 2], dir = bytes[h + 3];
  const dlx = (bytes[h + 4] << 8) | bytes[h + 5];
  const dly = (bytes[h + 6] << 8) | bytes[h + 7];
  const nbb = ((bytes[h + 8] << 24) | (bytes[h + 9] << 16) | (bytes[h + 10] << 8) | bytes[h + 11]) >>> 0;

  if (![0x81, 0x82, 0x01].includes(typ) || ![1, 4].includes(bip)
      || dir !== 2 || dlx % 8 !== 0 || dlx === 0 || dly === 0) return null;

  const dataOff = 32 + (bip === 1 && typ === 0x01 ? 256 : 0) + (bip === 4 ? 192 : 0);
  const ucod = bip === 4 ? (dlx / 2 * dly) : (dlx / 8 * dly);
  const px = cod === 0x04
    ? imageDecod(bytes.subarray(dataOff, dataOff + nbb), nbb, 0, ucod, ucod)
    : bytes.subarray(dataOff, dataOff + ucod);

  let pal = null;
  if (bip === 4) {
    pal = [];
    for (let i = 0; i < 16; i++) {
      const e = 32 + 32 + i * 10; // 32 (en-tête) + 32 (undef) + 10 octets/entrée
      pal.push([bytes[e + 4], bytes[e + 6], bytes[e + 8]]); // R, G, B
    }
  }

  const rgba = new Uint8ClampedArray(dlx * dly * 4);
  let o = 0;
  if (bip === 1) {
    const bpr = (dlx + 7) >> 3;
    for (let y = 0; y < dly; y++)
      for (let x = 0; x < dlx; x++) {
        const bit = (px[y * bpr + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit ? 0 : 255; // 1 = noir, 0 = blanc
        rgba[o++] = v; rgba[o++] = v; rgba[o++] = v; rgba[o++] = 255;
      }
  } else {
    const bpr = (dlx + 1) >> 1;
    for (let y = 0; y < dly; y++)
      for (let x = 0; x < dlx; x++) {
        const byte = px[y * bpr + (x >> 1)];
        const nib = (x & 1) ? (byte & 0xF) : (byte >> 4);
        const c = pal[nib];
        rgba[o++] = c[0]; rgba[o++] = c[1]; rgba[o++] = c[2]; rgba[o++] = 255;
      }
  }
  return { width: dlx, height: dly, bpp: bip, rgba };
}

export { decodeImage };
