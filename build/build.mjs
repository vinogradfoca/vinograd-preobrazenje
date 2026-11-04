#!/usr/bin/env node
// Izgradnja statičkog sajta u dist/.
//
//   node build/build.mjs --seed     čita data/seed.json
//   node build/build.mjs --db       čita Firebase bazu (GET <databaseURL>/vinograd.json, bez prijave)
//
// Adresa baze je u firebase-config.json (databaseURL). Za provjeru se može dati
// druga adresa: --db-url=<adresa koja vraća isti JSON kao /vinograd.json>, a za
// Storage --storage-url=<adresa umjesto https://firebasestorage.googleapis.com>.
//
// Čist Node, bez npm paketa. Pri bilo kojoj grešci u podacima izlazi s kodom 1
// i ne ostavlja polovičan dist/.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createEngine, escapeHtml } from "./template.mjs";
import { webpSize } from "./webp.mjs";
import { toFirebaseShape } from "./firebase-shape.mjs";
import { uputstvoHtml } from "./uputstvo.mjs";
import { snapshot as publishedSnapshot } from "../panel/changes.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const TPL = path.join(ROOT, "templates");
const SEED = path.join(ROOT, "data", "seed.json");
const SEED_IMG = path.join(ROOT, "data", "seed-img");
const FIREBASE_CONFIG = path.join(ROOT, "firebase-config.json");
const PANEL = path.join(ROOT, "panel");
const HEADERS = path.join(ROOT, "_headers");
const UPUTSTVO = path.join(ROOT, "docs", "uputstvo-za-panel.md");

const warnings = [];
const warn = (m) => warnings.push(m);

class BuildError extends Error {
  constructor(list) { super(list.join("\n")); this.list = list; }
}

// ---------------------------------------------------------------- pomoćne
const KIND = { sapling: "Sadnica", cutting: "Reznica" };
const COLORS = { Bijela: "w", Crna: "b", Crvena: "r", "Za provjeru": "x" };
const CHECK = "Za provjeru";
// Redoslijed opcija u filterima (vrijednosti kojih nema u podacima se ne prikazuju)
const ORDER = {
  color: ["Bijela", "Crna", "Crvena", CHECK],
  ripen: ["Ultra rana", "Rana", "Srednje rana", "Kasna", CHECK],
  type: ["Stona", "Besjemena", "Vinska"],
};
// Osobine sorte (facts) i njihovi nazivi na sajtu
const FACTS = [
  ["origin", "Porijeklo"], ["author", "Autor"], ["maturity", "Vrijeme zrenja"],
  ["clusterWeight", "Masa grozda"], ["berryWeight", "Masa bobice"], ["berrySize", "Veličina bobice"],
  ["frost", "Otpornost na mraz"], ["disease", "Otpornost na bolesti"], ["taste", "Ukus"],
];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const isStr = (v) => typeof v === "string" && v.trim() !== "";
const KM = (n) => n.toFixed(2).replace(".", ",") + " KM";
const telHref = (p) => "tel:" + p.replace(/[^\d+]/g, "");
const orderable = (o) => o.enabled && (o.qty === null || o.qty > 0);
const stockText = (o) => (o.qty === 0 ? "Nema na stanju" : o.qty === null ? "Na upit" : "Dostupno: " + o.qty);
const priceText = (o) => (o.price == null ? "Cijena na upit" : KM(o.price));
const sorti = (n) => {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return n + " sorta";
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return n + " sorte";
  return n + " sorti";
};
function clip(text, max = 155) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(" ") > 60 ? cut.lastIndexOf(" ") : cut.length).replace(/[\s,.;:–-]+$/, "") + "…";
}
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16));
const hash = (buf) => crypto.createHash("sha256").update(buf).digest("hex").slice(0, 10);

// ---------------------------------------------------------------- ulaz
function readArgs() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--seed" && a !== "--db" && !a.startsWith("--db-url=") && !a.startsWith("--storage-url="));
  if (unknown.length) throw new BuildError([`Nepoznata opcija: ${unknown.join(" ")}`]);
  const seed = args.includes("--seed"), db = args.includes("--db");
  if (seed === db) throw new BuildError(["Izaberite izvor podataka: node build/build.mjs --seed (data/seed.json) ili --db (Firebase baza)"]);
  const urlArg = args.find((a) => a.startsWith("--db-url="));
  if (urlArg && !db) throw new BuildError(["--db-url ide samo uz --db"]);
  const stArg = args.find((a) => a.startsWith("--storage-url="));
  if (stArg && !db) throw new BuildError(["--storage-url ide samo uz --db"]);
  return { source: db ? "db" : "seed", dbUrl: urlArg ? urlArg.slice("--db-url=".length) : null, storageUrl: stArg ? stArg.slice("--storage-url=".length).replace(/\/+$/, "") : null };
}

// ---------------------------------------------------------------- čitanje baze
// GET <databaseURL>/vinograd.json, javno čitanje, bez prijave i bez npm paketa.
async function loadDb(urlOverride) {
  let url = urlOverride;
  if (!url) {
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(FIREBASE_CONFIG, "utf8")); } catch (e) { throw new BuildError([`Ne mogu pročitati firebase-config.json: ${e.message}`]); }
    if (!isStr(cfg.databaseURL) || !/^https:\/\//.test(cfg.databaseURL)) throw new BuildError(["firebase-config.json: databaseURL nedostaje ili ne počinje sa https://"]);
    url = cfg.databaseURL.replace(/\/+$/, "") + "/vinograd.json";
  }
  let res, text;
  try {
    res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30000) });
    text = await res.text();
  } catch (e) {
    throw new BuildError([`Baza nije dostupna (${url}): ${e.cause ? e.cause.code || e.cause.message : e.message}. Sajt ostaje na prethodnoj verziji.`]);
  }
  const short = text.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 ? " Provjerite da pravila baze dozvoljavaju javno čitanje čvora vinograd." : "";
    throw new BuildError([`Baza je vratila grešku ${res.status} (${url}): ${short}.${hint} Sajt ostaje na prethodnoj verziji.`]);
  }
  if (!text.trim()) throw new BuildError([`Baza je vratila prazan odgovor (${url}). Sajt ostaje na prethodnoj verziji.`]);
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new BuildError([`Odgovor baze nije ispravan JSON (${url}): ${e.message}. Sajt ostaje na prethodnoj verziji.`]); }
  if (data === null || typeof data !== "object" || !Object.keys(data).length) {
    throw new BuildError([`Baza je prazna (${url} vraća ${text.trim().slice(0, 20) || "prazan odgovor"}). Podaci se uvoze iz data/firebase-import.json. Sajt ostaje na prethodnoj verziji.`]);
  }
  const db = normalizeDb(data);
  // sirovi podaci (oblik iz baze) za snimak objavljenog stanja, panel/objavljeno.json
  Object.defineProperty(db, "raw", { value: data });
  return db;
}

