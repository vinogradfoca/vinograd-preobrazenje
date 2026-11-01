#!/usr/bin/env node
// Pravi data/seed.json iz kataloga starog sajta (nacrt/stari-sajt/catalog.js).
//
//   node build/import-catalog.mjs
//
// catalog.js se izvršava kakav jeste (node:vm, kontekst {window:{}}), a čita se
// gotov window.fullCatalog. Logika spajanja (ladjarevicFacts, curated,
// sheetFacts, priceFacts, autori, porijeklo, berrySizes, slike) se NE prepisuje.
//
// Iz postojećeg data/seed.json zadržava se: settings, pages, slika naslovne
// strane i oznaka "featured" za sorte čiji se slug poklapa.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(ROOT, "nacrt", "stari-sajt", "catalog.js");
const SEED = path.join(ROOT, "data", "seed.json");

const FACT_KEYS = ["origin", "author", "maturity", "clusterWeight", "berryWeight", "berrySize", "frost", "disease", "taste"];

function fail(msg) {
  console.error("UVOZ NIJE USPIO: " + msg);
  process.exit(1);
}

// Slug: bez dijakritika, mala slova, crtice (PLAN §3).
function slugify(name) {
  return name
    .replace(/[Đđ]/g, "dj")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const str = (v) => (typeof v === "string" ? v.trim() : "");
const price = (v) => (typeof v === "number" && v > 0 ? v : null);

// 1. katalog
const ctx = { window: {} };
try {
  vm.runInNewContext(fs.readFileSync(CATALOG, "utf8"), ctx, { filename: "catalog.js", timeout: 5000 });
} catch (e) { fail(`catalog.js se ne može izvršiti: ${e.message}`); }
if (!Array.isArray(ctx.window.fullCatalog)) fail("catalog.js ne postavlja window.fullCatalog");
const catalog = JSON.parse(JSON.stringify(ctx.window.fullCatalog));
// kratki red iz fullCatalogRaw (isti redoslijed kao fullCatalog): stari kod ga je kopirao u exp
const shortRows = (ctx.window.fullCatalogRaw || []).map((r) => str(r && r[4]));
const PERSONAL = /kod mene|na mom terenu|primijetio/i;

// 2. postojeći seed (settings, pages, naslovna slika, featured)
let old = { vinograd: {} };
try { old = JSON.parse(fs.readFileSync(SEED, "utf8")); } catch { /* nema starog seeda */ }
const ov = old.vinograd || {};
if (!ov.settings || !ov.pages) fail("data/seed.json mora već imati settings i pages (njih katalog nema)");
const heroId = ov.pages.home && ov.pages.home.heroImage;
const oldFeatured = new Set(Object.values(ov.varieties || {}).filter((v) => v && v.featured).map((v) => v.slug));

// 3. sorte i slike
const varieties = {};
const images = {};
if (heroId && ov.images && ov.images[heroId]) images[heroId] = ov.images[heroId];
const seen = new Map();

catalog.forEach((x, i) => {
  const name = str(x.name);
  if (!name) fail(`stavka ${i + 1} nema naziv`);
  const slug = slugify(name);
  if (!slug) fail(`"${name}": prazan slug`);
  if (seen.has(slug)) fail(`slug "${slug}" imaju i "${seen.get(slug)}" i "${name}"`);
  seen.set(slug, name);

  const desc = str(x.desc);
  // exp je lično iskustvo samo ako nije automatska kopija kratkog reda:
  // - isto kao desc: kopija (kratki red je i opis)
  // - isto kao kratki red, a bez "kod mene"/"na mom terenu": kopija opšteg opisa
  let exp = str(x.exp);
  if (exp === desc) exp = "";
  else if (exp && exp === shortRows[i] && !PERSONAL.test(exp)) exp = "";

  const facts = {};
  for (const k of FACT_KEYS) if (str(x[k])) facts[k] = str(x[k]);

  const imgIds = [];
  for (const p of x.images || []) {
    const file = String(p).split("/").pop();
    const id = file.replace(/\.webp$/i, "");
    if (images[id] && images[id].file !== file) fail(`dvije slike s istim ID-jem "${id}"`);
    if (images[id] && imgIds.includes(id)) continue;
    images[id] = images[id] || { file, alt: "Grozd sorte " + name, w: null, h: null, variants: {}, createdAt: null, createdBy: null };
    imgIds.push(id);
  }

  varieties[slug] = {
    name, slug,
    color: str(x.color), ripen: str(x.ripen), type: str(x.type),
    order: i + 1,
    featured: oldFeatured.has(slug),
    visible: true,
    desc, exp, flaws: "",
    facts,
    images: imgIds,
    sapling: { enabled: true, price: price(x.sp), qty: null },
    cutting: { enabled: true, price: price(x.cp), qty: null },
    seoTitle: "", seoDescription: "", updatedAt: null,
  };
});

const seed = {
  vinograd: {
    settings: ov.settings,
    pages: ov.pages,
    varieties,
    images,
    publish: ov.publish || { last: null },
  },
};
fs.writeFileSync(SEED, JSON.stringify(seed, null, 2) + "\n");

const list = Object.values(varieties);
console.log(`Uvezeno ${list.length} sorti u data/seed.json`);
console.log(`  s cijenom: ${list.filter((v) => v.sapling.price != null || v.cutting.price != null).length}`);
console.log(`  s ličnim iskustvom (exp): ${list.filter((v) => v.exp).length}`);
console.log(`  izdvojene (featured, iz starog seeda): ${list.filter((v) => v.featured).map((v) => v.name).join(", ") || "nijedna"}`);
console.log(`  slika u katalogu: ${Object.keys(images).length - (heroId ? 1 : 0)}`);
