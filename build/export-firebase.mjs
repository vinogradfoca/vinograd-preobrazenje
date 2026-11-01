#!/usr/bin/env node
// Pravi data/firebase-import.json iz data/seed.json, za uvoz u Firebase
// Realtime Database (konzola: ⋮ → Import JSON, na korijenu baze).
//
//   node build/export-firebase.mjs
//
// Oblik:
//   { "vinograd": { settings, pages, varieties: { "<slug>": {...} }, images: {} },
//     "admins":   { "<uid>": true } }
//
// - Ključ sorte je njen slug.
// - Slike sorte su nazivi fajlova (npr. "viktor-3.webp"); čvor images je prazan
//   do Koraka 4. Naslovna slika je takođe naziv fajla, a njen opis (alt) je u
//   pages/home/heroAlt, jer images čvor još ne postoji.
// - Polja s null se izostavljaju (Firebase ih ne čuva), kao i prazni objekti i nizovi.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED = path.join(ROOT, "data", "seed.json");
const OUT = path.join(ROOT, "data", "firebase-import.json");

// Admini (UID nije tajna). Novi admin se dodaje u konzoli: admins/<uid> = true.
const ADMIN_UIDS = ["aXWKivZS0ANh0T3CaXp9vvY5Nt42"];

function fail(msg) {
  console.error("IZVOZ NIJE USPIO: " + msg);
  process.exit(1);
}

// Izbacuje null i prazne objekte/nizove (Firebase ih ne čuva).
function clean(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) {
    const a = v.map(clean).filter((x) => x !== undefined);
    return a.length ? a : undefined;
  }
  if (typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      const c = clean(x);
      if (c !== undefined) o[k] = c;
    }
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}

let seed;
try { seed = JSON.parse(fs.readFileSync(SEED, "utf8")); } catch (e) { fail(`data/seed.json: ${e.message}`); }
const db = seed && seed.vinograd;
if (!db || !db.settings || !db.pages || !db.varieties) fail("data/seed.json mora imati vinograd.settings, pages i varieties");
const images = db.images || {};
const fileOf = (id, where) => {
  const im = images[id];
  if (!im || !im.file) fail(`${where}: slika "${id}" nema fajl u images/`);
  return im.file;
};

// pages: naslovna slika postaje naziv fajla, a njen alt ide u heroAlt
const pages = JSON.parse(JSON.stringify(db.pages));
if (pages.home && pages.home.heroImage) {
  const id = pages.home.heroImage;
  pages.home.heroImage = fileOf(id, "pages/home.heroImage");
  pages.home.heroAlt = images[id].alt || "";
}

// sorte: ključ = slug, slike = nazivi fajlova
const varieties = {};
for (const [key, v] of Object.entries(db.varieties)) {
  if (!v || !v.slug) fail(`varieties/${key}: nema slug`);
  if (varieties[v.slug]) fail(`slug "${v.slug}" se ponavlja`);
  varieties[v.slug] = { ...v, images: (v.images || []).map((id) => fileOf(id, `varieties/${key}.images`)) };
}

const out = {
  vinograd: {
    ...clean({ settings: db.settings, pages, varieties }),
    images: {},
  },
  admins: Object.fromEntries(ADMIN_UIDS.map((uid) => [uid, true])),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");

const n = Object.keys(out.vinograd.varieties).length;
console.log(`Izvezeno u data/firebase-import.json: ${n} sorti, ${ADMIN_UIDS.length} admin, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
console.log("Uvoz: Firebase konzola → Realtime Database → ⋮ → Import JSON (na korijenu baze). Uvoz zamjenjuje sve što je u bazi.");