// Firebase ne čuva null, prazne nizove ni prazne objekte, a nizove može vratiti
// kao objekat s ključevima "0", "1", … ili kao niz s rupama. Ovdje se podaci iz
// baze vraćaju u isti oblik kao data/seed.json, pa ostatak builda radi isto.
const arr = (v) => {
  if (Array.isArray(v)) return v.filter((x) => x != null);
  if (v && typeof v === "object") {
    return Object.keys(v).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => v[k]).filter((x) => x != null);
  }
  return [];
};
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const txt = (v) => (typeof v === "string" ? v : "");
const num = (v) => (typeof v === "number" ? v : null);

function normalizeDb(raw) {
  const images = {};
  const dbImages = obj(raw.images);
  const imageId = (file, alt) => {
    const id = file.replace(/\.webp$/i, "");
    if (!images[id]) images[id] = { file, alt: txt(obj(dbImages[id]).alt) || alt, w: null, h: null };
    return id;
  };

  const s = obj(raw.settings);
  const settings = { ...s };
  for (const k of ["name", "phone", "phoneIntl", "email", "address", "mapUrl", "siteUrl"]) settings[k] = txt(s[k]);

  const P = obj(raw.pages);
  const h = obj(P.home), k = obj(P.kako), c = obj(P.kontakt);
  const heroFile = txt(h.heroImage);
  const pages = {
    home: {
      eyebrow: txt(h.eyebrow), title: txt(h.title), text: txt(h.text),
      heroImage: heroFile ? imageId(heroFile, txt(h.heroAlt)) : "",
      seoTitle: txt(h.seoTitle), seoDescription: txt(h.seoDescription),
    },
    kako: {
      title: txt(k.title), intro: txt(k.intro),
      steps: arr(k.steps).map((st) => ({ title: txt(obj(st).title), text: txt(obj(st).text) })),
      seoTitle: txt(k.seoTitle), seoDescription: txt(k.seoDescription),
    },
    kontakt: { title: txt(c.title), about: txt(c.about), seoTitle: txt(c.seoTitle), seoDescription: txt(c.seoDescription) },
  };

  // Stavka niza slika sorte je ili imageId iz vinograd/images (nova slika iz panela, u Storageu)
  // ili stari naziv fajla iz data/seed-img (npr. "viktor-3.webp"). Redoslijed ostaje kakav je u nizu.
  const varietyImages = (key, name, refs) => {
    const out = [];
    for (const r of refs) {
      const dbi = dbImages[r];
      if (dbi && typeof dbi === "object" && !/\.webp$/i.test(r)) {
        if (dbi.source === "web" && dbi.webApproved !== true) {
          warn(`varieties/${key}: slika ${r} je sa interneta (source "web") i nije odobrena (webApproved), pa se ne objavljuje.`);
          continue;
        }
        if (!images[r]) images[r] = { remote: true, alt: txt(dbi.alt) || "Grozd sorte " + name, w: num(dbi.w), h: num(dbi.h), variants: obj(dbi.variants) };
        out.push(r);
      } else if (/\.webp$/i.test(r)) {
        out.push(imageId(r, "Grozd sorte " + name));
      } else {
        warn(`varieties/${key}: slika "${r}" ne postoji u vinograd/images (možda je obrisana), pa je preskočena.`);
      }
    }
    return out;
  };

  const kind = (o) => ({ enabled: obj(o).enabled !== false, price: num(obj(o).price), qty: num(obj(o).qty) });
  const entries = Object.entries(obj(raw.varieties))
    .sort((a, b) => (num(obj(a[1]).order) ?? Infinity) - (num(obj(b[1]).order) ?? Infinity));
  const varieties = {};
  for (const [key, v0] of entries) {
    const v = obj(v0);
    const name = txt(v.name);
    const facts = {};
    for (const [fk, fv] of Object.entries(obj(v.facts))) if (isStr(fv)) facts[fk] = fv;
    varieties[key] = {
      name, slug: txt(v.slug) || key, color: txt(v.color), ripen: txt(v.ripen), type: txt(v.type),
      order: num(v.order) ?? Number.MAX_SAFE_INTEGER,
      featured: v.featured === true,
      visible: v.visible !== false, // nedostaje = vidljiva; samo visible:false sakriva
      desc: txt(v.desc), exp: txt(v.exp), flaws: txt(v.flaws),
      facts,
      images: varietyImages(key, name, arr(v.images).filter(isStr)),
      sapling: kind(v.sapling), cutting: kind(v.cutting),
      seoTitle: txt(v.seoTitle), seoDescription: txt(v.seoDescription),
      updatedAt: v.updatedAt ?? null,
    };
  }
  return { settings, pages, varieties, images };
}

function loadSeed() {
  let raw;
  try { raw = fs.readFileSync(SEED, "utf8"); } catch (e) { throw new BuildError([`Ne mogu pročitati ${path.relative(ROOT, SEED)}: ${e.message}`]); }
  let data;
  try { data = JSON.parse(raw); } catch (e) { throw new BuildError([`data/seed.json nije ispravan JSON: ${e.message}`]); }
  if (!data || typeof data.vinograd !== "object") throw new BuildError(["data/seed.json: nedostaje korijen \"vinograd\""]);
  return data.vinograd;
}

