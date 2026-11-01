// Konvertor slika u pregledniku (PANEL.md 5, "Konvertor").
// Ulaz: JPG, PNG, WEBP (HEIC samo ako ga pregledač zna otvoriti).
// Izlaz: WebP široko 400, 800 i 1600 px (nikad šire od originala) i "og" JPEG 1200×630.
// Jedna slika u isto vrijeme; memorija se oslobađa poslije svake (bitmap.close, canvas 0×0).

export const WIDTHS = [400, 800, 1600];
export const OG = { w: 1200, h: 630 };
const WEBP_Q = 0.8;
const OG_Q = 0.8, OG_MIN_Q = 0.4, OG_MAX_BYTES = 250 * 1024;
const OG_MAX_UPSCALE = 2; // og se ne povećava više od 2×
const OG_BG = "#f5f3ec"; // krem iz palete, ako mala slika ne pokrije cijeli og

export const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif";
export const NO_WEBP_MSG = "Ovaj pregledač ne pravi WebP. Otvori panel u Chromeu, Edgeu, Samsung Internetu ili Firefoxu.";

class ConvertError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
function freeCanvas(c) { c.width = 0; c.height = 0; }
const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));

// Detekcija mogućnosti (ne po nazivu pregledača): probni canvas mora dati pravi image/webp.
let webpOk = null;
export async function canMakeWebp() {
  if (webpOk !== null) return webpOk;
  try {
    const c = makeCanvas(2, 2);
    c.getContext("2d").fillRect(0, 0, 2, 2);
    const b = await toBlob(c, "image/webp", WEBP_Q);
    freeCanvas(c);
    webpOk = !!b && b.type === "image/webp";
  } catch { webpOk = false; }
  return webpOk;
}

export async function sha256Hex(buf) {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Iscrta bitmap u canvas zadane veličine (za smanjivanje velikih slika ide u koracima
// po pola, da rezultat bude oštar i bez nazubljenosti).
function drawScaled(bitmap, w, h) {
  let src = bitmap, sw = bitmap.width, sh = bitmap.height, tmp = null;
  while (sw / 2 >= w && sh / 2 >= h) {
    const nw = Math.round(sw / 2), nh = Math.round(sh / 2);
    const c = makeCanvas(nw, nh);
    const cx = c.getContext("2d");
    cx.imageSmoothingQuality = "high";
    cx.drawImage(src, 0, 0, nw, nh);
    if (tmp) freeCanvas(tmp);
    tmp = c; src = c; sw = nw; sh = nh;
  }
  const out = makeCanvas(w, h);
  const ctx = out.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  if (tmp) freeCanvas(tmp);
  return out;
}

// file: File iz <input type=file>. Vraća { hash, w, h, variants, warnings }.
// variants: { "400": {blob, w, h, type}, "800": …, "1600": …, "og": {blob, w:1200, h:630, type} }
export async function convertImage(file, onStep = () => {}) {
  if (!(await canMakeWebp())) throw new ConvertError(NO_WEBP_MSG, "no-webp");
  const warnings = [];
  onStep("čitam");
  const buf = await file.arrayBuffer();
  const hash = await sha256Hex(buf);

  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([buf], { type: file.type || "" }), { imageOrientation: "from-image" });
  } catch {
    const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
    throw new ConvertError(heic
      ? "Ovaj pregledač ne zna otvoriti HEIC sliku. Na telefonu je pošalji kao JPG (ili uključi \"Najkompatibilnije\" u postavkama kamere) pa probaj ponovo."
      : "Ovo nije slika koju pregledač zna otvoriti. Koristi JPG, PNG ili WEBP.", "decode");
  }
  const W = bitmap.width, H = bitmap.height;
  const variants = {};
  try {
    for (const target of WIDTHS) {
      onStep(`pravim ${target}`);
      const w = Math.min(target, W); // bez povećavanja
      const h = Math.max(1, Math.round((H * w) / W));
      const c = drawScaled(bitmap, w, h);
      const blob = await toBlob(c, "image/webp", WEBP_Q);
      freeCanvas(c);
      if (!blob || blob.type !== "image/webp") throw new ConvertError(NO_WEBP_MSG, "no-webp");
      variants[String(target)] = { blob, w, h, type: "image/webp" };
    }

    // og: 1200×630, izrezano na sredinu (cover). Mala slika se povećava najviše 2×;
    // ako ni tada ne pokrije, ostatak je krem pozadina i stiže upozorenje.
    onStep("pravim og");
    const cover = Math.max(OG.w / W, OG.h / H);
    const scale = Math.min(cover, OG_MAX_UPSCALE);
    if (cover > OG_MAX_UPSCALE) warnings.push("Slika je mala za pregled linka (WhatsApp, Facebook). Bolje je dodati veću fotografiju.");
    const dw = Math.round(W * scale), dh = Math.round(H * scale);
    const og = makeCanvas(OG.w, OG.h);
    const octx = og.getContext("2d");
    octx.fillStyle = OG_BG; octx.fillRect(0, 0, OG.w, OG.h);
    octx.imageSmoothingQuality = "high";
    if (scale < 1) {
      const scaled = drawScaled(bitmap, dw, dh);
      octx.drawImage(scaled, Math.round((OG.w - dw) / 2), Math.round((OG.h - dh) / 2));
      freeCanvas(scaled);
    } else {
      octx.drawImage(bitmap, Math.round((OG.w - dw) / 2), Math.round((OG.h - dh) / 2), dw, dh);
    }
    let q = OG_Q, ogBlob = await toBlob(og, "image/jpeg", q);
    while (ogBlob && ogBlob.size > OG_MAX_BYTES && q > OG_MIN_Q + 1e-9) {
      q = Math.round((q - 0.05) * 100) / 100;
      ogBlob = await toBlob(og, "image/jpeg", q);
    }
    freeCanvas(og);
    if (!ogBlob || ogBlob.type !== "image/jpeg") throw new ConvertError("Pregledač nije napravio JPEG za pregled linka.", "no-jpeg");
    variants.og = { blob: ogBlob, w: OG.w, h: OG.h, type: "image/jpeg", quality: q };
  } finally {
    bitmap.close();
  }
  return { hash, w: W, h: H, variants, warnings };
}

// Putanje u Storageu za jednu sliku
export const storagePaths = (imageId) => ({
  "400": `vinograd/img/${imageId}/400.webp`,
  "800": `vinograd/img/${imageId}/800.webp`,
  "1600": `vinograd/img/${imageId}/1600.webp`,
  og: `vinograd/img/${imageId}/og.jpg`,
});
