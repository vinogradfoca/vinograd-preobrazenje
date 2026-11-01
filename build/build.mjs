#!/usr/bin/env node
// Izgradnja statičkog sajta u dist/.
//
//   node build/build.mjs --seed     čita data/seed.json (Korak 1)
//
// Čist Node, bez npm paketa. Pri bilo kojoj grešci u podacima izlazi s kodom 1
// i ne ostavlja polovičan dist/.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createEngine, escapeHtml } from "./template.mjs";
import { webpSize } from "./webp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const TPL = path.join(ROOT, "templates");
const SEED = path.join(ROOT, "data", "seed.json");
const SEED_IMG = path.join(ROOT, "data", "seed-img");

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
  const known = new Set(["--seed"]);
  const unknown = args.filter((a) => !known.has(a));
  if (unknown.length) throw new BuildError([`Nepoznata opcija: ${unknown.join(" ")}`]);
  if (!args.includes("--seed")) {
    throw new BuildError(["Čitanje Firebase baze dolazi u Koraku 2. Za sada pokrenite: node build/build.mjs --seed"]);
  }
  return { seed: true };
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
    if (s.siteUrl && !/^https:\/\/[^\s/]+(\/[^\s]*)?$/.test(s.siteUrl)) E.push(`settings.siteUrl: "${s.siteUrl}" mora biti puna adresa, npr. https://primjer.netlify.app`);
  }

  // images
  const images = db.images || {};
  if (typeof images !== "object") E.push("images: mora biti objekat");
  for (const [id, im] of Object.entries(images)) {
    const w = `images/${id}`;
    if (!im || typeof im !== "object") { E.push(`${w}: nije objekat`); continue; }
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
  const noImg = Object.values(vars).filter((v) => v && v.visible && Array.isArray(v.images) && !v.images.some((id) => images[id] && !images[id]._missing));
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
    return { id, src: "/img/" + im.file, file: im.file, w: im._w, h: im._h, alt: altOverride ?? im.alt };
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
    const images = v.images.filter((id) => !db.images[id]._missing)
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
      small: available ? (prices.length ? "od " + KM(Math.min(...prices)) : "Cijena na upit") : "Trenutno nedostupno",
      search: v.name.toLowerCase(),
      seoTitle: v.seoTitle, seoDescription: v.seoDescription,
      kindsText: kinds.length === 2 ? "sadnice i reznice" : kinds[0] === "sapling" ? "sadnice" : kinds[0] === "cutting" ? "reznice" : "",
    };
  });

  // izdvojene; ako nijedna nije označena, prvih 6 koje imaju sliku
  let featured = varieties.filter((v) => v.featured);
  if (!featured.length) featured = varieties.filter((v) => v.hasImage).slice(0, 6);
  if (!featured.length) featured = varieties.slice(0, 6);
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
    common: {
      hero, varieties, logo,
      site: {
        name: s.name, phone: s.phone, tel: telHref(s.phone), email: s.email, address: s.address,
        mapUrl: s.mapUrl || "", wa: "https://wa.me/" + s.phoneIntl, phoneIntl: s.phoneIntl,
      },
      shopJson: jsonForScript({ phoneIntl: s.phoneIntl, email: s.email, name: s.name }),
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
    sortCount: sorti(m.varieties.length) + " u ponudi",
  });

  // /sorte/
  add("/sorte/", "sorte.html", "sorte", {
    title: "Sorte vinove loze | " + name,
    description: clip(`Katalog sorti vinove loze: ${sorti(m.varieties.length)}, sadnice i reznice. ${name}, ${m.s.address}.`),
  }, {
    total: m.varieties.length,
    resultCount: `${m.varieties.length} od ${m.varieties.length} sorti`,
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
      ...(v.hasImage ? { image: v.images.map((i) => m.abs(i.src)) } : {}),
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
      priced: m.varieties.filter((v) => v.priceSapling !== "–" || v.priceCutting !== "–"),
      unpricedCount: m.varieties.filter((v) => v.priceSapling === "–" && v.priceCutting === "–").length,
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
    for (const [, attr, url] of html.matchAll(/\s(href|src)="([^"]*)"/g)) {
      if (!url.startsWith("/") || url.startsWith("//")) continue;
      if (!exists(url)) E.push(`${path.relative(outDir, file)}: ${attr}="${url}" ne postoji u dist/`);
    }
  }
  return E;
}

function main() {
  const t0 = Date.now();
  readArgs();
  const db = loadSeed();
  validate(db);
  const m = buildModel(db);

  // pripremi sve u privremeni folder, pa ga zamijeni s dist/ tek kad sve uspije
  const tmp = DIST + ".tmp";
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

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
    if (copied.has(im.file)) return;
    fs.mkdirSync(path.join(tmp, "img"), { recursive: true });
    fs.copyFileSync(path.join(SEED_IMG, im.file), path.join(tmp, "img", im.file));
    copied.add(im.file);
  };
  copyImg(db.pages.home.heroImage);
  m.varieties.forEach((v) => v.images.forEach((i) => copyImg(i.id)));

  const engine = createEngine((name) => fs.readFileSync(path.join(TPL, name), "utf8"));
  const list = pages(m, db);
  const ogImage = m.abs(m.hero.src);

  for (const pg of list) {
    const isPage = pg.route.endsWith("/");
    const content = engine.render(pg.template, { ...m.common, ...pg.data });
    const seo = {
      title: pg.seo.title,
      description: pg.seo.description,
      canonical: m.siteUrl && isPage && !pg.seo.noindex ? m.siteUrl + pg.route : "",
      ogType: pg.seo.ogType || "website",
      ogImage, ogImageW: m.hero.w, ogImageH: m.hero.h,
      noindex: !!pg.seo.noindex,
      schema: (pg.seo.schema || []).map(jsonForScript),
    };
    let html = engine.render("layout.html", { ...m.common, seo, assets, nav: m.nav(pg.navKey), content });
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

  const broken = checkLinks(tmp);
  if (broken.length) { fs.rmSync(tmp, { recursive: true, force: true }); throw new BuildError(broken); }

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.renameSync(tmp, DIST);

  console.log(`Izgrađeno ${list.length} stranica, ${copied.size} slika, za ${Date.now() - t0} ms:`);
  const vp = list.filter((p) => p.route.startsWith("/sorte/") && p.route !== "/sorte/");
  for (const p of list) if (!vp.includes(p)) console.log("  " + p.route);
  console.log(`  /sorte/<slug>/ × ${vp.length} (${vp.filter((p) => p.seo.noindex).length} noindex, bez slike)`);
  console.log("  /sitemap.xml\n  /robots.txt\n  /build.json");
}

try {
  main();
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