// ---------------------------------------------------------------- validacija
function validate(db) {
  const E = [];
  const req = (obj, keys, where) => {
    if (!obj || typeof obj !== "object") { E.push(`${where}: nedostaje`); return false; }
    for (const k of keys) if (!isStr(obj[k])) E.push(`${where}.${k}: obavezno polje je prazno ili nedostaje`);
    return true;
  };

  // settings
  const s = db.settings;
  req(s, ["name", "phone", "phoneIntl", "email", "address"], "settings");
  if (s) {
    if (isStr(s.phoneIntl) && !/^\d{8,15}$/.test(s.phoneIntl)) E.push("settings.phoneIntl: samo cifre, bez + i bez vodećih nula (npr. 38765592120)");
    if (isStr(s.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email)) E.push(`settings.email: "${s.email}" nije ispravna adresa`);
    if (s.mapUrl && !/^https:\/\//.test(s.mapUrl)) E.push("settings.mapUrl: mora počinjati sa https://");
    if (s.siteUrl && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(s.siteUrl)) E.push(`settings.siteUrl: "${s.siteUrl}" mora biti puna adresa, npr. https://primjer.pages.dev`);
  }

  // images
  const images = db.images || {};
  if (typeof images !== "object") E.push("images: mora biti objekat");
  for (const [id, im] of Object.entries(images)) {
    const w = `images/${id}`;
    if (!im || typeof im !== "object") { E.push(`${w}: nije objekat`); continue; }
    if (im.remote) { // nova slika iz panela: provjera zapisa, fajlovi se preuzimaju iz Storagea
      const bad = [];
      if (!/^[A-Za-z0-9_-]+$/.test(id)) bad.push("neispravan imageId");
      for (const k of ["400", "800", "1600"]) {
        const vv = im.variants[k];
        if (!vv || !isStr(vv.path) || !(Number.isInteger(vv.w) && vv.w > 0) || !(Number.isInteger(vv.h) && vv.h > 0)) bad.push(`variants.${k} nema path, w i h`);
      }
      if (bad.length) { im._bad = true; warn(`${w}: ${bad.join(", ")}; slika je preskočena.`); }
      continue;
    }
    if (!isStr(im.alt)) E.push(`${w}.alt: obavezan opis slike (alt)`);
    if (!isStr(im.file)) { E.push(`${w}.file: nedostaje ime fajla`); continue; }
    if (im.file.includes("/") || im.file.includes("\\") || !/\.webp$/i.test(im.file)) { E.push(`${w}.file: "${im.file}" mora biti ime .webp fajla, bez foldera`); continue; }
    const fp = path.join(SEED_IMG, im.file);
    if (!fs.existsSync(fp)) { im._missing = true; continue; } // nedostajuće slike: upozorenje, ne greška
    try {
      const d = webpSize(fp);
      if (im.w != null && (im.w !== d.w || im.h !== d.h)) warn(`${w}: u bazi piše ${im.w}×${im.h}, a fajl je ${d.w}×${d.h}. Koristim dimenzije iz fajla.`);
      im._w = d.w; im._h = d.h;
    } catch (e) { E.push(`${w}: ${im.file}: ${e.message}`); }
  }
  const imgOk = (id, where) => {
    if (!isStr(id)) { E.push(`${where}: prazan ID slike`); return; }
    if (!images[id]) E.push(`${where}: slika "${id}" ne postoji u images/`);
  };

  // pages
  const p = db.pages || {};
  if (req(p.home, ["title", "text", "heroImage"], "pages/home")) {
    imgOk(p.home.heroImage, "pages/home.heroImage");
    const h = images[p.home.heroImage];
    if (h && h._missing) E.push(`pages/home.heroImage: fajl data/seed-img/${h.file} ne postoji`);
  }
  if (req(p.kako, ["title"], "pages/kako")) {
    if (!Array.isArray(p.kako.steps) || !p.kako.steps.length) E.push("pages/kako.steps: potreban je bar jedan korak");
    else p.kako.steps.forEach((st, i) => req(st, ["title", "text"], `pages/kako.steps[${i}]`));
  }
  req(p.kontakt, ["title", "about"], "pages/kontakt");

  // varieties
  const vars = db.varieties || {};
  if (!Object.keys(vars).length) E.push("varieties: nema nijedne sorte");
  const slugs = new Map();
  for (const [id, v] of Object.entries(vars)) {
    const w = `varieties/${id}`;
    if (!v || typeof v !== "object") { E.push(`${w}: nije objekat`); continue; }
    req(v, ["name", "slug", "color"], w);
    if (isStr(v.slug)) {
      if (!SLUG_RE.test(v.slug)) E.push(`${w}.slug: "${v.slug}" smije sadržati samo mala slova bez dijakritika, cifre i crtice`);
      if (slugs.has(v.slug)) E.push(`${w}.slug: "${v.slug}" već koristi sorta ${slugs.get(v.slug)}`);
      else slugs.set(v.slug, id);
    }
    if (isStr(v.color) && !COLORS[v.color]) E.push(`${w}.color: "${v.color}" mora biti Bijela, Crna, Crvena ili ${CHECK}`);
    if (v.facts != null) {
      if (typeof v.facts !== "object" || Array.isArray(v.facts)) E.push(`${w}.facts: mora biti objekat`);
      else for (const [k, val] of Object.entries(v.facts)) {
        if (!FACTS.some((f) => f[0] === k)) E.push(`${w}.facts.${k}: nepoznato polje (dozvoljeno: ${FACTS.map((f) => f[0]).join(", ")})`);
        else if (typeof val !== "string") E.push(`${w}.facts.${k}: mora biti tekst`);
      }
    }
    for (const k of ["visible", "featured"]) if (typeof v[k] !== "boolean") E.push(`${w}.${k}: mora biti true ili false`);
    if (typeof v.order !== "number" || !Number.isFinite(v.order)) E.push(`${w}.order: mora biti broj`);
    for (const k of ["ripen", "type", "desc", "exp", "flaws", "seoTitle", "seoDescription"]) {
      if (v[k] != null && typeof v[k] !== "string") E.push(`${w}.${k}: mora biti tekst`);
    }
    if (!Array.isArray(v.images)) E.push(`${w}.images: mora biti lista (može biti prazna)`);
    else v.images.forEach((im, i) => imgOk(im, `${w}.images[${i}]`));
    for (const k of Object.keys(KIND)) {
      const o = v[k];
      if (!o || typeof o !== "object") { E.push(`${w}.${k}: nedostaje`); continue; }
      if (typeof o.enabled !== "boolean") E.push(`${w}.${k}.enabled: mora biti true ili false`);
      if (o.price !== null && !(typeof o.price === "number" && o.price >= 0)) E.push(`${w}.${k}.price: broj ili null`);
      if (o.qty !== null && !(Number.isInteger(o.qty) && o.qty >= 0)) E.push(`${w}.${k}.qty: cijeli broj ili null`);
    }
  }

  const used = new Set([p.home?.heroImage, ...Object.values(vars).flatMap((v) => (Array.isArray(v?.images) ? v.images : []))]);
  for (const id of Object.keys(images)) if (!used.has(id)) warn(`images/${id}: slika se nigdje ne koristi`);
  const files = new Set(Object.values(images).map((i) => i?.file));
  if (fs.existsSync(SEED_IMG)) for (const f of fs.readdirSync(SEED_IMG)) if (!files.has(f)) warn(`data/seed-img/${f}: fajl nije upisan u images/`);

  // sorte bez ijedne postojeće slike i fajlovi koji nedostaju (build ne pada)
  const missing = [...new Set(Object.values(vars).filter((v) => v && v.visible && Array.isArray(v.images))
    .flatMap((v) => v.images).filter((id) => images[id] && images[id]._missing).map((id) => images[id].file))].sort();
  const noImg = Object.values(vars).filter((v) => v && v.visible && Array.isArray(v.images) && !v.images.some((id) => images[id] && !images[id]._missing && !images[id]._bad));
  if (noImg.length) warn(`${noImg.length} ${noImg.length % 10 === 1 && noImg.length % 100 !== 11 ? "sorta nema" : "sorti nema"} nijednu sliku (placeholder + noindex): ${noImg.map((v) => v.name).join(", ")}`);
  if (missing.length) warn(`Nedostaje ${missing.length} fajlova u data/seed-img/ (kad ih dodate, sljedeći build ih sam koristi):\n    ${missing.join("\n    ")}`);

  if (E.length) throw new BuildError(E);
}

// ---------------------------------------------------------------- model za šablone
function buildModel(db) {
  const s = db.settings;
  const siteUrl = (s.siteUrl || "").replace(/\/+$/, "");
  if (!siteUrl) warn("settings.siteUrl je prazan: canonical i og:url su izostavljeni, a og:image, sitemap.xml i schema imaju relativne adrese. Upišite adresu sajta.");
  const abs = (p) => (siteUrl ? siteUrl + p : p);

  const img = (id, altOverride) => {
    const im = db.images[id];
    const alt = altOverride ?? im.alt;
    if (im.remote) {
      // nova slika: src je 800, srcset 400/800/1600 (iste širine se ne ponavljaju), width/height iz 1600
      const v = im._v, seen = new Set();
      const srcset = ["400", "800", "1600"].map((k) => v[k]).filter((x) => !seen.has(x.w) && seen.add(x.w)).map((x) => `${x.src} ${x.w}w`).join(", ");
      return { id, src: v["800"].src, big: v["1600"].src, thumb: v["400"].src, srcset, w: v["1600"].w, h: v["1600"].h, alt, og: v.og || null };
    }
    const src = "/img/" + im.file;
    return { id, src, big: src, thumb: src, srcset: "", file: im.file, w: im._w, h: im._h, alt, og: null };
  };

  const list = Object.entries(db.varieties)
    .map(([id, v]) => ({ id, ...v }))
    .filter((v) => v.visible)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "sr"));
  if (!list.length) throw new BuildError(["Nijedna sorta nije vidljiva (visible: true). Sajt bi bio prazan."]);

  const hasPrices = list.some((v) => (v.sapling.enabled && v.sapling.price != null) || (v.cutting.enabled && v.cutting.price != null));

  const varieties = list.map((v) => {
    const kinds = Object.keys(KIND).filter((k) => v[k].enabled);
    const prices = kinds.filter((k) => orderable(v[k])).map((k) => v[k].price).filter((n) => n != null);
    const available = kinds.some((k) => orderable(v[k]));
    const images = v.images.filter((id) => !db.images[id]._missing && !db.images[id]._bad)
      .map((id, i) => ({ ...img(id), index: i, on: i === 0, label: `Fotografija ${i + 1}` }));
    const ripen = v.ripen || "", type = v.type || "";
    const facts = v.facts || {};
    return {
      id: v.id, slug: v.slug, name: v.name, url: `/sorte/${v.slug}/`,
      color: v.color, colorClass: COLORS[v.color], ripen, type,
      tag: v.color === CHECK && ripen === CHECK ? CHECK : v.color + (ripen ? " · " + ripen : ""),
      featured: v.featured,
      cover: images[0] || null, images, hasImage: images.length > 0, multiple: images.length > 1,
      facts: [["Zrenje", ripen], ["Vrsta", type]].filter((f) => f[1]).map(([label, value]) => ({ label, value })),
      props: FACTS.filter(([k]) => isStr(facts[k])).map(([k, label]) => ({ label, value: facts[k] })),
      desc: v.desc || "", exp: v.exp || "", flaws: v.flaws || "",
      hasText: !!(v.desc || v.exp || v.flaws),
      rows: kinds.map((k) => ({ key: k, label: KIND[k], stock: stockText(v[k]), price: priceText(v[k]), orderable: orderable(v[k]), max: v[k].qty == null ? "" : String(v[k].qty) })),
      hasRows: kinds.length > 0,
      sapling: v.sapling, cutting: v.cutting,
      priceSapling: v.sapling.enabled && v.sapling.price != null ? KM(v.sapling.price) : "–",
      priceCutting: v.cutting.enabled && v.cutting.price != null ? KM(v.cutting.price) : "–",
      available,
      // kartica: cijena samo kad postoji (najniža od sadnice i reznice); bez cijene nema teksta
      small: available ? (prices.length ? "od " + KM(Math.min(...prices)) : "") : "Trenutno nedostupno",
      // kartica: "Boja · Zrenje"; bez zrenja ili kad je zrenje "Za provjeru", samo boja
      line: v.color + (ripen && ripen !== CHECK ? " · " + ripen : ""),
      hasQty: kinds.some((k) => v[k].qty != null),
      search: v.name.toLowerCase(),
      seoTitle: v.seoTitle, seoDescription: v.seoDescription,
      kindsText: kinds.length === 2 ? "sadnice i reznice" : kinds[0] === "sapling" ? "sadnice" : kinds[0] === "cutting" ? "reznice" : "",
    };
  });

  // settings/showWithoutImage: kad je false, sorte bez slike nisu u katalogu, na početnoj ni u
  // cjenovniku (stranica sorte se i dalje pravi, noindex). Polje koje ne postoji = uključeno.
  const showNoImg = s.showWithoutImage !== false;
  const catalog = showNoImg ? varieties : varieties.filter((v) => v.hasImage);
  const anyQty = catalog.some((v) => v.hasQty); // filter "Samo dostupno" samo kad neka sorta ima količinu

  // izdvojene; ako nijedna nije označena, prvih 6 koje imaju sliku
  let featured = catalog.filter((v) => v.featured);
  if (!featured.length) featured = catalog.filter((v) => v.hasImage).slice(0, 6);
  if (!featured.length) featured = catalog.slice(0, 6);
  const options = (key) => {
    const vals = new Set(varieties.map((v) => v[key]).filter(Boolean));
    const known = ORDER[key].filter((x) => vals.has(x));
    return [...known, ...[...vals].filter((x) => !known.includes(x)).sort((a, b) => a.localeCompare(b, "sr"))];
  };

  const nav = (active) => [
    { href: "/", label: "Početna", key: "home" },
    { href: "/sorte/", label: "Sorte i web-shop", key: "sorte" },
    ...(hasPrices ? [{ href: "/cjenovnik/", label: "Cjenovnik", key: "cjenovnik" }] : []),
    { href: "/kako-naruciti/", label: "Kako naručiti", key: "kako" },
    { href: "/kontakt/", label: "O nama i kontakt", key: "kontakt" },
  ].map((n) => ({ ...n, on: n.key === active }));

  const hero = img(db.pages.home.heroImage);

  // Podaci za korpu: korpa je interakcija, pa JS treba naziv, cijenu i stanje svake sorte.
  const cartData = varieties.map((v) => ({
    id: v.id, name: v.name, url: v.url, img: v.cover ? v.cover.src : "", c: v.colorClass,
    sapling: { enabled: v.sapling.enabled, price: v.sapling.price, qty: v.sapling.qty },
    cutting: { enabled: v.cutting.enabled, price: v.cutting.price, qty: v.cutting.qty },
  }));

  // logo (assets/logo.webp): heš sadržaja u imenu, dimenzije iz WebP zaglavlja
  const logoSrc = path.join(ROOT, "assets", "logo.webp");
  if (!fs.existsSync(logoSrc)) throw new BuildError(["assets/logo.webp ne postoji"]);
  let logoSize;
  try { logoSize = webpSize(logoSrc); } catch (e) { throw new BuildError([`assets/logo.webp: ${e.message}`]); }
  const logo = { file: logoSrc, src: `/assets/logo.${hash(fs.readFileSync(logoSrc))}.webp`, w: logoSize.w, h: logoSize.h };

  const localBusiness = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: s.name,
    telephone: "+" + s.phoneIntl,
    email: s.email,
    address: s.address,
    image: abs(hero.src),
    logo: abs(logo.src),
    ...(siteUrl ? { url: siteUrl + "/" } : {}),
    ...(s.mapUrl ? { hasMap: s.mapUrl } : {}),
  };

  return {
    s, siteUrl, abs, hero, logo, varieties, featured, hasPrices, nav, cartData, localBusiness,
    options: { color: options("color"), ripen: options("ripen"), type: options("type") },
    catalog, anyQty,
    common: {
      hero, varieties, logo,
      site: {
        name: s.name, phone: s.phone, tel: telHref(s.phone), email: s.email, address: s.address,
        mapUrl: s.mapUrl || "", wa: "https://wa.me/" + s.phoneIntl, phoneIntl: s.phoneIntl,
      },
      shopJson: jsonForScript({ phoneIntl: s.phoneIntl, email: s.email, name: s.name, phone: s.phone, address: s.address || "" }),
    },
  };
}

