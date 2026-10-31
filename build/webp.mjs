// Čita širinu i visinu iz zaglavlja WebP fajla (RIFF), bez biblioteka.
// Podržava sva tri oblika: VP8 (lossy), VP8L (lossless) i VP8X (prošireni).
import fs from "node:fs";

export function webpSize(file) {
  const fd = fs.openSync(file, "r");
  const b = Buffer.alloc(30);
  let n;
  try { n = fs.readSync(fd, b, 0, 30, 0); } finally { fs.closeSync(fd); }
  if (n < 30 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("nije WebP fajl (nema RIFF/WEBP zaglavlja)");
  }
  const chunk = b.toString("ascii", 12, 16);
  if (chunk === "VP8 ") {
    // 3 bajta oznake okvira, pa start kod 9d 01 2a, pa 14-bitne dimenzije
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) throw new Error("neispravan VP8 start kod");
    return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) throw new Error("neispravan VP8L potpis");
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 };
  }
  throw new Error(`nepoznat WebP blok "${chunk}"`);
}
