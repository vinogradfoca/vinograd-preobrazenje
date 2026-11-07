// Pokretanje: node tests/images.test.mjs
// panel/images.js: dimenzije iz zaglavlja (bez dekodiranja) i granica 40 MP / 25 MB prije pretvaranja.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { headerSize, sizeProblem, TOO_BIG_MSG, MAX_BYTES } from "../panel/images.js";
import { webpSize } from "../build/webp.mjs";

const ok = (c, m) => { console.log((c ? "PROŠLO" : "PALO  ") + " " + m); if (!c) process.exitCode = 1; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const be16 = (v) => [(v >> 8) & 255, v & 255], be32 = (v) => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
const le16 = (v) => [v & 255, (v >> 8) & 255], le24 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255];
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const buf = (a) => new Uint8Array(a).buffer;

// PNG: potpis + IHDR
const png = (w, h) => buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...ascii("IHDR"), ...be32(w), ...be32(h), 8, 2, 0, 0, 0]);
// JPEG: SOI, APP1 (EXIF, s lažnim SOF bajtovima unutra da se vidi da se segment preskače), DQT, SOF0
const jpeg = (w, h, sof = 0xc0) => {
  const exif = [...ascii("Exif"), 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 1, 0, 1];
  return buf([0xff, 0xd8, 0xff, 0xe1, ...be16(exif.length + 2), ...exif, 0xff, 0xdb, 0, 4, 0, 0, 0xff, sof, 0, 17, 8, ...be16(h), ...be16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
};
const riff = (chunk) => [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...chunk];
const vp8x = (w, h) => buf(riff([...ascii("VP8X"), 10, 0, 0, 0, 0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]));
const vp8l = (w, h) => { const v = ((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14); return buf(riff([...ascii("VP8L"), 5, 0, 0, 0, 0x2f, v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255, 0, 0, 0, 0, 0, 0])); };
const vp8 = (w, h) => buf(riff([...ascii("VP8 "), 10, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h)]));

ok(same(headerSize(png(8000, 5001)), { w: 8000, h: 5001 }), "PNG 8000×5001");
ok(same(headerSize(jpeg(4032, 3024)), { w: 4032, h: 3024 }), "JPEG 4032×3024 (SOF0 poslije EXIF segmenta)");
ok(same(headerSize(jpeg(8160, 6120, 0xc2)), { w: 8160, h: 6120 }), "JPEG progresivni (SOF2) 8160×6120");
ok(same(headerSize(vp8x(7000, 6000)), { w: 7000, h: 6000 }), "WebP VP8X 7000×6000");
ok(same(headerSize(vp8l(1200, 900)), { w: 1200, h: 900 }), "WebP VP8L 1200×900");
ok(same(headerSize(vp8(1152, 1536)), { w: 1152, h: 1536 }), "WebP VP8 1152×1536");
ok(headerSize(buf([0, 0, 0, 24, ...ascii("ftypheic"), 0, 0, 0, 0])) === null, "HEIC: nije prepoznat (provjera ide poslije dekodiranja)");
ok(headerSize(buf([0xff, 0xd8, 0xff])) === null, "odsječen JPEG: null, bez greške");

// prave WebP slike iz data/seed-img: iste dimenzije kao build/webp.mjs
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "seed-img");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".webp"));
const wrong = files.filter((f) => { const b = fs.readFileSync(path.join(dir, f)); return !same(headerSize(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)), webpSize(path.join(dir, f))); });
ok(files.length > 0 && !wrong.length, `${files.length} slika iz data/seed-img: iste dimenzije kao build${wrong.length ? " (razlika: " + wrong.join(", ") + ")" : ""}`);

// granica: 40 MP i 25 MB
const file = (ab, size) => ({ size: size ?? ab.byteLength, arrayBuffer: async () => ab });
ok(await sizeProblem(file(jpeg(4032, 3024))) === "", "12 MP JPEG prolazi");
ok(await sizeProblem(file(jpeg(8000, 5000))) === "", "tačno 40 MP prolazi");
ok(await sizeProblem(file(jpeg(8000, 5001))) === TOO_BIG_MSG, "40,008 MP JPEG odbijen");
ok(await sizeProblem(file(png(10000, 10000))) === TOO_BIG_MSG, "100 MP PNG odbijen");
ok(await sizeProblem(file(jpeg(4000, 3000), MAX_BYTES + 1)) === TOO_BIG_MSG, "fajl veći od 25 MB odbijen i kad je malih dimenzija");
ok(await sizeProblem(file(jpeg(4000, 3000), MAX_BYTES)) === "", "tačno 25 MB prolazi");
ok(TOO_BIG_MSG === "Slika je prevelika (najviše 40 MP i 25 MB). Smanji je pa pokušaj ponovo.", "tekst poruke");