// ---------------------------------------------------------------- stranice
function pages(m, db) {
  const P = db.pages;
  const name = m.s.name;
  const out = [];
  const add = (route, template, navKey, seo, data = {}) => out.push({ route, template, navKey, seo, data });

  // /
  const home = P.home;
  add("/", "home.html", "home", {
    title: home.seoTitle || home.title.replace(/\s+/g, " ") + " | " + name,
    description: home.seoDescription || clip(home.text),
    schema: [m.localBusiness],
  }, {
    home: { eyebrow: home.eyebrow || "", text: home.text, titleLines: home.title.split("\n").map((t, i) => ({ t, br: i > 0 })) },
    featured: m.featured,
    sortCount: sorti(m.catalog.length) + " u ponudi",
  });

  // /sorte/
  add("/sorte/", "sorte.html", "sorte", {
    title: "Sorte vinove loze | " + name,
    description: clip(`Katalog sorti vinove loze: ${sorti(m.catalog.length)}, sadnice i reznice. ${name}, ${m.s.address}.`),
  }, {
    total: m.catalog.length,
    resultCount: `${m.catalog.length} od ${m.catalog.length} sorti`,
    catalog: m.catalog, showAvail: m.anyQty,
    colorOptions: m.options.color, ripenOptions: m.options.ripen, typeOptions: m.options.type,
  });

  // /sorte/<slug>/
  for (const v of m.varieties) {
    const offers = ["sapling", "cutting"]
      .filter((k) => v[k].enabled && v[k].price != null)
      .map((k) => ({
        "@type": "Offer",
        name: KIND[k],
        price: v[k].price.toFixed(2),
        priceCurrency: "BAM",
        ...(v[k].qty === null ? {} : { availability: v[k].qty > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" }),
        ...(m.siteUrl ? { url: m.abs(v.url) } : {}),
      }));
    const product = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: v.name,
      ...(v.hasImage ? { image: v.images.map((i) => m.abs(i.big)) } : {}),
      ...(v.desc ? { description: clip(v.desc, 500) } : {}),
      ...(offers.length ? { offers: offers.length === 1 ? offers[0] : offers } : {}),
    };
    const colorWord = v.color === CHECK ? "" : v.color.toLowerCase() + " ";
    const fallbackDesc = `${v.name}, ${colorWord}sorta vinove loze${v.kindsText ? ": " + v.kindsText : ""}. ${name}, ${m.s.address}.`;
    add(v.url, "sorta.html", "sorte", {
      title: v.seoTitle || `${v.name}${v.kindsText ? ", " + v.kindsText : ""} | ${name}`,
      description: v.seoDescription || clip(v.desc || fallbackDesc),
      schema: [product],
      ogType: "product",
      // traka pri dnu stranice sorte
      bar: { variety: true, url: m.abs(v.url), title: v.name, text: `${v.name} – ${[v.ripen, v.color, v.type].filter((x) => x && x !== CHECK).map((x) => x.toLowerCase()).join(" ")} sorta`.replace(" –  sorta", " – sorta") },
      // pregled linka: og varijanta prve slike, ako je prva slika nova (iz panela); inače slika sa početne
      og: v.cover && v.cover.og ? v.cover.og : null,
      // stranica bez ijedne slike ostaje u katalogu, ali je noindex i nije u sitemapi dok ne dobije sliku
      noindex: !v.hasImage,
    }, { v });
  }

  // /cjenovnik/
  if (m.hasPrices) {
    add("/cjenovnik/", "cjenovnik.html", "cjenovnik", {
      title: "Cjenovnik sadnica i reznica | " + name,
      description: clip(`Cijene sadnica i reznica vinove loze. Cijene su informativne, za precizne detalje pozovite ${m.s.phone}.`),
    }, {
      // u tabeli su samo sorte s bar jednom unesenom cijenom; ostale su "na upit"
      // po nazivu, bosanski redoslijed slova (č ć dž đ š ž poslije c, d, s, z)
      priced: m.catalog.filter((v) => v.priceSapling !== "–" || v.priceCutting !== "–")
        .sort((a, b) => a.name.localeCompare(b.name, ["bs", "hr"], { sensitivity: "base" }) || a.name.localeCompare(b.name, ["bs", "hr"])),
      unpricedCount: m.catalog.filter((v) => v.priceSapling === "–" && v.priceCutting === "–").length,
    });
  } else {
    warn("Nijedna cijena nije unesena: /cjenovnik/ se ne generiše i nije u meniju.");
  }

  // /kako-naruciti/
  const kako = P.kako;
  add("/kako-naruciti/", "kako.html", "kako", {
    title: kako.seoTitle || kako.title + " | " + name,
    description: kako.seoDescription || clip(kako.intro || kako.steps.map((s) => s.title + " " + s.text).join(" ")),
  }, { kako: { title: kako.title, intro: kako.intro || "", steps: kako.steps } });

  // /kontakt/
  const k = P.kontakt;
  add("/kontakt/", "kontakt.html", "kontakt", {
    title: k.seoTitle || "O nama i kontakt | " + name,
    description: k.seoDescription || clip(k.about),
    schema: [m.localBusiness],
  }, { kontakt: { title: k.title, about: k.about } });

  // /404.html
  add("/404.html", "404.html", "", { title: "Stranica nije pronađena | " + name, description: "", noindex: true });

  return out;
}

// ---------------------------------------------------------------- slike u HTML-u
// Prva <img> na stranici: eager + fetchpriority="high" + preload u <head>.
// Sve ostale: loading="lazy" decoding="async". Svaka mora imati width, height i alt.
function finishImages(html, route) {
  let first = null;
  let i = 0;
  html = html.replace(/<img\b([^>]*)>/g, (all, attrs) => {
    for (const a of ["src", "width", "height", "alt"]) {
      if (!new RegExp(`\\s${a}="`).test(attrs)) throw new BuildError([`${route}: <img> bez atributa ${a}: ${all}`]);
    }
    if (/\sloading=/.test(attrs)) throw new BuildError([`${route}: loading se postavlja u buildu, ne u šablonu: ${all}`]);
    // logo u zaglavlju: učitava se odmah, ali ne dobija fetchpriority/preload (to ostaje prvoj slici sadržaja)
    if (/\sdata-logo\b/.test(attrs)) return `<img${attrs.replace(/\sdata-logo\b/, "")} loading="eager" decoding="async">`;
    const extra = i++ === 0 ? ' fetchpriority="high" loading="eager"' : ' loading="lazy" decoding="async"';
    if (!first) first = attrs.match(/\ssrc="([^"]+)"/)[1];
    return `<img${attrs}${extra}>`;
  });
  const preload = first ? `<link rel="preload" as="image" href="${first}" fetchpriority="high">` : "";
  return html.replace("<!--PRELOAD-->", preload);
}

// ---------------------------------------------------------------- izlaz
function routeToFile(base, route) {
  if (route.endsWith("/")) return path.join(base, route, "index.html");
  return path.join(base, route);
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

// ---------------------------------------------------------------- slike iz Storagea
// Nove slike (iz panela) su u Firebase Storageu. Build preuzima varijante koje koriste vidljive
// sorte, javnim URL-om, jednu po jednu, uz do 3 pokušaja, i snima ih u dist/img/ s hešom
// sadržaja u imenu (zato smiju biti immutable). Ako preuzimanje ne uspije, build pada.
async function fetchRetry(url, label) {
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) throw new Error("prazan fajl");
      return buf;
    } catch (e) {
      last = e;
      if (i < 3) await new Promise((r) => setTimeout(r, 500 * 2 ** (i - 1)));
    }
  }
  const why = last && last.cause ? last.cause.code || last.cause.message : last && last.message;
  throw new BuildError([`Slika ${label} se ne može preuzeti iz Storagea poslije 3 pokušaja (${why}). Sajt ostaje na prethodnoj verziji.`]);
}

async function fetchRemoteImages(db, opts, tmp) {
  const ids = new Set();
  for (const v of Object.values(db.varieties)) if (v.visible) for (const id of v.images) if (db.images[id].remote && !db.images[id]._bad) ids.add(id);
  if (!ids.size) return 0;
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(FIREBASE_CONFIG, "utf8")); } catch (e) { throw new BuildError([`Ne mogu pročitati firebase-config.json: ${e.message}`]); }
  if (!isStr(cfg.storageBucket)) throw new BuildError(["firebase-config.json: storageBucket nedostaje"]);
  const base = opts.storageUrl || "https://firebasestorage.googleapis.com";
  fs.mkdirSync(path.join(tmp, "img"), { recursive: true });
  let n = 0;
  for (const id of ids) {
    const im = db.images[id];
    im._v = {};
    for (const k of ["400", "800", "1600", "og"]) {
      const vv = im.variants[k];
      if (!vv || !isStr(vv.path)) continue; // og nije obavezan: tada se koristi slika sa početne
      const url = `${base}/v0/b/${cfg.storageBucket}/o/${encodeURIComponent(vv.path)}?alt=media`;
      const buf = await fetchRetry(url, `${id}/${k} (${vv.path})`);
      const isOg = k === "og";
      const ext = isOg ? "jpg" : "webp";
      if (isOg ? !(buf[0] === 0xff && buf[1] === 0xd8) : buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") {
        throw new BuildError([`Slika ${id}/${k} (${vv.path}) nije ${isOg ? "JPEG" : "WebP"} fajl. Sajt ostaje na prethodnoj verziji.`]);
      }
      const name = `${id}-${k}.${hash(buf)}.${ext}`;
      const file = path.join(tmp, "img", name);
      fs.writeFileSync(file, buf);
      let w = vv.w, h = vv.h;
      if (!isOg) {
        const d = webpSize(file);
        if (d.w !== w || d.h !== h) { warn(`images/${id}/variants/${k}: u bazi piše ${w}×${h}, a fajl je ${d.w}×${d.h}. Koristim dimenzije iz fajla.`); w = d.w; h = d.h; }
      }
      im._v[k] = { src: "/img/" + name, w, h };
      n++;
    }
  }
  return n;
}

// Provjera da svaki interni link i src u izlazu pokazuje na postojeći fajl.
function checkLinks(outDir) {
  const E = [];
  const exists = (p) => {
    const clean = decodeURI(p.split(/[?#]/)[0]);
    const f = path.join(outDir, clean);
    if (clean.endsWith("/")) return fs.existsSync(path.join(f, "index.html"));
    return fs.existsSync(f) && fs.statSync(f).isFile();
  };
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const file of walk(outDir).filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(file, "utf8");
    const refs = [...html.matchAll(/\s(href|src)="([^"]*)"/g)].map(([, a, u]) => [a, u]);
    for (const [, set] of html.matchAll(/\s(?:data-)?srcset="([^"]*)"/g)) for (const part of set.split(",")) refs.push(["srcset", part.trim().split(/\s+/)[0]]);
    for (const [attr, url] of refs) {
      if (!url.startsWith("/") || url.startsWith("//")) continue;
      if (!exists(url)) E.push(`${path.relative(outDir, file)}: ${attr}="${url}" ne postoji u dist/`);
    }
  }
  return E;
}

async function main() {
  const t0 = Date.now();
  const opts = readArgs();
  const db = opts.source === "db" ? await loadDb(opts.dbUrl) : loadSeed();
  console.log(`Izvor podataka: ${opts.source === "db" ? "Firebase baza" : "data/seed.json"}`);
  validate(db);

  // pripremi sve u privremeni folder, pa ga zamijeni s dist/ tek kad sve uspije
  const tmp = DIST + ".tmp";
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  const remoteFiles = await fetchRemoteImages(db, opts, tmp);
  const m = buildModel(db);

  // assets s hešom sadržaja u imenu (zato smiju biti immutable)
  const assets = {};
  for (const [key, file] of [["css", "styles.css"], ["js", "shop.js"]]) {
    const buf = fs.readFileSync(path.join(ROOT, "assets", file));
    const ext = path.extname(file);
    const name = `${path.basename(file, ext)}.${hash(buf)}${ext}`;
    writeFile(path.join(tmp, "assets", name), buf);
    assets[key] = "/assets/" + name;
  }
  writeFile(path.join(tmp, m.logo.src), fs.readFileSync(m.logo.file));

  // panel/: statičke stranice (nisu iz baze, nisu u sitemapi, imaju noindex) + javni Firebase config
  if (fs.existsSync(PANEL)) {
    fs.cpSync(PANEL, path.join(tmp, "panel"), { recursive: true });
    fs.copyFileSync(FIREBASE_CONFIG, path.join(tmp, "panel", "firebase-config.json"));
    // probni režim (/panel/?mock=1): cijeli katalog iz data/seed.json, u obliku kakav je u bazi
    let mock;
    try { mock = toFirebaseShape(JSON.parse(fs.readFileSync(SEED, "utf8")).vinograd); }
    catch (e) { throw new BuildError([`panel/mock-data.json: ${e.message}`]); }
    writeFile(path.join(tmp, "panel", "mock-data.json"), JSON.stringify(mock));
    // ekran Objavi, "Šta čeka objavu": snimak objavljenih vrijednosti, da panel zna koje polje je
    // promijenjeno (baza čuva samo vrijeme izmjene). Iz baze, ili iz seeda u obliku baze (kao mock).
    writeFile(path.join(tmp, "panel", "objavljeno.json"), JSON.stringify({ builtAt: new Date().toISOString(), ...publishedSnapshot(db.raw || mock) }));
    // ekran Pomoć: uputstvo iz docs/uputstvo-za-panel.md kao gotov HTML (bez baze)
    let help;
    try { help = uputstvoHtml(fs.readFileSync(UPUTSTVO, "utf8")); }
    catch (e) { throw new BuildError([`docs/uputstvo-za-panel.md: ${e.message}`]); }
    if (!help.sections.length) throw new BuildError(["docs/uputstvo-za-panel.md: nema nijednog odjeljka (## naslov)"]);
    writeFile(path.join(tmp, "panel", "pomoc.html"), help.html + "\n");
  }

  // podaci za korpu: jedan keširan fajl umjesto kopije u svakoj od 150+ stranica
  {
    const buf = Buffer.from(JSON.stringify(m.cartData));
    const name = `korpa.${hash(buf)}.json`;
    writeFile(path.join(tmp, "assets", name), buf);
    assets.cart = "/assets/" + name;
  }

  // slike
  const copied = new Set();
  const copyImg = (id) => {
    const im = db.images[id];
    if (im.remote || copied.has(im.file)) return; // nove slike su već preuzete iz Storagea
    fs.mkdirSync(path.join(tmp, "img"), { recursive: true });
    fs.copyFileSync(path.join(SEED_IMG, im.file), path.join(tmp, "img", im.file));
    copied.add(im.file);
  };
  copyImg(db.pages.home.heroImage);
  m.varieties.forEach((v) => v.images.forEach((i) => copyImg(i.id)));

  // panel/manifest.json: sličice za panel dok slike nisu u bazi (Korak 4).
  // images: ključ sorte -> putanje postojećih slika u /img/ (i za sakrivene sorte, pa se njihove slike kopiraju)
  // published: ključevi sorti koje imaju stranicu na ovoj verziji sajta (za dugme Podijeli)
  if (fs.existsSync(PANEL)) {
    const manifest = { images: {}, published: m.varieties.map((v) => v.id) };
    for (const [key, v] of Object.entries(db.varieties)) {
      const ids = (Array.isArray(v && v.images) ? v.images : []).filter((id) => db.images[id] && db.images[id].file && !db.images[id]._missing);
      ids.forEach(copyImg);
      if (ids.length) manifest.images[key] = ids.map((id) => "/img/" + db.images[id].file);
    }
    writeFile(path.join(tmp, "panel", "manifest.json"), JSON.stringify(manifest));
  }

  const engine = createEngine((name) => fs.readFileSync(path.join(TPL, name), "utf8"));
  const list = pages(m, db);

  for (const pg of list) {
    const isPage = pg.route.endsWith("/");
    const content = engine.render(pg.template, { ...m.common, ...pg.data });
    const seo = {
      title: pg.seo.title,
      description: pg.seo.description,
      canonical: m.siteUrl && isPage && !pg.seo.noindex ? m.siteUrl + pg.route : "",
      ogType: pg.seo.ogType || "website",
      ogImage: m.abs(pg.seo.og ? pg.seo.og.src : m.hero.src),
      ogImageW: pg.seo.og ? pg.seo.og.w : m.hero.w,
      ogImageH: pg.seo.og ? pg.seo.og.h : m.hero.h,
      noindex: !!pg.seo.noindex,
      schema: (pg.seo.schema || []).map(jsonForScript),
    };
    let html = engine.render("layout.html", { ...m.common, seo, assets, nav: m.nav(pg.navKey), content, bar: pg.seo.bar || { variety: false } });
    html = finishImages(html, pg.route);
    writeFile(routeToFile(tmp, pg.route), html);
  }

  // sitemap.xml, robots.txt, build.json
  const now = new Date().toISOString();
  // u sitemapi su samo indeksabilne stranice; sorta bez slike je noindex dok ne dobije sliku
  const urls = list.filter((p) => p.route.endsWith("/") && !p.seo.noindex).map((p) => `  <url><loc>${escapeHtml(m.abs(p.route))}</loc></url>`);
  writeFile(path.join(tmp, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);
  writeFile(path.join(tmp, "robots.txt"), `User-agent: *\nAllow: /\n${m.siteUrl ? `\nSitemap: ${m.siteUrl}/sitemap.xml\n` : ""}`);
  writeFile(path.join(tmp, "build.json"), JSON.stringify({ builtAt: now }) + "\n");
  // _headers (Cloudflare Pages čita zaglavlja iz izlaznog foldera)
  if (!fs.existsSync(HEADERS)) { fs.rmSync(tmp, { recursive: true, force: true }); throw new BuildError(["_headers: fajl nedostaje u korijenu repoa (zaglavlja za Cloudflare Pages)"]); }
  fs.copyFileSync(HEADERS, path.join(tmp, "_headers"));

  const broken = checkLinks(tmp);
  if (broken.length) { fs.rmSync(tmp, { recursive: true, force: true }); throw new BuildError(broken); }

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.renameSync(tmp, DIST);

  console.log(`Izgrađeno ${list.length} stranica, ${copied.size} slika${remoteFiles ? ` + ${remoteFiles} fajlova iz Storagea` : ""}, za ${Date.now() - t0} ms:`);
  const vp = list.filter((p) => p.route.startsWith("/sorte/") && p.route !== "/sorte/");
  for (const p of list) if (!vp.includes(p)) console.log("  " + p.route);
  console.log(`  /sorte/<slug>/ × ${vp.length} (${vp.filter((p) => p.seo.noindex).length} noindex, bez slike)`);
  console.log("  /sitemap.xml\n  /robots.txt\n  /build.json\n  /_headers");
}

try {
  await main();
  for (const w of warnings) console.warn("UPOZORENJE: " + w);
} catch (e) {
  for (const w of warnings) console.warn("UPOZORENJE: " + w);
  fs.rmSync(DIST + ".tmp", { recursive: true, force: true });
  if (e instanceof BuildError) {
    const n = e.list.length, d = n % 10, dd = n % 100;
    const word = d === 1 && dd !== 11 ? "greška" : d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? "greške" : "grešaka";
    console.error(`\nIZGRADNJA NIJE USPJELA (${n} ${word}):`);
    for (const l of e.list) console.error("  - " + l);
  } else {
    console.error("\nIZGRADNJA NIJE USPJELA: " + (e && e.stack ? e.stack : e));
  }
  process.exit(1);
}
